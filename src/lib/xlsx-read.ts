/**
 * Чтение первого листа .xlsx и .csv без зависимостей — для импорта прайса
 * на склад (в браузере). .xlsx — zip: файлы без сжатия или deflate
 * (DecompressionStream "deflate-raw" — Chrome 103+, Safari 16.4+, Node 18+).
 * Возвращает таблицу строк: ячейки — текст как в Excel, числа — как числа
 * («85.5»), пустые — "".
 */
export type Table = string[][];

const MAX_ROWS = 5000;

// --- ZIP ----------------------------------------------------------------------

type ZipEntry = { name: string; method: number; offset: number; size: number };

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Конец центрального каталога — с конца файла (до 64 КБ комментария).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not_xlsx");
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error("not_xlsx");
    const method = view.getUint16(pos + 10, true);
    const size = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    entries.push({ name, method, offset, size });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.offset;
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const raw = bytes.subarray(start, start + entry.size);
  const data = entry.method === 0 ? raw : entry.method === 8 ? await inflate(raw) : null;
  if (!data) throw new Error("not_xlsx");
  return new TextDecoder().decode(data);
}

// --- XML ----------------------------------------------------------------------

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    return String.fromCodePoint(lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10));
  });
}

/** Текст всех <t> внутри фрагмента (строка может быть разбита на <r>). */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += m[1];
  return decodeXml(out);
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function numberText(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // 85.499999999 → 85.5: в Excel числа хранятся как double.
  return String(Math.round(n * 1e6) / 1e6);
}

export async function readXlsx(buffer: ArrayBuffer): Promise<Table> {
  const bytes = new Uint8Array(buffer);
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ""), e]));
  const read = (name: string) => {
    const entry = byName.get(name);
    return entry ? readEntry(bytes, entry) : Promise.resolve("");
  };

  // Первый лист по порядку в книге.
  const [workbook, rels, shared] = await Promise.all([
    read("xl/workbook.xml"),
    read("xl/_rels/workbook.xml.rels"),
    read("xl/sharedStrings.xml"),
  ]);
  const firstSheetRel = /<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (firstSheetRel) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = m[1];
      if (new RegExp(`\\bId="${firstSheetRel}"`).test(attrs)) {
        const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
        if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      }
    }
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error("not_xlsx");
  const strings = [...shared.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]));

  const table: Table = [];
  for (const rowMatch of sheet.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] ?? table.length + 1);
    if (rowNumber > MAX_ROWS) break;
    const row: string[] = [];
    let next = 0;
    for (const cell of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cell[1];
      const inner = cell[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s") value = strings[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(inner);
      else if (type === "str" || type === "e") value = decodeXml(v ?? "");
      else if (type === "b") value = v === "1" ? "ИСТИНА" : "ЛОЖЬ";
      else if (v != null) value = numberText(v);
      while (row.length < col) row.push("");
      row[col] = value.trim();
    }
    while (table.length < rowNumber - 1) table.push([]);
    table.push(row);
  }
  return table;
}

// --- CSV ----------------------------------------------------------------------

/** CSV из Excel: разделитель ; , или табуляция; кавычки; UTF-8 или Windows-1251. */
export function readCsv(buffer: ArrayBuffer): Table {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("windows-1251").decode(buffer);
  }
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const separator = [";", "\t", ","]
    .map((s) => [s, firstLine.split(s).length] as const)
    .sort((a, b) => b[1] - a[1])[0][0];
  const table: Table = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      table.push(row);
      if (table.length >= MAX_ROWS) return table;
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    table.push(row);
  }
  return table;
}

export async function readTable(file: File): Promise<Table> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer.slice(0, 4));
  // PK\x03\x04 — zip (xlsx); иначе считаем текстом (csv).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(buffer);
  return readCsv(buffer);
}
