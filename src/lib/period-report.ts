import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bishkekDate, dayBounds } from "./day-summary";
import type { Period } from "./periods";
import { isCurrency, type Currency } from "./currency";
import { foreignParties, recordCurrency } from "./party-currency";

/**
 * Итоги периода — по тем же правилам, что Итог дня: без переносов из тетради
 * и отменённых. Основные цифры, графики и должники — в валюте магазина;
 * контрагенты в другой валюте (Хороз в долларах) — отдельно в `foreign`.
 */
export type PeriodTotals = {
  sold: number;
  soldCredit: number;
  soldCash: number;
  salesCount: number;
  collected: number;
  purchased: number;
  paidSuppliers: number;
  /** Расходы магазина (в валюте магазина; в `foreign` всегда 0). */
  expenses: number;
};
export type PeriodDay = { date: string; sold: number; collected: number };
export type Debtor = { id: string; name: string; balance: number; oldestDays: number | null };

export type PeriodReport = {
  currency: Currency;
  /** Текущий период в других валютах — не складывается с основными цифрами. */
  foreign: { currency: Currency; current: PeriodTotals }[];
  current: PeriodTotals;
  previous: PeriodTotals;
  days: PeriodDay[];
  topDebtors: Debtor[];
};

const empty = (): PeriodTotals => ({
  sold: 0,
  soldCredit: 0,
  soldCash: 0,
  salesCount: 0,
  collected: 0,
  purchased: 0,
  paidSuppliers: 0,
  expenses: 0,
});

// Суммы копим в тийынах — без ошибок float на длинных периодах.
const cents = (value: string | number) => Math.round(Number(value) * 100);
const toSom = (t: PeriodTotals): PeriodTotals =>
  Object.fromEntries(
    Object.entries(t).map(([k, v]) => [k, k === "salesCount" ? v : v / 100]),
  ) as PeriodTotals;

export async function periodReport(
  db: SupabaseClient,
  organizationId: string,
  period: Period,
): Promise<PeriodReport> {
  const from = dayBounds(period.previous.start).start;
  const to = dayBounds(period.end).end;
  const rows = (table: "sales" | "purchases" | "payments", columns: string) =>
    db
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId)
      .eq("status", table === "payments" ? "confirmed" : "posted")
      .is("reversed_at", null)
      .eq("is_opening", false)
      .gte("occurred_at", from)
      .lt("occurred_at", to)
      .range(0, 9999);
  const org = await db.from("organizations").select("currency").eq("id", organizationId).maybeSingle();
  const shopCurrency: Currency = isCurrency(org.data?.currency) ? org.data.currency : "KGS";
  const [sales, purchases, payments, customers, aging, foreignMap, expenses] = await Promise.all([
    rows("sales", "customer_id,total,paid_immediately,occurred_at"),
    rows("purchases", "supplier_id,total,occurred_at"),
    rows("payments", "customer_id,supplier_id,amount,direction,occurred_at,kind"),
    db
      .from("customer_balances")
      .select("id,name,balance,currency")
      .eq("organization_id", organizationId)
      .range(0, 4999),
    db
      .from("customer_debt_aging")
      .select("customer_id,oldest_days")
      .eq("organization_id", organizationId)
      .range(0, 4999),
    foreignParties(db, organizationId, shopCurrency),
    db
      .from("expenses")
      .select("spent_on,amount")
      .eq("organization_id", organizationId)
      .eq("currency", shopCurrency)
      .is("reversed_at", null)
      .gte("spent_on", period.previous.start)
      .lte("spent_on", period.end)
      .range(0, 9999),
  ]);
  if (sales.error || purchases.error || payments.error || customers.error)
    throw new Error("Не удалось загрузить итоги периода");

  const current = empty();
  const previous = empty();
  const foreignCurrent = new Map<Currency, PeriodTotals>();
  const byDay = new Map(period.days.map((date) => [date, { date, sold: 0, collected: 0 }]));
  // Запись контрагента в другой валюте — только в `foreign` текущего периода.
  const bucket = (date: string, row: { customer_id?: string | null; supplier_id?: string | null }) => {
    const cur = recordCurrency(row, foreignMap, shopCurrency);
    if (cur !== shopCurrency) {
      if (!(date >= period.start && date <= period.end)) return null;
      if (!foreignCurrent.has(cur)) foreignCurrent.set(cur, empty());
      return foreignCurrent.get(cur)!;
    }
    return date >= period.start && date <= period.end
      ? current
      : date >= period.previous.start && date <= period.previous.through
        ? previous
        : null;
  };

  for (const r of (sales.data ?? []) as unknown as { customer_id: string; total: string; paid_immediately: boolean; occurred_at: string }[]) {
    const date = bishkekDate(r.occurred_at);
    const t = bucket(date, r);
    if (!t) continue;
    const amount = cents(r.total);
    t.sold += amount;
    t.salesCount += 1;
    if (r.paid_immediately) t.soldCash += amount;
    else t.soldCredit += amount;
    if (t === current) byDay.get(date)!.sold += amount;
  }
  for (const r of (purchases.data ?? []) as unknown as { supplier_id: string; total: string; occurred_at: string }[]) {
    const t = bucket(bishkekDate(r.occurred_at), r);
    if (t) t.purchased += cents(r.total);
  }
  for (const r of (payments.data ?? []) as unknown as {
    customer_id: string | null;
    supplier_id: string | null;
    amount: string;
    direction: string;
    occurred_at: string;
    kind: string;
  }[]) {
    if (r.kind !== "payment") continue; // скидки и возвраты — не деньги
    const date = bishkekDate(r.occurred_at);
    const t = bucket(date, r);
    if (!t) continue;
    if (r.direction === "incoming") {
      t.collected += cents(r.amount);
      if (t === current) byDay.get(date)!.collected += cents(r.amount);
    } else t.paidSuppliers += cents(r.amount);
  }

  for (const r of (expenses.data ?? []) as { spent_on: string; amount: string }[]) {
    const t = bucket(r.spent_on, {});
    if (t) t.expenses += cents(r.amount);
  }

  const oldest = new Map(
    ((aging.data ?? []) as { customer_id: string; oldest_days: number }[]).map((a) => [a.customer_id, a.oldest_days]),
  );
  const topDebtors = ((customers.data ?? []) as { id: string; name: string; balance: string; currency: string | null }[])
    .filter((c) => (c.currency ?? shopCurrency) === shopCurrency)
    .map((c) => ({ id: c.id, name: c.name, balance: Number(c.balance), oldestDays: oldest.get(c.id) ?? null }))
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);

  return {
    currency: shopCurrency,
    foreign: [...foreignCurrent.entries()].map(([currency, t]) => ({ currency, current: toSom(t) })),
    current: toSom(current),
    previous: toSom(previous),
    days: [...byDay.values()].map((d) => ({ date: d.date, sold: d.sold / 100, collected: d.collected / 100 })),
    topDebtors,
  };
}
