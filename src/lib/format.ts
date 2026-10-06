/** PostgreSQL numeric values are exposed as text; never coerce stored amounts to JS Number. */
function decimal(value: string | number) {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error("Invalid decimal value");
  const [, sign, whole, fraction = ""] = match;
  const grouped = new Intl.NumberFormat("ru-RU").format(BigInt(whole));
  const tail = fraction.replace(/0+$/, "");
  return sign + grouped + (tail ? "," + tail : "");
}
// Знак валюты — как CURRENCY_SIGN в currency.ts (здесь без импорта: файл
// читают тесты напрямую). Без валюты — сом, как раньше.
const SIGN: Record<string, string> = { KGS: "сом", USD: "$", RUB: "₽" };
export const money = (value: number | string, currency: string | null = "KGS") =>
  decimal(value) + " " + (SIGN[currency ?? "KGS"] ?? "сом");
export const quantity = (value: number | string) => decimal(value);

/**
 * Запись в другой валюте, чем долг: «87 800 сом по 87,8». null — запись в
 * валюте долга (исходной суммы нет).
 */
export function originalAmountText(record: {
  original_amount?: string | number | null;
  original_currency?: string | null;
  fx_rate?: string | number | null;
}): string | null {
  if (record.original_amount == null || !record.original_currency || record.fx_rate == null) return null;
  const rate = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(Number(record.fx_rate));
  return `${money(record.original_amount, record.original_currency)} по ${rate}`;
}
export function decimalLessThan(a: string, b: string) {
  const scale = Math.max(
    (a.split(".")[1] ?? "").length,
    (b.split(".")[1] ?? "").length,
  );
  const integer = (v: string) => {
    const negative = v.startsWith("-");
    const [whole, part = ""] = v.replace(/^-/, "").split(".");
    return (negative ? -1n : 1n) * BigInt(whole + part.padEnd(scale, "0"));
  };
  return integer(a) < integer(b);
}

/**
 * Телефон для печати и экрана — с пробелами: «+996 773 033 399»,
 * «0773 033 399». Что не похоже на кыргызский номер — как ввели.
 */
export function phoneText(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const group = (d: string) => `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (digits.length === 12 && digits.startsWith("996")) return `+996 ${group(digits.slice(3))}`;
  if (digits.length === 10 && digits.startsWith("0")) return `0${group(digits.slice(1))}`;
  if (digits.length === 9 && !raw.startsWith("+")) return `+996 ${group(digits)}`;
  return raw;
}

/**
 * Долг без знака «−» (задача 5): долг — сумма, переплата — «аванс 850 сом».
 */
export function debtMoney(value: number | string, currency: string | null = "KGS"): string {
  const text = String(value);
  if (Number(text) === 0) return money("0", currency);
  return text.startsWith("-") ? `аванс ${money(text.slice(1), currency)}` : money(text, currency);
}
