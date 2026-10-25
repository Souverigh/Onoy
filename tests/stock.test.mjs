import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { costCurrency, detectColumns, importRows, mergeImportRows, namelessLines, normalizeUnit, priceColumns, stockNumber } from "../src/lib/stock.ts";
import { normalizeText, searchProducts } from "../src/lib/match.ts";
import { readCsv, readWorkbook, readXlsx } from "../src/lib/xlsx-read.ts";
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
    sale_price: "85.5", purchase_price: "60", purchase_currency: "KGS", stock: "100",
    category: null, subcategory: null, warnings: [],
  });
  assert.deepEqual([rows[1].unit, rows[1].sale_price, rows[1].stock, rows[1].sku], ["мешок", "1200", null, null]);
  assert.deepEqual(rows[2].warnings, ["Единица «ящик» - не знаем, будет «шт»", "Цена продажи: «abc» - не число"]);
  assert.equal(detectColumns([["1", "2"], ["3", "4"]]), null);
});

test("importRows: category and subcategory columns, or «Освещение / Светильники» in one cell", () => {
  const table = [
    ["Наименование", "Группа товаров", "Подгруппа"],
    ["Светильник CARLA-18", "Освещение", "Светильники"],
    ["Лампа E27", "Освещение / Лампы", ""],
    ["Цемент", "", "Без верхней"],
  ];
  const found = detectColumns(table);
  assert.deepEqual(found.columns, { name: 0, category: 1, subcategory: 2 });
  const rows = importRows(table, found.header, found.columns);
  assert.deepEqual(
    rows.map((r) => [r.category, r.subcategory]),
    [
      ["Освещение", "Светильники"],
      ["Освещение", "Лампы"],
      [null, null],
    ],
  );
});

