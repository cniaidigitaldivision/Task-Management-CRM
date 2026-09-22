/* ============================================================================
 * READ THE FIRST SHEET OF AN .XLSX — no dependency
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"Import clients from CSV/Excel."* There is no spreadsheet
 * library in this project, and adding one for a single import button is a
 * supply-chain and bundle cost for very little. An .xlsx is a zip of XML; the
 * browser (and Node 18+) already ships `DecompressionStream('deflate-raw')`, so
 * this reads the central directory, inflates two files, and parses them.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO: formulas (the cached value is read),
 * dates as dates (Excel stores a serial number; a client sheet is names and
 * numbers), more than the first sheet, or zip64 / encrypted files. Each of
 * those is refused or read as text rather than guessed at.
 *
 * ⚠️ REGEX, NOT DOMParser — so it runs, and is tested, in Node as well as the
 * browser. The XML Excel writes is regular enough for that, and entities are
 * decoded explicitly.
 * ========================================================================= */

const td = new TextDecoder('utf-8');

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

interface Entry {
  name: string;
  method: number;
  size: number;
  offset: number;
}

function entries(b: Uint8Array): Entry[] {
  /* End of central directory: scan back from the end for its signature. */
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i -= 1) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('That file is not a spreadsheet Excel can open.');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n += 1) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function read(b: Uint8Array, e: Entry): Promise<string> {
  if (u32(b, e.offset) !== 0x04034b50) throw new Error('That spreadsheet is damaged.');
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const raw = b.subarray(start, start + e.size);
  if (e.method === 0) return td.decode(raw);
  if (e.method === 8) return td.decode(await inflate(raw));
  throw new Error('That spreadsheet is compressed in a way this import cannot read — save it as CSV instead.');
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENTITY[e.toLowerCase()] ?? '';
  });
}

/** Every <t> inside one string item, joined — rich text is several runs. */
function textOf(xml: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += decodeXml(m[1]);
  return out;
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1]));
  return out;
}

/** "AB12" → 27 (zero-based column). */
function column(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const row: string[] = [];
    const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] ?? '';
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = decodeXml(v);
      const at = ref ? column(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = value;
    }
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

/** The first worksheet as rows of text. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const list = entries(bytes);
  const sheets = list
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(/\d+/.exec(a.name)![0]) - Number(/\d+/.exec(b.name)![0]));
  if (sheets.length === 0) throw new Error('That spreadsheet has no sheet in it.');
  const ss = list.find((e) => e.name === 'xl/sharedStrings.xml');
  const shared = ss ? sharedStrings(await read(bytes, ss)) : [];
  return sheet(await read(bytes, sheets[0]), shared);
}
