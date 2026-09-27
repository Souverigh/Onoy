import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** День по Бишкеку (YYYY-MM-DD): сменяется в 00:00 UTC+6. */
export function bishkekDate(value: string | Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function dayBounds(date: string) {
  const start = new Date(`${date}T00:00:00+06:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type PartyAmount = { id: string; name: string; amount: number };

/**
 * Итог дня. Хранится как снимок в day_closures.snapshot при «Закрыть день»,
 * поэтому только простые значения (JSON) и поле version на случай изменений.
 */
export type DaySummary = {
  version: 1;
  date: string;
  computedAt: string;
  sold: { total: number; credit: number; cash: number; count: number };
  collected: { total: number; cash: number; transfer: number };
  creditByCustomer: PartyAmount[];
  paidByCustomer: PartyAmount[];
  receivable: { morning: number; evening: number };
  suppliers: { purchased: number; paid: number; morning: number; evening: number };
  pendingClaims: number;
};

const sum = <T>(rows: T[], pick: (row: T) => string | number) =>
  Math.round(rows.reduce((s, r) => s + Number(pick(r)), 0) * 100) / 100;

/**
 * Считает итог дня по действующим записям. Перенос тетради (is_opening) —
 * не продажа и не оплата дня; долги на конец прошедшего дня = текущий долг
 * минус всё, что было после конца того дня.
 */
export async function computeDaySummary(
  db: SupabaseClient,
  organizationId: string,
  date: string,
): Promise<DaySummary> {
  const { start, end } = dayBounds(date);
  const isToday = date === bishkekDate();
  const [sales, payments, purchases, pending, later, customerBalances, supplierBalances] =
    await Promise.all([
      db
        .from("sales")
        .select("customer_id,total,paid_immediately")
        .eq("organization_id", organizationId)
        .eq("status", "posted")
        .is("reversed_at", null)
        .eq("is_opening", false)
        .gte("occurred_at", start)
        .lt("occurred_at", end),
      db
        .from("payments")
        .select("customer_id,direction,amount,bank_reference")
        .eq("organization_id", organizationId)
        .eq("status", "confirmed")
        .is("reversed_at", null)
        .eq("is_opening", false)
        .gte("occurred_at", start)
        .lt("occurred_at", end),
      db
        .from("purchases")
        .select("total")
        .eq("organization_id", organizationId)
        .eq("status", "posted")
        .is("reversed_at", null)
        .eq("is_opening", false)
        .gte("occurred_at", start)
        .lt("occurred_at", end),
      db
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "pending"),
      isToday ? Promise.resolve(null) : laterMovements(db, organizationId, end),
      db.from("customer_balances").select("balance").eq("organization_id", organizationId),
      db.from("supplier_balances").select("balance").eq("organization_id", organizationId),
    ]);
  if (sales.error || payments.error || purchases.error || customerBalances.error || supplierBalances.error)
    throw new Error("Не удалось загрузить итог дня");

  const saleRows = sales.data ?? [];
  const creditSales = saleRows.filter((s) => !s.paid_immediately);
  const cashSales = saleRows.filter((s) => s.paid_immediately);
  const incoming = (payments.data ?? []).filter((p) => p.direction === "incoming");
  const outgoing = (payments.data ?? []).filter((p) => p.direction === "outgoing");

  const byCustomer = (rows: { customer_id: string | null; value: string }[]) => {
    const totals = new Map<string, number>();
    for (const row of rows)
      if (row.customer_id)
        totals.set(row.customer_id, (totals.get(row.customer_id) ?? 0) + Number(row.value));
    return totals;
  };
  const creditTotals = byCustomer(creditSales.map((r) => ({ customer_id: r.customer_id, value: r.total })));
  const paidTotals = byCustomer(incoming.map((r) => ({ customer_id: r.customer_id, value: r.amount })));
  const ids = [...new Set([...creditTotals.keys(), ...paidTotals.keys()])];
  const names = new Map<string, string>();
  if (ids.length) {
    const lookup = await db
      .from("customers")
      .select("id,name")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const c of lookup.data ?? []) names.set(c.id, c.name);
  }
  const list = (totals: Map<string, number>): PartyAmount[] =>
    [...totals.entries()]
      .map(([id, amount]) => ({ id, name: names.get(id) ?? "Клиент", amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);

  const soldCredit = sum(creditSales, (s) => s.total);
  const soldCash = sum(cashSales, (s) => s.total);
  const collectedCash = sum(incoming.filter((p) => !p.bank_reference), (p) => p.amount);
  const collectedTransfer = sum(incoming.filter((p) => p.bank_reference), (p) => p.amount);
  const purchased = sum(purchases.data ?? [], (p) => p.total);
  const paidSuppliers = sum(outgoing, (p) => p.amount);

  const receivableEvening = sum(customerBalances.data ?? [], (c) => c.balance) - (later?.receivable ?? 0);
  const payableEvening = sum(supplierBalances.data ?? [], (c) => c.balance) - (later?.payable ?? 0);
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    version: 1,
    date,
    computedAt: new Date().toISOString(),
    sold: { total: round(soldCredit + soldCash), credit: soldCredit, cash: soldCash, count: saleRows.length },
    collected: { total: round(collectedCash + collectedTransfer), cash: collectedCash, transfer: collectedTransfer },
    creditByCustomer: list(creditTotals),
    paidByCustomer: list(paidTotals),
    receivable: {
      morning: round(receivableEvening - soldCredit + collectedCash + collectedTransfer),
      evening: round(receivableEvening),
    },
    suppliers: {
      purchased,
      paid: paidSuppliers,
      morning: round(payableEvening - purchased + paidSuppliers),
      evening: round(payableEvening),
    },
    pendingClaims: pending.count ?? 0,
  };
}

/** Как изменились долги начиная с момента `from` (действующие записи, включая перенос тетради). */
async function laterMovements(db: SupabaseClient, organizationId: string, from: string) {
  const [sales, payments, purchases] = await Promise.all([
    db
      .from("sales")
      .select("total")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .eq("paid_immediately", false)
      .is("reversed_at", null)
      .gte("occurred_at", from),
    db
      .from("payments")
      .select("direction,amount")
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .is("reversed_at", null)
      .gte("occurred_at", from),
    db
      .from("purchases")
      .select("total")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .is("reversed_at", null)
      .gte("occurred_at", from),
  ]);
  if (sales.error || payments.error || purchases.error)
    throw new Error("Не удалось загрузить итог дня");
  const pays = payments.data ?? [];
  return {
    receivable: sum(sales.data ?? [], (r) => r.total) - sum(pays.filter((p) => p.direction === "incoming"), (p) => p.amount),
    payable: sum(purchases.data ?? [], (r) => r.total) - sum(pays.filter((p) => p.direction === "outgoing"), (p) => p.amount),
  };
}

export type AfterCloseItem = {
  kind: "sale" | "purchase" | "payment";
  label: string;
  party: string;
  amount: number;
  at: string;
};

/**
 * Записи этого дня, внесённые или отменённые после закрытия: снимок не
 * меняется, а эти строки показываются отдельно («после закрытия»).
 */
export async function afterClosing(
  db: SupabaseClient,
  organizationId: string,
  date: string,
  closedAt: string,
): Promise<{ added: AfterCloseItem[]; reversed: AfterCloseItem[] }> {
  const { start, end } = dayBounds(date);
  // В формате «…Z»: «+00:00» из базы в строке фильтра превратился бы в пробел.
  const since = new Date(closedAt).toISOString();
  const [sales, payments, purchases] = await Promise.all([
    db
      .from("sales")
      .select("customer_id,total,paid_immediately,created_at,reversed_at")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .eq("is_opening", false)
      .gte("occurred_at", start)
      .lt("occurred_at", end)
      .or(`created_at.gt.${since},reversed_at.gt.${since}`),
    db
      .from("payments")
      .select("customer_id,supplier_id,direction,amount,created_at,reversed_at,status")
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .eq("is_opening", false)
      .gte("occurred_at", start)
      .lt("occurred_at", end)
      .or(`created_at.gt.${since},reversed_at.gt.${since}`),
    db
      .from("purchases")
      .select("supplier_id,total,created_at,reversed_at")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .eq("is_opening", false)
      .gte("occurred_at", start)
      .lt("occurred_at", end)
      .or(`created_at.gt.${since},reversed_at.gt.${since}`),
  ]);
  const customerIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const r of sales.data ?? []) customerIds.add(r.customer_id);
  for (const r of purchases.data ?? []) supplierIds.add(r.supplier_id);
  for (const r of payments.data ?? []) {
    if (r.customer_id) customerIds.add(r.customer_id);
    if (r.supplier_id) supplierIds.add(r.supplier_id);
  }
  const [customers, suppliers] = await Promise.all([
    customerIds.size
      ? db.from("customers").select("id,name").eq("organization_id", organizationId).in("id", [...customerIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supplierIds.size
      ? db.from("suppliers").select("id,name").eq("organization_id", organizationId).in("id", [...supplierIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const names = new Map<string, string>();
  for (const c of [...(customers.data ?? []), ...(suppliers.data ?? [])]) names.set(c.id, c.name);

  const items: (AfterCloseItem & { created_at: string; reversed_at: string | null })[] = [
    ...(sales.data ?? []).map((r) => ({
      kind: "sale" as const,
      label: r.paid_immediately ? "Продажа за наличные" : "Продажа в долг",
      party: names.get(r.customer_id) ?? "Клиент",
      amount: Number(r.total),
      at: r.created_at,
      created_at: r.created_at,
      reversed_at: r.reversed_at,
    })),
    ...(purchases.data ?? []).map((r) => ({
      kind: "purchase" as const,
      label: "Приход",
      party: names.get(r.supplier_id) ?? "Поставщик",
      amount: Number(r.total),
      at: r.created_at,
      created_at: r.created_at,
      reversed_at: r.reversed_at,
    })),
    ...(payments.data ?? []).map((r) => ({
      kind: "payment" as const,
      label: r.direction === "incoming" ? "Оплата от клиента" : "Оплата поставщику",
      party: names.get(r.customer_id ?? r.supplier_id ?? "") ?? "",
      amount: Number(r.amount),
      at: r.created_at,
      created_at: r.created_at,
      reversed_at: r.reversed_at,
    })),
  ];
  const closed = new Date(closedAt).getTime();
  const strip = ({ created_at: _c, reversed_at: _r, ...item }: (typeof items)[number]) => item;
  return {
    // Внесена после закрытия и не отменена — добавилась к дню.
    added: items
      .filter((i) => new Date(i.created_at).getTime() > closed && !i.reversed_at)
      .map(strip),
    // Была в снимке (внесена до закрытия), но отменена позже.
    reversed: items
      .filter(
        (i) =>
          i.reversed_at &&
          new Date(i.reversed_at).getTime() > closed &&
          new Date(i.created_at).getTime() <= closed,
      )
      .map((i) => ({ ...strip(i), at: i.reversed_at! })),
  };
}

export type DayHistoryRow = { date: string; sold: number; collected: number; purchased: number };

/** Короткий итог за последние дни — от нового к старому, включая пустые дни. */
export async function dayHistory(
  db: SupabaseClient,
  organizationId: string,
  days: number,
): Promise<DayHistoryRow[]> {
  const today = bishkekDate();
  const from = new Date(new Date(dayBounds(today).start).getTime() - (days - 1) * 86400000).toISOString();
  const [sales, payments, purchases] = await Promise.all([
    db
      .from("sales")
      .select("total,occurred_at")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .is("reversed_at", null)
      .eq("is_opening", false)
      .gte("occurred_at", from)
      .range(0, 4999),
    db
      .from("payments")
      .select("amount,occurred_at")
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .eq("direction", "incoming")
      .is("reversed_at", null)
      .eq("is_opening", false)
      .gte("occurred_at", from)
      .range(0, 4999),
    db
      .from("purchases")
      .select("total,occurred_at")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .is("reversed_at", null)
      .eq("is_opening", false)
      .gte("occurred_at", from)
      .range(0, 4999),
  ]);
  if (sales.error || payments.error || purchases.error)
    throw new Error("Не удалось загрузить итог дня");
  const rows = new Map<string, DayHistoryRow>();
  const startMs = new Date(from).getTime();
  for (let i = days - 1; i >= 0; i--) {
    const date = bishkekDate(new Date(startMs + i * 86400000 + 12 * 3600000));
    rows.set(date, { date, sold: 0, collected: 0, purchased: 0 });
  }
  for (const r of sales.data ?? []) {
    const d = rows.get(bishkekDate(r.occurred_at));
    if (d) d.sold += Number(r.total);
  }
  for (const r of payments.data ?? []) {
    const d = rows.get(bishkekDate(r.occurred_at));
    if (d) d.collected += Number(r.amount);
  }
  for (const r of purchases.data ?? []) {
    const d = rows.get(bishkekDate(r.occurred_at));
    if (d) d.purchased += Number(r.total);
  }
  return [...rows.values()];
}

export type DayClosure = { closedAt: string; snapshot: DaySummary };

export async function dayClosure(
  db: SupabaseClient,
  organizationId: string,
  date: string,
): Promise<DayClosure | null> {
  const { data, error } = await db
    .from("day_closures")
    .select("closed_at,snapshot")
    .eq("organization_id", organizationId)
    .eq("day", date)
    .maybeSingle();
  if (error) {
    console.error("dayClosure: lookup failed", error);
    return null;
  }
  return data ? { closedAt: data.closed_at, snapshot: data.snapshot as DaySummary } : null;
}

/** Сколько прошлых дней проверяем на «не закрыт» — старее не напоминаем. */
export const UNCLOSED_LOOKBACK_DAYS = 7;

/**
 * Прошлые дни (не сегодня) за последнюю неделю, в которые были записи, но
 * день не закрыт — от нового к старому. Дни без записей (выходной) не в счёт.
 */
export async function unclosedDays(db: SupabaseClient, organizationId: string): Promise<string[]> {
  const today = bishkekDate();
  const todayStart = dayBounds(today).start;
  const from = new Date(new Date(todayStart).getTime() - UNCLOSED_LOOKBACK_DAYS * 86400000);
  const range = (table: "sales" | "purchases" | "payments") =>
    db
      .from(table)
      .select("occurred_at")
      .eq("organization_id", organizationId)
      .eq("status", table === "payments" ? "confirmed" : "posted")
      .eq("is_opening", false)
      .gte("occurred_at", from.toISOString())
      .lt("occurred_at", todayStart)
      .range(0, 4999);
  const [sales, purchases, payments, closures] = await Promise.all([
    range("sales"),
    range("purchases"),
    range("payments"),
    db
      .from("day_closures")
      .select("day")
      .eq("organization_id", organizationId)
      .gte("day", bishkekDate(from)),
  ]);
  if (sales.error || purchases.error || payments.error || closures.error) return [];
  const closed = new Set((closures.data ?? []).map((row) => row.day as string));
  const active = new Set(
    [...(sales.data ?? []), ...(purchases.data ?? []), ...(payments.data ?? [])].map((row) =>
      bishkekDate(row.occurred_at),
    ),
  );
  return [...active].filter((day) => !closed.has(day)).sort().reverse();
}
