/* ============================================================================
 * A VOICE NOTE, REPACKAGED FOR WHATSAPP — WebM/Opus → Ogg/Opus
 * ----------------------------------------------------------------------------
 * WhatsApp takes a voice note ONLY as `.ogg` with the OPUS codec, mono (Meta's
 * media reference, checked 2026-09-17). Chrome's MediaRecorder cannot write Ogg;
 * it writes WebM. The audio inside both is the SAME Opus packets — so nothing is
 * re-encoded here. The packets are lifted out of the WebM container and written
 * into Ogg pages (RFC 7845), which costs milliseconds and no quality.
 *
 * Pure: bytes in, bytes out. No DOM, no AudioContext — tested in
 * `lib/media/__tests__/webm-to-ogg.test.ts`, and proved in real Chrome by
 * recording, converting and decoding the result.
 * ========================================================================= */

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Audio: 0xe1,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Channels: 0x9f,
  SamplingFrequency: 0xb5,
  CodecDelay: 0x56aa,
} as const;

/* Elements we step INTO rather than over. Everything else is skipped by size. */
const MASTERS: ReadonlySet<number> = new Set([
  ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.Audio, ID.BlockGroup,
]);

class Reader {
  constructor(private readonly b: Uint8Array, public pos = 0) {}
  get done() { return this.pos >= this.b.length; }

  /** An element id keeps its length-marker bits. */
  id(): number | null {
    const first = this.b[this.pos];
    if (first === undefined) return null;
    let len = 1;
    while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 4 || this.pos + len > this.b.length) return null;
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + this.b[this.pos + i];
    this.pos += len;
    return v;
  }

  /** A size drops the marker; all-ones means "unknown" (a live recording). */
  size(): number | 'unknown' | null {
    const first = this.b[this.pos];
    if (first === undefined) return null;
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8 || this.pos + len > this.b.length) return null;
    let v = first & (0xff >> len);
    let allOnes = v === 0xff >> len;
    for (let i = 1; i < len; i++) {
      const byte = this.b[this.pos + i];
      if (byte !== 0xff) allOnes = false;
      v = v * 256 + byte;
    }
    this.pos += len;
    return allOnes ? 'unknown' : v;
  }

  bytes(n: number): Uint8Array {
    const out = this.b.subarray(this.pos, Math.min(this.pos + n, this.b.length));
    this.pos += n;
    return out;
  }
}

function vintLength(first: number): number {
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  return len;
}

/** The frames inside a (Simple)Block: track number, timecode, flags, then data. */
function framesOfBlock(block: Uint8Array): Uint8Array[] {
  let p = vintLength(block[0]); // track number
  p += 2; // relative timecode
  const flags = block[p];
  p += 1;
  const lacing = (flags >> 1) & 0x03;
  const data = block.subarray(p);
  if (lacing === 0) return [data];

  const count = data[0] + 1;
  let q = 1;
  if (lacing === 1) {
    /* Xiph lacing: sizes as runs of 255. */
    const sizes: number[] = [];
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      let byte: number;
      do {
        byte = data[q++];
        size += byte;
      } while (byte === 255);
      sizes.push(size);
    }
    const used = sizes.reduce((a, b) => a + b, 0);
    sizes.push(data.length - q - used);
    return sizes.map((size) => {
      const f = data.subarray(q, q + size);
      q += size;
      return f;
    });
  }
  if (lacing === 2) {
    /* Fixed-size lacing. */
    const size = (data.length - 1) / count;
    return Array.from({ length: count }, (_, i) => data.subarray(1 + i * size, 1 + (i + 1) * size));
  }
  throw new Error('This recording uses EBML lacing, which cannot be converted.');
}

export interface OpusTrack {
  readonly head: Uint8Array;
  readonly packets: Uint8Array[];
  readonly channels: number;
}

/** Pull the OpusHead and every packet, in order, out of a WebM file. */
export function readWebmOpus(webm: Uint8Array): OpusTrack {
  const r = new Reader(webm);
  let codec = '';
  let head: Uint8Array | null = null;
  let channels = 1;
  let rate = 48000;
  const packets: Uint8Array[] = [];

  while (!r.done) {
    const id = r.id();
    if (id === null) break;
    const size = r.size();
    if (size === null) break;

    if (MASTERS.has(id)) continue; // descend: its children follow directly
    if (size === 'unknown') break; // an unknown-size leaf cannot be skipped

    const body = r.bytes(size);
    switch (id) {
      case ID.CodecID:
        codec = new TextDecoder().decode(body);
        break;
      case ID.CodecPrivate:
        head = body.slice();
        break;
      case ID.Channels:
        channels = body.reduce((v, b) => v * 256 + b, 0);
        break;
      case ID.SamplingFrequency:
        rate = body.length === 4
          ? new DataView(body.buffer, body.byteOffset, 4).getFloat32(0)
          : new DataView(body.buffer, body.byteOffset, 8).getFloat64(0);
        break;
      case ID.SimpleBlock:
      case ID.Block:
        for (const f of framesOfBlock(body)) if (f.length > 0) packets.push(f.slice());
        break;
      default:
        break;
    }
  }

  if (codec && codec !== 'A_OPUS') throw new Error(`This recording is ${codec}, not Opus.`);
  if (packets.length === 0) throw new Error('The recording is empty.');

  if (!head || head.length < 19 || new TextDecoder().decode(head.subarray(0, 8)) !== 'OpusHead') {
    head = opusHead(channels, Math.round(rate) || 48000, 3840);
  }
  return { head, packets, channels: head[9] };
}

