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
};

export function invoiceMessage(input: InvoiceMessageInput): string {
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
