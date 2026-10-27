/**
 * Прокат (модуль rental, просьба пользователя 26.10.2026): вещи со склада
 * на несколько дней под залог. Деньги — продажей одной суммой, что на руках —
 * rentals / rental_items (20261102100000_rentals.sql). Здесь — расчёты для
 * формы и списков, без базы.
 */

export const COLLATERAL_KINDS = ["passport", "license", "id_card", "other", "none"] as const;
export type CollateralKind = (typeof COLLATERAL_KINDS)[number];

export const COLLATERAL_LABEL: Record<CollateralKind, string> = {
  passport: "Паспорт",
  license: "Права",
  id_card: "Удостоверение",
  other: "Другое",
  none: "Без документа",
};

export const isCollateralKind = (value: unknown): value is CollateralKind =>
  typeof value === "string" && (COLLATERAL_KINDS as readonly string[]).includes(value);

/** «Паспорт · Медина»; без документа — null. */
export function collateralText(kind: string, note: string | null): string | null {
  if (!isCollateralKind(kind) || kind === "none") return note || null;
  return note ? `${COLLATERAL_LABEL[kind]} · ${note}` : COLLATERAL_LABEL[kind];
}

export const MAX_DAYS = 365;

const round = (n: number) => Math.round(n * 100) / 100;

/** Сумма за прокат: цены за сутки всех вещей × дни. */
export const rentalTotal = (pricesPerDay: readonly number[], days: number) =>
  round(pricesPerDay.reduce((s, p) => s + p, 0) * days);

/** Вернуть до: день выдачи (ГГГГ-ММ-ДД) + дни. */
export function dueDay(issuedDay: string, days: number): string {
  return new Date(Date.parse(`${issuedDay}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** Сколько дней просрочено к `today` (0 — в срок). */
export function overdueDays(dueOn: string, today: string): number {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86400000);
  return diff > 0 ? diff : 0;
}

/** Доплата за лишние дни — по той же цене за сутки тех вещей, что были на руках. */
export const extraCharge = (pricesPerDay: readonly number[], lateDays: number) =>
  lateDays > 0 ? rentalTotal(pricesPerDay, lateDays) : 0;

/** «1 день», «2 дня», «5 дней». */
export function daysWord(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return `${n} дней`;
  const last = n % 10;
  return `${n} ${last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней"}`;
}

/** Напоминание в WhatsApp: что вернуть и до какого дня (`due` — «28 октября»). */
export function rentalReminder(shopName: string, things: readonly string[], due: string, late: boolean): string {
  return `Здравствуйте! Магазин «${shopName}»: напоминаем вернуть ${things.join(", ")} ${late ? `- срок был ${due}` : `до ${due}`}. Спасибо!`;
}

/**
 * Сколько из продажи ещё не оплачено, если деньги клиента гасят сначала
 * старый долг (как в тетради): не оплачены самые новые продажи в долг на
 * сумму долга. `creditSales` — продажи клиента в долг от новых к старым,
 * `balance` — его долг сейчас. Нет такой продажи — 0.
 */
export function unpaidOf(saleId: string, balance: number, creditSales: readonly { id: string; total: number }[]): number {
  let left = Math.max(balance, 0);
  for (const s of creditSales) {
    const unpaid = Math.min(s.total, left);
    if (s.id === saleId) return Math.round(unpaid * 100) / 100;
    left -= unpaid;
    if (left <= 0) return 0;
  }
  return 0;
}
