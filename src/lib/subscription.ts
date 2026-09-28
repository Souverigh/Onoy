/**
 * Состояние подписки магазина (ТЗ §13): за 5 дней до конца — напоминание,
 * после конца — 7 льготных дней, затем «только просмотр» (его же ставит
 * триггер в базе, private.shop_read_only). Блокировка админом — отдельно.
 * paid_until = null — оплата не отмечена (пилот), ограничений нет.
 */
export type SubscriptionState =
  | { kind: "ok" }
  | { kind: "ending"; paidUntil: string; daysLeft: number }
  | { kind: "grace"; paidUntil: string; graceUntil: string }
  | { kind: "expired"; paidUntil: string }
  | { kind: "blocked"; reason: string };

export const GRACE_DAYS = 7;
export const REMIND_DAYS = 5;

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;
const plus = (d: string, n: number) => new Date((day(d) + n) * 86400000).toISOString().slice(0, 10);

export function subscriptionState(
  paidUntil: string | null,
  blockedReason: string | null | undefined,
  blocked: boolean,
  today: string,
): SubscriptionState {
  if (blocked) return { kind: "blocked", reason: blockedReason ?? "" };
  if (!paidUntil) return { kind: "ok" };
  const left = day(paidUntil) - day(today);
  if (left >= 0) return left <= REMIND_DAYS ? { kind: "ending", paidUntil, daysLeft: left } : { kind: "ok" };
  const graceUntil = plus(paidUntil, GRACE_DAYS);
  return today <= graceUntil ? { kind: "grace", paidUntil, graceUntil } : { kind: "expired", paidUntil };
}
