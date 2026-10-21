import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MESSAGE_TEMPLATE, invoiceMessage, templateInput } from "../src/lib/invoice-message.ts";

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

test("invoiceMessage: shop template fills placeholders, links always added at the end", () => {
  const template = "Салам, {клиент}! {сумма} от {дата}\nДолг: {долг}\n{магазин}";
  assert.equal(
    invoiceMessage({ ...base, template }),
    [
      "Салам, Маликнур! 54 270 сом от 27 сент. 2026 г.",
      "Долг: 60 000 сом",
      "Магазин A",
      "Накладная: https://x/c/t/invoice/s",
      "Посмотреть и оплатить: https://x/c/t",
    ].join("\n"),
  );
});

test("invoiceMessage: template without any placeholders still carries the links", () => {
  assert.equal(
    invoiceMessage({ ...base, template: "Спасибо за покупку!" }),
    ["Спасибо за покупку!", "Накладная: https://x/c/t/invoice/s", "Посмотреть и оплатить: https://x/c/t"].join("\n"),
  );
});

test("invoiceMessage: template drops lines with nothing to show", () => {
  const text = invoiceMessage({
    ...base,
    template: DEFAULT_MESSAGE_TEMPLATE + "\nСпасибо!",
    invoiceUrl: null,
    debtUrl: null,
    balance: 0,
    paidImmediately: true,
  });
  assert.equal(
    text,
    ["Здравствуйте, Маликнур!", "Накладная от 27 сент. 2026 г. на 54 270 сом (оплачено).", "Магазин A", "Спасибо!"].join("\n"),
  );
  assert.match(invoiceMessage({ ...base, template: "{неизвестно} {клиент}" }), /^\{неизвестно\} Маликнур\n/);
});

test("templateInput: empty or default text means the standard message", () => {
  assert.equal(templateInput("   "), null);
  assert.equal(templateInput(DEFAULT_MESSAGE_TEMPLATE.replace(/\n/g, "\r\n") + "\n"), null);
  assert.equal(templateInput(" Привет, {клиент} "), "Привет, {клиент}");
});