function opusHead(channels: number, inputRate: number, preSkip: number): Uint8Array {
  const out = new Uint8Array(19);
  out.set(new TextEncoder().encode('OpusHead'), 0);
  const v = new DataView(out.buffer);
  out[8] = 1; // version
  out[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, inputRate, true);
  v.setInt16(16, 0, true); // output gain
  out[18] = 0; // mapping family
  return out;
}

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte — RFC 6716 §3.1. */
export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frameMs: number;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4];
  else if (config < 16) frameMs = [10, 20][config % 2];
  else frameMs = [2.5, 5, 10, 20][config % 4];
  const code = toc & 0x03;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return Math.round(frames * frameMs * 48);
}

/* ── Ogg ──────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Ogg's CRC-32: polynomial 0x04C11DB7, not reflected, no initial or final xor. */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

function page(
  packets: readonly Uint8Array[],
  flags: number,
  granule: bigint,
  serial: number,
  sequence: number,
): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let left = p.length;
    while (left >= 255) {
      lacing.push(255);
      left -= 255;
    }
    lacing.push(left);
  }
  const bodyLength = packets.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + bodyLength);
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  out[4] = 0; // version
  out[5] = flags;
  v.setBigInt64(6, granule, true);
  v.setUint32(14, serial, true);
  v.setUint32(18, sequence, true);
  v.setUint32(22, 0, true); // CRC, filled below
  out[26] = lacing.length;
  out.set(lacing, 27);
  let p = 27 + lacing.length;
  for (const packet of packets) {
    out.set(packet, p);
    p += packet.length;
  }
  v.setUint32(22, oggCrc(out), true);
  return out;
}

/** Write Opus packets as an Ogg stream (RFC 7845). */
export function writeOggOpus(track: OpusTrack, serial = 0x1d0c5e1): Uint8Array {
  const pages: Uint8Array[] = [];
  let sequence = 0;

  pages.push(page([track.head], 0x02, BigInt(0), serial, sequence++));

  const vendor = new TextEncoder().encode('CNI Taskly');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(new TextEncoder().encode('OpusTags'), 0);
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  new DataView(tags.buffer).setUint32(12 + vendor.length, 0, true);
  pages.push(page([tags], 0x00, BigInt(0), serial, sequence++));

  /* ⚠️ A PAGE HOLDS AT MOST 255 LACING VALUES, and the granule is the running
     sample count of the packets COMPLETED on that page, pre-skip included. */
  let granule = 0;
  let batch: Uint8Array[] = [];
  let lacingCount = 0;
  const flush = (last: boolean) => {
    if (batch.length === 0) return;
    pages.push(page(batch, last ? 0x04 : 0x00, BigInt(granule), serial, sequence++));
    batch = [];
    lacingCount = 0;
  };

  track.packets.forEach((packet, i) => {
    const needed = Math.floor(packet.length / 255) + 1;
    if (needed > 255) throw new Error('An Opus packet is too large for one Ogg page.');
    if (lacingCount + needed > 255 || batch.length >= 50) flush(false);
    batch.push(packet);
    lacingCount += needed;
    granule += opusPacketSamples(packet);
    if (i === track.packets.length - 1) flush(true);
  });

  const total = pages.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const pg of pages) {
    out.set(pg, p);
    p += pg.length;
  }
  return out;
}

/** The whole conversion, and the duration in seconds for the preview. */
export function webmOpusToOgg(webm: Uint8Array): { ogg: Uint8Array; seconds: number; channels: number } {
  const track = readWebmOpus(webm);
  const samples = track.packets.reduce((a, p) => a + opusPacketSamples(p), 0);
  const preSkip = new DataView(track.head.buffer, track.head.byteOffset, track.head.length).getUint16(10, true);
  return {
    ogg: writeOggOpus(track),
    seconds: Math.max(0, samples - preSkip) / 48000,
    channels: track.channels,
  };
}
