import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, phoneKey, parseVcards, storedPhone } from "../src/lib/contacts.ts";

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

test("parseVcards: iPhone vCard 3.0 with several contacts", () => {
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:Асанов;Малик;;;",
    "FN:Малик Асанов",
    "item1.TEL;type=pref:+996 555 123 456",
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:;Прораб Нурбек;;;",
    "TEL;type=CELL:0700 11 22 33",
    "TEL;type=WORK:0312 00 00 00",
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Без телефона",
    "END:VCARD",
  ].join("\r\n");
  assert.deepEqual(parseVcards(vcf), [
    { name: "Малик Асанов", phone: "+996555123456" },
    { name: "Прораб Нурбек", phone: "+996700112233" },
  ]);
});

test("parseVcards: old Android vCard 2.1 with quoted-printable Cyrillic and folded lines", () => {
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:2.1",
    "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D0=90=D1=81=D0=B0=D0=BD=",
    "=20=D0=A1=D0=BA=D0=BB=D0=B0=D0=B4",
    "TEL;CELL:+996-777-000-111",
    "END:VCARD",
  ].join("\r\n");
  assert.deepEqual(parseVcards(vcf), [{ name: "Асан Склад", phone: "+996777000111" }]);
});

test("parseVcards: a base64 photo ending with = does not swallow the phone line", () => {
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:С фото",
    "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRg==",
    "TEL;type=CELL:0555 000 111",
    "END:VCARD",
  ].join("\n");
  assert.deepEqual(parseVcards(vcf), [{ name: "С фото", phone: "+996555000111" }]);
});
