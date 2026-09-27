import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bishkekDate, dayBounds } from "./day-summary";
import type { Period } from "./periods";

/** Итоги периода — по тем же правилам, что Итог дня: без переносов из тетради и отменённых. */
export type PeriodTotals = {
  sold: number;
  soldCredit: number;
  soldCash: number;
  salesCount: number;
  collected: number;
  purchased: number;
  paidSuppliers: number;
};
export type PeriodDay = { date: string; sold: number; collected: number };
export type Debtor = { id: string; name: string; balance: number; oldestDays: number | null };

export type PeriodReport = {
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
  const [sales, purchases, payments, customers, aging] = await Promise.all([
    rows("sales", "total,paid_immediately,occurred_at"),
    rows("purchases", "total,occurred_at"),
    rows("payments", "amount,direction,occurred_at,kind"),
    db
      .from("customer_balances")
      .select("id,name,balance")
      .eq("organization_id", organizationId)
      .range(0, 4999),
    db
      .from("customer_debt_aging")
      .select("customer_id,oldest_days")
      .eq("organization_id", organizationId)
      .range(0, 4999),
  ]);
  if (sales.error || purchases.error || payments.error || customers.error)
    throw new Error("Не удалось загрузить итоги периода");

  const current = empty();
  const previous = empty();
  const byDay = new Map(period.days.map((date) => [date, { date, sold: 0, collected: 0 }]));
  const bucket = (date: string) =>
    date >= period.start && date <= period.end
      ? current
      : date >= period.previous.start && date <= period.previous.through
        ? previous
        : null;

  for (const r of (sales.data ?? []) as unknown as { total: string; paid_immediately: boolean; occurred_at: string }[]) {
    const date = bishkekDate(r.occurred_at);
    const t = bucket(date);
    if (!t) continue;
    const amount = cents(r.total);
    t.sold += amount;
    t.salesCount += 1;
    if (r.paid_immediately) t.soldCash += amount;
    else t.soldCredit += amount;
    if (t === current) byDay.get(date)!.sold += amount;
  }
  for (const r of (purchases.data ?? []) as unknown as { total: string; occurred_at: string }[]) {
    const t = bucket(bishkekDate(r.occurred_at));
    if (t) t.purchased += cents(r.total);
  }
  for (const r of (payments.data ?? []) as unknown as {
    amount: string;
    direction: string;
    occurred_at: string;
    kind: string;
  }[]) {
    if (r.kind !== "payment") continue; // скидки и возвраты — не деньги
    const date = bishkekDate(r.occurred_at);
    const t = bucket(date);
    if (!t) continue;
    if (r.direction === "incoming") {
      t.collected += cents(r.amount);
      if (t === current) byDay.get(date)!.collected += cents(r.amount);
    } else t.paidSuppliers += cents(r.amount);
  }

  const oldest = new Map(
    ((aging.data ?? []) as { customer_id: string; oldest_days: number }[]).map((a) => [a.customer_id, a.oldest_days]),
  );
  const topDebtors = ((customers.data ?? []) as { id: string; name: string; balance: string }[])
    .map((c) => ({ id: c.id, name: c.name, balance: Number(c.balance), oldestDays: oldest.get(c.id) ?? null }))
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);

  return {
    current: toSom(current),
    previous: toSom(previous),
    days: [...byDay.values()].map((d) => ({ date: d.date, sold: d.sold / 100, collected: d.collected / 100 })),
    topDebtors,
  };
}
