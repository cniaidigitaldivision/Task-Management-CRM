import { describe, expect, it } from 'vitest';

import { oggCrc, opusPacketSamples, readWebmOpus, webmOpusToOgg } from '@/lib/media/webm-to-ogg';

/* ── Building a WebM the way Chrome's MediaRecorder does ──────────────────── */

const idBytes = (id: number) => {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return out;
};
const sizeBytes = (n: number) => {
  /* 8-byte size vint, as Chrome writes. */
  const out = [0x01, 0, 0, 0, 0, 0, 0, 0];
  let v = n;
  for (let i = 7; i > 0; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
};
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const el = (id: number, body: number[]) => [...idBytes(id), ...sizeBytes(body.length), ...body];
const master = (id: number, body: number[]) => [...idBytes(id), ...UNKNOWN, ...body];
const ascii = (s: string) => [...new TextEncoder().encode(s)];

function opusHead(channels = 1, preSkip = 312) {
  const b = new Uint8Array(19);
  b.set(new TextEncoder().encode('OpusHead'));
  b[8] = 1;
  b[9] = channels;
  new DataView(b.buffer).setUint16(10, preSkip, true);
  new DataView(b.buffer).setUint32(12, 48000, true);
  return [...b];
}

/* A 20 ms CELT fullband frame has TOC config 31, code 0 → 0xF8. Bodies vary in
   length, including one past 255 bytes to exercise lacing across segments. */
function packet(i: number, length: number) {
  return [0xf8, ...Array.from({ length: length - 1 }, (_, k) => (i * 7 + k) & 0xff)];
}

function chromeWebm(packets: number[][]) {
  const blocks = packets.flatMap((p, i) =>
    el(0xa3, [0x81, (i >> 8) & 0xff, i & 0xff, 0x80, ...p]),
  );
  return new Uint8Array([
    ...el(0x1a45dfa3, [...el(0x4282, ascii('webm'))]),
    ...master(0x18538067, [
      ...el(0x1549a966, [...el(0x2ad7b1, [0x0f, 0x42, 0x40])]),
      ...el(0x1654ae6b, [
        ...el(0xae, [
          ...el(0xd7, [0x01]),
          ...el(0x86, ascii('A_OPUS')),
          ...el(0x63a2, opusHead()),
          ...el(0xe1, [...el(0x9f, [0x01]), ...el(0xb5, [0x40, 0xe7, 0x70, 0x00, 0, 0, 0, 0])]),
        ]),
      ]),
      ...master(0x1f43b675, [...el(0xe7, [0x00]), ...blocks]),
    ]),
  ]);
}

/* ── Reading an Ogg stream back, independently ────────────────────────────── */

function readOgg(bytes: Uint8Array) {
  const pages: { flags: number; granule: bigint; seq: number; crcOk: boolean; packets: number[][] }[] = [];
  let p = 0;
  let carry: number[] = [];
  while (p < bytes.length) {
    expect(String.fromCharCode(...bytes.subarray(p, p + 4))).toBe('OggS');
    const v = new DataView(bytes.buffer, bytes.byteOffset + p);
    const flags = bytes[p + 5];
    const granule = v.getBigInt64(6, true);
    const seq = v.getUint32(18, true);
    const crc = v.getUint32(22, true);
    const n = bytes[p + 26];
    const lacing = [...bytes.subarray(p + 27, p + 27 + n)];
    const bodyLen = lacing.reduce((a, b) => a + b, 0);
    const total = 27 + n + bodyLen;
    const copy = bytes.slice(p, p + total);
    new DataView(copy.buffer).setUint32(22, 0, true);
    const packets: number[][] = [];
    let q = p + 27 + n;
    for (const l of lacing) {
      carry.push(...bytes.subarray(q, q + l));
      q += l;
      if (l < 255) {
        packets.push(carry);
        carry = [];
      }
    }
    pages.push({ flags, granule, seq, crcOk: oggCrc(copy) === crc, packets });
    p += total;
  }
  return pages;
}

describe('opusPacketSamples', () => {
  it('reads frame size and count from the TOC byte', () => {
    expect(opusPacketSamples(new Uint8Array([0xf8]))).toBe(960); // CELT 20 ms × 1
    expect(opusPacketSamples(new Uint8Array([0xf9]))).toBe(1920); // × 2
    expect(opusPacketSamples(new Uint8Array([0x19]))).toBe(2880 * 2); // SILK 60 ms (config 3), code 1 → 2 frames
    expect(opusPacketSamples(new Uint8Array([0x03, 0x03]))).toBe(480 * 3); // SILK 10 ms, code 3, 3 frames
  });
});

describe('webmOpusToOgg', () => {
  const input = Array.from({ length: 120 }, (_, i) => packet(i, i === 7 ? 600 : 40 + (i % 90)));
  const webm = chromeWebm(input);

  it('lifts every packet out of an unknown-size WebM, in order', () => {
    const track = readWebmOpus(webm);
    expect(track.packets.length).toBe(120);
    expect([...track.packets[7]]).toEqual(input[7]);
    expect(track.channels).toBe(1);
  });

  it('writes a valid Ogg Opus stream carrying the same packets', () => {
    const { ogg, seconds, channels } = webmOpusToOgg(webm);
    const pages = readOgg(ogg);

    expect(pages.every((pg) => pg.crcOk)).toBe(true);
    expect(pages.map((pg) => pg.seq)).toEqual(pages.map((_, i) => i));
    expect(pages[0].flags & 0x02).toBe(0x02); // beginning of stream
    expect(pages.at(-1)!.flags & 0x04).toBe(0x04); // end of stream
    expect(String.fromCharCode(...pages[0].packets[0].slice(0, 8))).toBe('OpusHead');
    expect(String.fromCharCode(...pages[1].packets[0].slice(0, 8))).toBe('OpusTags');

    const audio = pages.slice(2).flatMap((pg) => pg.packets);
    expect(audio).toEqual(input);
    // granule of the last page = all samples: 120 × 960
    expect(pages.at(-1)!.granule).toBe(BigInt(120 * 960));
    // granules never go backwards
    const g = pages.map((pg) => pg.granule);
    expect(g.every((x, i) => i === 0 || x >= g[i - 1])).toBe(true);
    expect(channels).toBe(1);
    expect(seconds).toBeCloseTo((120 * 960 - 312) / 48000, 5);
  });

  it('refuses something that is not a recording', () => {
    expect(() => webmOpusToOgg(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
