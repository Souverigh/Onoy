import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildXlsx, excelDate } from "../src/lib/xlsx.ts";

/** Файлы из zip (метод STORE) — по центральному каталогу. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLen));
    const localName = view.getUint16(offset + 26, true);
    const data = bytes.slice(offset + 30 + localName, offset + 30 + localName + size);
    files[name] = new TextDecoder().decode(method === 0 ? data : inflateRawSync(data));
    at += 46 + nameLen;
  }
  return files;
}

test("buildXlsx: a valid package with escaped text, money numbers and Bishkek dates", () => {
  const files = unzip(
    buildXlsx([
      {
        name: "Клиенты",
        columns: [{ header: "Имя" }, { header: "Долг", kind: "money" }, { header: "Дата", kind: "date" }],
        rows: [["A <&> \"B\"", 54270.5, new Date("2026-09-27T08:35:00Z")], [null, -500, undefined]],
      },
      { name: "Оплаты/чеки", columns: [{ header: "N" }], rows: [] },
    ]),
  );
  for (const name of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"])
    assert.ok(files[name], name);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /A &lt;&amp;&gt; &quot;B&quot;/);
  assert.match(sheet, /<c r="B2" s="2"><v>54270.5<\/v><\/c>/);
  assert.match(sheet, /<c r="B3" s="2"><v>-500<\/v><\/c>/);
  assert.match(sheet, /<autoFilter ref="A1:C3"\/>/);
  assert.match(files["xl/workbook.xml"], /name="Оплаты чеки"/); // «/» в имени листа недопустим
});

test("excelDate converts to Bishkek wall time", () => {
  // 27.09.2026 14:35 по Бишкеку = 46292 + 14:35/24ч
  assert.equal(Math.round(excelDate(new Date("2026-09-27T08:35:00Z")) * 1440), 46292 * 1440 + 14 * 60 + 35);
});
