import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryInput, decimalInput } from "../src/lib/validation.ts";
test("prices preserve decimals without allowing negative, exponent or overflow", () => {
  assert.equal(decimalInput("12,50", 2), "12.50");
  for (const v of [
    "-1",
    "1e9",
    "NaN",
    "999999999999999999",
    "12.345",
    "Infinity",
  ])
    assert.throws(() => decimalInput(v, 2));
});
test("decimalInput accepts space-grouped thousands, as shown by money()", () => {
  assert.equal(decimalInput("54 270", 2), "54270.00");
  assert.equal(decimalInput(" 1 234 567 ", 2), "1234567.00");
  assert.equal(decimalInput("1 234,50", 2), "1234.50");
});
test("decimalInput disambiguates thousands vs decimal when both , and . appear", () => {
  assert.equal(decimalInput("54.270,00", 2), "54270.00");
  assert.equal(decimalInput("54,270.00", 2), "54270.00");
});
test("directory input strips whitespace and enforces meaningful name", () => {
  assert.equal(
    directoryInput("customers", { name: "  Асан  ", phone: "0555123456" }).name,
    "Асан",
  );
  assert.throws(() => directoryInput("customers", { name: "   " }));
  assert.throws(() =>
    directoryInput("products", { name: "Лампа", sale_price: "-1" }),
  );
});