test("importRows: purchase currency from its column, from the price cell, else the file default", () => {
  assert.deepEqual(
    ["$", "USD", "доллар", "у.е.", "руб.", "₽", "сом", "KGS", "с", "", "евро"].map(costCurrency),
    ["USD", "USD", "USD", "USD", "RUB", "RUB", "KGS", "KGS", "KGS", null, null],
  );
  assert.equal(stockNumber("$0,29", 2), "0.29");
  assert.equal(stockNumber("0.29 USD", 2), "0.29");
  const table = [
    ["Наименование", "Код", "Цена закупки", "Валюта закупки", "Цена продажи", "Остаток"],
    ["ВИЛКА 807", "", "0.6", "$", "70", "120"],
    ["Кабель", "", "60", "сом", "85", "10"],
    ["Розетка", "", "95", "руб", "150", "5"],
    ["Выключатель", "", "0.75", "", "90", "96"],
    ["Удлинитель", "", "2,5 $", "", "300", "3"],
    ["Лампа", "", "", "$", "40", "1"],
    ["Скотч", "", "1", "евро", "60", "1"],
  ];
  const found = detectColumns(table);
  assert.deepEqual(found.columns, { name: 0, sku: 1, purchase_price: 2, purchase_currency: 3, sale_price: 4, stock: 5 });
  const rows = importRows(table, found.header, found.columns, "USD");
  assert.deepEqual(
    rows.map((r) => [r.purchase_price, r.purchase_currency]),
    [["0.6", "USD"], ["60", "KGS"], ["95", "RUB"], ["0.75", "USD"], ["2.5", "USD"], [null, null], ["1", "USD"]],
  );
  assert.deepEqual(rows[6].warnings, ["Валюта «евро» - не знаем, будет USD"]);
  // Без колонки валюты — выбранная для файла; по умолчанию сом.
  assert.equal(importRows(table, 0, { name: 0, purchase_price: 2 })[0].purchase_currency, "KGS");
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

test("stockValue: what lies on the shelf, at purchase and at sale price", async () => {
  const { stockValue } = await import("../src/lib/stock.ts");
  const value = stockValue(
    [
      { stock: "10", purchase_price: "85.5", purchase_currency: null, sale_price: "100" },
      { stock: "2.5", purchase_price: "0.29", purchase_currency: "USD", sale_price: "40" },
      { stock: "3", purchase_price: "0", purchase_currency: null, sale_price: "0" },
      // Ушёл в минус и закончился — сумму не трогают.
      { stock: "-4", purchase_price: "1000", purchase_currency: null, sale_price: "1200" },
      { stock: "0", purchase_price: "1000", purchase_currency: null, sale_price: "1200" },
      // Валюта магазина записана явно — та же сумма, что и null.
      { stock: "1", purchase_price: "0.01", purchase_currency: "KGS", sale_price: "0.01" },
    ],
    "KGS",
  );
  assert.deepEqual(value.cost, { KGS: "855.01", USD: "0.73" });
  assert.equal(value.sale, "1100.01");
  assert.equal(value.inStock, 4);
  assert.equal(value.noCost, 1);
  assert.equal(value.noSale, 1);
});

test("importRows: one code on two different products in a file is flagged", () => {
  const table = [
    ["Название", "Код"],
    ["Прожектор BILLOW 100W", "2"],
    ["FELIX БЕЛЫЙ", "2"],
    ["прожектор billow 100w", "2"],
    ["Без кода", ""],
  ];
  const rows = importRows(table, 0, { name: 0, sku: 1 });
  // Строка 4 — тот же прожектор ещё раз: не ошибка кода, а повтор (сольётся).
  assert.deepEqual(rows.map((r) => r.warnings.length), [0, 1, 1, 0]);
  assert.match(rows[2].warnings[0], /Повтор строки 2/);
  assert.match(rows[1].warnings[0], /Код «2» уже у «Прожектор BILLOW 100W» \(строка 2\)/);
  assert.equal(rows[3].sku, null);
});

test("namelessLines: rows with data but no name are reported, empty rows are not", () => {
  const table = [
    ["Название", "Код", "Цена"],
    ["Лампа", "L1", "100"],
    ["", "L2", "200"],
    ["", "", ""],
    ["  ", "", "50"],
  ];
  assert.deepEqual(namelessLines(table, 0, { name: 0, sku: 1, sale_price: 2 }), [3, 5]);
  assert.equal(importRows(table, 0, { name: 0, sku: 1, sale_price: 2 }).length, 1);
});

test("readWorkbook: chosen sheet, sheet names, hidden rows, codes with leading zeros", async () => {
  const files = {
    "xl/workbook.xml":
      '<workbook xmlns:r="r"><sheets><sheet name="Описание" sheetId="1" r:id="rId1"/><sheet name="Прайс &amp; цены" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="x"/></Relationships>',
    "xl/styles.xml":
      '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="000000"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Читайте второй лист</t></is></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Код</t></is></c></row>' +
      '<row r="2" hidden="1"><c r="A2" s="1"><v>123</v></c><c r="B2" s="0"><v>45</v></c></row></sheetData></worksheet>',
  };
  const zip = makeZip(Object.entries(files).map(([name, text]) => ({ name, data: deflateRawSync(Buffer.from(text)), size: Buffer.byteLength(text) })));
  const buffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
  const first = await readWorkbook(buffer);
  assert.deepEqual([first.sheets, first.sheet, first.table], [["Описание", "Прайс & цены"], 0, [["Читайте второй лист"]]]);
  const second = await readWorkbook(buffer, 1);
  assert.deepEqual([second.sheet, second.hidden, second.table], [1, [2], [["Код"], ["000123", "45"]]]);
});

test("readCsv: a title line with commas does not decide the separator", () => {
  const csv = new TextEncoder().encode("Прайс, ООО Свет\nНазвание;Цена\nЛампа;100\n");
  assert.deepEqual(readCsv(csv.buffer), [["Прайс, ООО Свет"], ["Название", "Цена"], ["Лампа", "100"]]);
});

test("importRows: negative stock, «1,250», rounding, negative price; mergeImportRows sums repeats", () => {
  const table = [
    ["Название", "Код", "Цена", "Цена закупки", "Остаток"],
    ["Лампа", "", "1,250", "0,295", "-3"],
    ["Розетка", "R1", "-5", "", "−2,5"],
    ["лампа", "L1", "120", "", "10"],
    ["Кабель", "", "", "", ""],
    ["ЛАМПА", "L2", "", "", "1,5"],
  ];
  const columns = { name: 0, sku: 1, sale_price: 2, purchase_price: 3, stock: 4 };
  const rows = importRows(table, 0, columns);
  assert.deepEqual(rows.map((r) => r.stock), ["-3", "-2.5", "10", null, "1.5"]);
  assert.match(rows[0].warnings.join(), /«1,250» - прочитали как 1,25; если это 1250 - уберите запятую/);
  assert.match(rows[0].warnings.join(), /«0,295» - округлим до 0,3/);
  assert.equal(rows[1].sale_price, null);
  assert.match(rows[1].warnings.join(), /«-5» - меньше нуля/);
  assert.match(rows[2].warnings.join(), /Повтор строки 2/);
  assert.match(rows[4].warnings.join(), /код будет «L2»/);

  const merged = mergeImportRows(rows);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    [merged[0].name, merged[0].line, merged[0].also, merged[0].stock, merged[0].sku, merged[0].sale_price, merged[0].purchase_price],
    ["Лампа", 2, [4, 6], "8.5", "L2", "120", "0.3"],
  );
  // Исходные строки не меняются: предпросмотр показывает их как в файле.
  assert.equal(rows[0].stock, "-3");
});

test("detectColumns: retail price column wins over wholesale; priceColumns lists both", () => {
  const table = [["Наименование", "Цена опт", "Цена розн.", "Цена закупки"]];
  const found = detectColumns(table);
  assert.equal(found.columns.sale_price, 2);
  assert.equal(found.columns.purchase_price, 3);
  assert.deepEqual(priceColumns(table[0]), [1, 2]);
});
