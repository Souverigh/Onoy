/**
 * Валюты (ТЗ §6, §15.2): сом, доллар, рубль. Долг ведётся в валюте
 * контрагента (null — валюта магазина); запись в другой валюте
 * пересчитывается по курсу, исходная сумма и курс хранятся рядом (миграция
 * currencies.sql). Курс — как его называют люди: сколько более слабой
 * валюты за одну более сильную (1 $ = 87,80 сом).
 */
export const CURRENCIES = ["KGS", "USD", "RUB"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_SIGN: Record<Currency, string> = { KGS: "сом", USD: "$", RUB: "₽" };
export const CURRENCY_NAME: Record<Currency, string> = { KGS: "сом", USD: "доллар", RUB: "рубль" };

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** Валюта долга: своя у контрагента или магазина. */
export function partyCurrency(party: { currency?: string | null } | null | undefined, shop: Currency): Currency {
  return isCurrency(party?.currency) ? party.currency : shop;
}

const RANK: Record<Currency, number> = { USD: 3, RUB: 2, KGS: 1 };

/** Пара для курса: [сильная, слабая] — «1 сильная = rate слабой». */
export function ratePair(a: Currency, b: Currency): [Currency, Currency] {
  return RANK[a] > RANK[b] ? [a, b] : [b, a];
}

/**
 * Сумма из `from` в `to` по курсу пары — как private.converted_amount в
 * базе (там итог и считается; здесь — показать продавцу до записи).
 * В тийынах/копейках, чтобы не ловить ошибки float.
 */
export function convertAmount(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  if (!(rate > 0)) return 0;
  const value = RANK[from] > RANK[to] ? amount * rate : amount / rate;
  return Math.round(value * 100) / 100;
}

/** Курс из поля формы: «87,80» → "87.8"; мусор — null. До 6 знаков после запятой. */
export function rateInput(raw: string): string | null {
  const text = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,6})?$/.test(text) || !(Number(text) > 0)) return null;
  return String(Number(text));
}

/** «87,8» — курс для показа, без лишних нулей. */
export function formatRate(rate: number | string): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(Number(rate));
}
