import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceMessage } from "../src/lib/invoice-message.ts";

const base = {
  customerName: "Маликнур",
  shopName: "Магазин A",
  date: "27 сент. 2026 г.",
  total: "54 270 сом",
  paidImmediately: false,
  balance: 60000,
  balanceText: "60 000 сом",
  advanceText: "",
  invoiceUrl: "https://x/c/t/invoice/s",
  debtUrl: "https://x/c/t",
};

test("invoiceMessage: digitized sale carries the PDF link, debt and debt page", () => {
  assert.equal(
    invoiceMessage(base),
    [
      "Здравствуйте, Маликнур!",
      "Накладная от 27 сент. 2026 г. на 54 270 сом.",
      "Накладная: https://x/c/t/invoice/s",
      "Ваш долг: 60 000 сом.",
      "Посмотреть и оплатить: https://x/c/t",
      "Магазин A",
    ].join("\n"),
  );
});

test("invoiceMessage: without a checked invoice or link only the debt is sent", () => {
  const text = invoiceMessage({ ...base, invoiceUrl: null, debtUrl: null });
  assert.match(text, /^Здравствуйте, Маликнур!\nПродажа от /);
  assert.doesNotMatch(text, /https:/);
});

test("invoiceMessage: attached PDF file needs no PDF link", () => {
  const text = invoiceMessage({ ...base, invoiceUrl: null, invoiceAttached: true });
  assert.match(text, /\nНакладная от 27 сент\. 2026 г\. на 54 270 сом\.\nВаш долг/);
});

test("invoiceMessage: paid sale, zero balance and advance wording", () => {
  assert.match(invoiceMessage({ ...base, paidImmediately: true }), /54 270 сом \(оплачено\)\./);
  assert.match(invoiceMessage({ ...base, balance: 0 }), /\nДолга нет\.\n/);
  assert.match(
    invoiceMessage({ ...base, balance: -500, advanceText: "500 сом" }),
    /Долга нет, аванс: 500 сом\./,
  );
});
