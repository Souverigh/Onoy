/**
 * Лимит долга клиента (ТЗ §4 Б). Продажа за наличные долг не меняет, поэтому
 * её не проверяем. Суммы — в тийынах, чтобы не ловить ошибки float на
 * границе лимита.
 */
export type LimitCheck = { debtAfter: number; limit: number; alreadyOver: boolean };

const cents = (value: string | number) => Math.round(Number(value) * 100);

/** Сумма из поля формы: "54 270", "1250,5" → число; нечитаемое — 0. */
export function amountFromInput(raw: string): number {
  const n = Number(raw.replace(/[\s ']/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** null — лимита нет или он не превышен. */
export function creditLimitExceeded(
  balance: string | number,
  limit: string | number | null | undefined,
  saleAmount: number,
  paidImmediately: boolean,
): LimitCheck | null {
  if (limit == null || limit === "") return null;
  const limitCents = cents(limit);
  const balanceCents = cents(balance);
  const afterCents = balanceCents + (paidImmediately ? 0 : cents(saleAmount));
  if (afterCents <= limitCents) return null;
  return {
    debtAfter: afterCents / 100,
    limit: limitCents / 100,
    alreadyOver: balanceCents > limitCents,
  };
}
