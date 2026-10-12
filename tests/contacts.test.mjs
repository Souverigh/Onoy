import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, phoneKey, storedPhone } from "../src/lib/contacts.ts";

test("normalizePhone brings Kyrgyz numbers to +996…", () => {
  assert.equal(normalizePhone("0555 12-34-56"), "+996555123456");
  assert.equal(normalizePhone("+996 (555) 123 456"), "+996555123456");
  assert.equal(normalizePhone("996555123456"), "+996555123456");
  assert.equal(normalizePhone("555123456"), "+996555123456");
  assert.equal(normalizePhone("+7 912 345 67 89"), "+79123456789");
  assert.equal(normalizePhone("нет"), "");
  // Лишний 0 после кода страны и международный префикс 00.
  assert.equal(normalizePhone("+996 0555 123 456"), "+996555123456");
  assert.equal(normalizePhone("00996 555 123 456"), "+996555123456");
});

test("normalizePhone brings Russian numbers to +7…", () => {
  assert.equal(normalizePhone("8 (916) 123-45-67"), "+79161234567");
  assert.equal(normalizePhone("+7 916 123 45 67"), "+79161234567");
  assert.equal(normalizePhone("79161234567"), "+79161234567");
  assert.equal(normalizePhone("916 123 45 67"), "+79161234567");
  assert.equal(normalizePhone("007 916 123 45 67"), "+79161234567");
});

test("storedPhone keeps phone-like input international and the rest as typed", () => {
  assert.equal(storedPhone(" 0555 12-34-56 "), "+996555123456");
  assert.equal(storedPhone("8 916 123-45-67"), "+79161234567");
  assert.equal(storedPhone("доб. 12"), "доб. 12");
  assert.equal(storedPhone(""), "");
});

test("phoneKey matches the same number written differently", () => {
  assert.equal(phoneKey("0555 12-34-56"), phoneKey("+996555123456"));
  assert.notEqual(phoneKey("0555123456"), phoneKey("0700123456"));
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey("8 916 123-45-67"), phoneKey("+7 (916) 1234567"));
  assert.equal(phoneKey("+996 0555 123456"), phoneKey("555 123 456"));
});

