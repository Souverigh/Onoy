/**
 * Текст сообщения клиенту о продаже (ТЗ §4 Б). Суммы приходят уже
 * отформатированными (money), баланс — числом: от знака зависит фраза.
 */
export type InvoiceMessageInput = {
  customerName: string;
  shopName: string;
  date: string;
  total: string;
  paidImmediately: boolean;
  balance: number;
  balanceText: string;
  advanceText: string;
  /** Ссылка на PDF накладной; null — накладная не сверена или нет ссылки клиента. */
  invoiceUrl: string | null;
  /** PDF приложен к сообщению файлом — ссылка на него не нужна. */
  invoiceAttached?: boolean;
  /** Страница клиента с долгом; null — ссылка отозвана. */
  debtUrl: string | null;
  /** Свой текст магазина (Настройки → Магазин); пусто — стандартный. */
  template?: string | null;
};

/** Длина своего текста — как ограничение в базе (invoice_message_template.sql). */
export const MESSAGE_TEMPLATE_MAX = 1000;

/** Подстановки для своего текста — подсказка в настройках. */
export const MESSAGE_PLACEHOLDERS: { key: string; text: string }[] = [
  { key: "{клиент}", text: "имя клиента" },
  { key: "{дата}", text: "дата продажи" },
  { key: "{сумма}", text: "сумма продажи (и «оплачено», если за наличные)" },
  { key: "{долг}", text: "долг клиента после продажи" },
  { key: "{магазин}", text: "название магазина" },
];

/**
 * Ссылки в своём тексте не правятся: они всегда добавляются в конец сами,
 * чтобы владелец случайно не стёр накладную или «Оплатить». Здесь — как они
 * выглядят в настройках.
 */
export const MESSAGE_LINK_LINES = ["Накладная: ссылка на накладную", "Посмотреть и оплатить: ссылка на страницу клиента"];

/** Свой текст по умолчанию — так выглядит стандартное сообщение (ссылки добавятся сами). */
export const DEFAULT_MESSAGE_TEMPLATE = [
  "Здравствуйте, {клиент}!",
  "Накладная от {дата} на {сумма}.",
  "Ваш долг: {долг}.",
  "{магазин}",
].join("\n");

/** Текст из настроек: пусто или как по умолчанию — null (стандартный текст). */
export function templateInput(raw: string): string | null {
  const text = raw.replace(/\r\n/g, "\n").trim().slice(0, MESSAGE_TEMPLATE_MAX);
  return text && text !== DEFAULT_MESSAGE_TEMPLATE ? text : null;
}

export function invoiceMessage(input: InvoiceMessageInput): string {
  if (input.template?.trim()) return fromTemplate(input.template, input);
  const lines = [
    `Здравствуйте, ${input.customerName}!`,
    `${input.invoiceUrl || input.invoiceAttached ? "Накладная" : "Продажа"} от ${input.date} на ${input.total}${input.paidImmediately ? " (оплачено)" : ""}.`,
  ];
  if (input.invoiceUrl) lines.push(`Накладная: ${input.invoiceUrl}`);
  lines.push(
    input.balance > 0
      ? `Ваш долг: ${input.balanceText}.`
      : input.balance < 0
        ? `Долга нет, аванс: ${input.advanceText}.`
        : "Долга нет.",
  );
  if (input.debtUrl) lines.push(`Посмотреть и оплатить: ${input.debtUrl}`);
  lines.push(input.shopName);
  return lines.join("\n");
}

/**
 * Свой текст: подстановки заменяются значениями. Строка, где подстановке
 * нечего показать (например, долга нет), убирается целиком. Ссылки на
 * накладную и страницу клиента — всегда в конце, в тексте их нет.
 */
function fromTemplate(template: string, input: InvoiceMessageInput): string {
  const values: Record<string, string> = {
    клиент: input.customerName,
    дата: input.date,
    сумма: `${input.total}${input.paidImmediately ? " (оплачено)" : ""}`,
    долг: input.balance > 0 ? input.balanceText : "",
    магазин: input.shopName,
  };
  const out: string[] = [];
  for (const line of template.replace(/\r\n/g, "\n").split("\n")) {
    let empty = false;
    const filled = line.replace(/\{([а-яё]+)\}/gi, (match, name: string) => {
      const value = values[name.toLowerCase()];
      if (value === undefined) return match;
      if (!value) empty = true;
      return value;
    });
    if (!empty) out.push(filled);
  }
  const links = [
    input.invoiceUrl ? `Накладная: ${input.invoiceUrl}` : null,
    input.debtUrl ? `Посмотреть и оплатить: ${input.debtUrl}` : null,
  ].filter((line): line is string => Boolean(line));
  return [out.join("\n").trim(), ...links].filter(Boolean).join("\n");
}
