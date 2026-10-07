import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { detectColumns, importRows, normalizeUnit, stockNumber } from "../src/lib/stock.ts";
import { normalizeText, searchProducts } from "../src/lib/match.ts";
import { readCsv, readXlsx } from "../src/lib/xlsx-read.ts";
import { buildXlsx } from "../src/lib/xlsx.ts";

test("normalizeUnit: how units are written on invoices and price lists", () => {
  assert.equal(normalizeUnit("шт."), "шт");
  assert.equal(normalizeUnit("кв.м"), "м²");
  assert.equal(normalizeUnit("М2"), "м²");
  assert.equal(normalizeUnit("м3"), "м³");
  assert.equal(normalizeUnit("пог. м"), "м");
  assert.equal(normalizeUnit("уп"), "упак");
  assert.equal(normalizeUnit("к/т"), "компл");
  assert.equal(normalizeUnit("ящик"), null);
  assert.equal(normalizeUnit(""), null);
});

test("stockNumber: spaces, commas, currency words; scale and garbage", () => {
  assert.equal(stockNumber("1 250,50", 2), "1250.5");
  assert.equal(stockNumber("85.5 сом", 2), "85.5");
  assert.equal(stockNumber("1.250,75", 2), "1250.75");
  assert.equal(stockNumber("12,3456", 3), "12.346");
  assert.equal(stockNumber("85.499999999", 2), "85.5");
  assert.equal(stockNumber("", 2), null);
  assert.equal(stockNumber("abc", 2), null);
  assert.equal(stockNumber("-5", 2), null);
});

test("detectColumns + importRows: header found below a title, purchase price not taken for sale price", () => {
  const table = [
    ["Прайс-лист магазина «Курулуш»"],
    [],
    ["№", "Код", "Наименование товара", "Ед. изм.", "Цена закупки", "Цена, сом", "Остаток"],
    ["1", "A-1", "Кабель ВВГнг 3х2,5", "м", "60", "85,50", "100"],
    ["2", "", "Цемент М400", "меш", "450", "1 200", ""],
    ["3", "", "", "", "", "", ""],
    ["4", "B-7", "Профиль", "ящик", "", "abc", "5"],
  ];
  const found = detectColumns(table);
  assert.deepEqual(found, {
    header: 2,
    columns: { sku: 1, name: 2, unit: 3, purchase_price: 4, sale_price: 5, stock: 6 },
  });
  const rows = importRows(table, found.header, found.columns);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    line: 4, name: "Кабель ВВГнг 3х2,5", sku: "A-1", unit: "м",
    sale_price: "85.5", purchase_price: "60", stock: "100", warnings: [],
  });
  assert.deepEqual([rows[1].unit, rows[1].sale_price, rows[1].stock, rows[1].sku], ["мешок", "1200", null, null]);
  assert.deepEqual(rows[2].warnings, ["Единица «ящик» - не знаем, будет «шт»", "Цена продажи: «abc» - не число"]);
  assert.equal(detectColumns([["1", "2"], ["3", "4"]]), null);
});

test("searchProducts: popular first without a query; code, words in any order, aliases, typos", () => {
  const products = [
    { id: "1", name: "Кабель ВВГнг 3х2,5", sku: "101", aliases: ["ввг 3*2.5"], sold_count: 2 },
    { id: "2", name: "Цемент М400", sku: "C-400", aliases: [], sold_count: 9 },
    { id: "3", name: "Кабель ПВС 2х1,5", sku: "102", aliases: [], sold_count: 0 },
    { id: "4", name: "Гвозди 100 мм", sku: "7", aliases: [], sold_count: 0 },
  ];
  const ids = (q) => searchProducts(q, products).map((p) => p.id);
  assert.deepEqual(ids(""), ["2", "1", "4", "3"]);
  assert.deepEqual(ids("c-400"), ["2"]);
  assert.deepEqual(ids("7"), ["4"]);
  assert.deepEqual(ids("кабель"), ["1", "3"]);
  assert.deepEqual(ids("3x2.5 ввг"), ["1"]);
  assert.deepEqual(ids("цемнт"), ["2"]);
  assert.deepEqual(ids("плитка"), []);
  assert.equal(normalizeText("ВВГ 3*2,5"), normalizeText("ввг 3х2.5"));
});

test("readXlsx: our own export (stored) round-trips; deflated sheets (real Excel) are read too", async () => {
  const bytes = buildXlsx([
    {
      name: "Товары",
      columns: [{ header: "Наименование" }, { header: "Цена", kind: "money" }],
      rows: [["Кабель & провод", 85.5], ["Цемент <М400>", 1200]],
    },
  ]);
  const table = await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.deepEqual(table.slice(0, 3), [["Наименование", "Цена"], ["Кабель & провод", "85.5"], ["Цемент <М400>", "1200"]]);

  // Минимальная книга, как сохраняет Excel: sharedStrings, deflate, пропущенные ячейки.
  const files = {
    "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Товар</t></si><si><r><t>Гвоз</t></r><r><t>ди</t></r></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Остаток</t></is></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3"><v>12.300000000000001</v></c></row></sheetData></worksheet>',
  };
  const zip = makeZip(Object.entries(files).map(([name, text]) => ({ name, data: deflateRawSync(Buffer.from(text)) , size: Buffer.byteLength(text) })));
  assert.deepEqual(await readXlsx(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)), [
    ["Товар", "", "Остаток"],
    [],
    ["Гвозди", "", "12.3"],
  ]);
});

test("readCsv: semicolons, quotes, Windows-1251", () => {
  const utf = new TextEncoder().encode('Название;Цена\n"Кабель ""ВВГ"";3х2,5";85,5\r\nЦемент;1200\n');
  assert.deepEqual(readCsv(utf.buffer), [["Название", "Цена"], ['Кабель "ВВГ";3х2,5', "85,5"], ["Цемент", "1200"]]);
  // «Цена» в cp1251: Ц=0xD6 е=0xE5 н=0xED а=0xE0
  const cp1251 = new Uint8Array([0xd6, 0xe5, 0xed, 0xe0, 0x2c, 0x31]);
  assert.deepEqual(readCsv(cp1251.buffer), [["Цена", "1"]]);
});

/** Zip c deflate (метод 8) — как у Excel. */
function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.size, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, file.data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(file.data.length, 20);
    entry.writeUInt32LE(file.size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
