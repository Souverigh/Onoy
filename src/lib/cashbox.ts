// Касса дня (задача 1): только наличные в валюте магазина. Переводы и
// подтверждённые заявки «Я оплатил» — отдельной строкой, в кассу не входят.
// Без server-only: считают тесты.

export type PaymentMethod = "cash" | "transfer";

export type MoneyRow = {
  amount: string | number;
  original_amount?: string | number | null;
  original_currency?: string | null;
};

export type CashPayment = MoneyRow & {
  direction: string;
  method?: string | null;
  bank_reference?: string | null;
  document_id?: string | null;
  /** Заявку «Я оплатил» вносит клиент без входа — автора нет. */
  created_by?: string | null;
};

/**
 * Перевод или наличные. Новые оплаты помнят выбор продавца; у старых —
 * перевод, если есть номер перевода, чек или это заявка клиента.
 */
export function paymentMethod(p: CashPayment): PaymentMethod {
  if (p.method === "cash" || p.method === "transfer") return p.method;
  return p.bank_reference || p.document_id || p.created_by === null ? "transfer" : "cash";
}

/**
 * Сумма записи в валюте магазина: исходная, если вносили в ней (3 000 сом
 * Хорозу за долг в $), или сама сумма, если долг в валюте магазина. Иначе —
 * null: доллары в сомовую кассу не складываются.
 */
export function shopAmount(row: MoneyRow, partyCurrency: string, shopCurrency: string): number | null {
  if (row.original_currency && row.original_amount != null)
    return row.original_currency === shopCurrency ? Number(row.original_amount) : null;
  return partyCurrency === shopCurrency ? Number(row.amount) : null;
}

export type Cashbox = {
  /** Наличные продажи («сразу оплатили») и наличные от клиентов. */
  cashIn: number;
  /** Наличные поставщикам. */
  cashOut: number;
  expenses: number;
  /** Должно быть в кассе за день. */
  left: number;
  /** Переводы и подтверждённые заявки — не в кассе. */
  transferIn: number;
  transferOut: number;
};

const round = (n: number) => Math.round(n * 100) / 100;

export function cashbox(input: {
  shopCurrency: string;
  cashSales: (MoneyRow & { currency: string })[];
  payments: (CashPayment & { currency: string })[];
  expenses: number;
}): Cashbox {
  let cashIn = 0;
  let cashOut = 0;
  let transferIn = 0;
  let transferOut = 0;
  for (const sale of input.cashSales) cashIn += shopAmount(sale, sale.currency, input.shopCurrency) ?? 0;
  for (const p of input.payments) {
    const value = shopAmount(p, p.currency, input.shopCurrency);
    if (value == null) continue;
    const transfer = paymentMethod(p) === "transfer";
    if (p.direction === "incoming") {
      if (transfer) transferIn += value;
      else cashIn += value;
    } else if (transfer) transferOut += value;
    else cashOut += value;
  }
  return {
    cashIn: round(cashIn),
    cashOut: round(cashOut),
    expenses: round(input.expenses),
    left: round(cashIn - cashOut - input.expenses),
    transferIn: round(transferIn),
    transferOut: round(transferOut),
  };
}
