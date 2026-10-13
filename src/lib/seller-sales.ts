import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayBounds, bishkekDate } from "./day-summary";
import { memberLabels } from "./members";
import { foreignParties, recordCurrency } from "./party-currency";
import type { Currency } from "./currency";

/**
 * Продажи по продавцам (автор записи — sales.created_by) за период: владелец
 * смотрит каждого продавца, продавец — только себя. Суммы — в валюте
 * магазина; продажи клиентам в другой валюте — отдельной строкой `foreign`.
 */
export type SellerOverviewRow = {
  id: string | null;
  name: string;
  role: "owner" | "staff" | null;
  sold: number;
  count: number;
  collected: number;
  customers: number;
};

export type SellerSale = {
  id: string;
  date: string;
  customerId: string | null;
  customerName: string;
  total: number;
  currency: Currency;
  paid: boolean;
};

export type SellerDetail = {
  sold: number;
  credit: number;
  cash: number;
  count: number;
  collected: number;
  days: { date: string; sold: number; count: number; customers: number }[];
  customers: { id: string; name: string; sold: number; count: number }[];
  /** Продажи клиентам не в валюте магазина — суммы по валютам. */
  foreign: { currency: Currency; sold: number; count: number }[];
  /** Последние продажи периода, новые сверху. */
  sales: SellerSale[];
};

type SaleRow = {
  id: string;
  customer_id: string | null;
  total: string;
  paid_immediately: boolean;
  created_by: string | null;
  occurred_at: string;
};
type PaymentRow = { customer_id: string | null; amount: string; created_by: string | null };

const round = (n: number) => Math.round(n * 100) / 100;
const SALES_LIST_LIMIT = 200;

/** Действующие продажи и оплаты клиентов за дни start..end (включительно, по Бишкеку). */
async function load(db: SupabaseClient, organizationId: string, start: string, end: string, sellerId?: string | null) {
  const from = dayBounds(start).start;
  const to = dayBounds(end).end;
  let sales = db
    .from("sales")
    .select("id,customer_id,total,paid_immediately,created_by,occurred_at")
    .eq("organization_id", organizationId)
    .eq("status", "posted")
    .is("reversed_at", null)
    .eq("is_opening", false)
    .gte("occurred_at", from)
    .lt("occurred_at", to)
    .order("occurred_at", { ascending: false })
    .range(0, 9999);
  let payments = db
    .from("payments")
    .select("customer_id,amount,created_by")
    .eq("organization_id", organizationId)
    .eq("status", "confirmed")
    .eq("kind", "payment")
    .eq("direction", "incoming")
    .is("reversed_at", null)
    .eq("is_opening", false)
    .gte("occurred_at", from)
    .lt("occurred_at", to)
    .range(0, 9999);
  if (sellerId) {
    sales = sales.eq("created_by", sellerId);
    payments = payments.eq("created_by", sellerId);
  }
  const [s, p] = await Promise.all([sales, payments]);
  if (s.error || p.error) throw new Error("Не удалось загрузить продажи продавцов");
  return { sales: (s.data ?? []) as SaleRow[], payments: (p.data ?? []) as PaymentRow[] };
}

/** Владелец: кто сколько продал за период. Продавцы без продаж — тоже в списке. */
export async function sellersOverview(
  db: SupabaseClient,
  organizationId: string,
  start: string,
  end: string,
  shopCurrency: Currency,
): Promise<SellerOverviewRow[]> {
  const [{ sales, payments }, members, foreign] = await Promise.all([
    load(db, organizationId, start, end),
    memberLabels(db, organizationId),
    foreignParties(db, organizationId, shopCurrency),
  ]);
  const rows = new Map<string, SellerOverviewRow & { customerIds: Set<string> }>();
  const row = (id: string | null) => {
    const key = id ?? "";
    if (!rows.has(key)) {
      const m = id ? members.get(id) : undefined;
      rows.set(key, {
        id,
        name: m?.name ?? (id ? "Бывший сотрудник" : "Без автора (до сотрудников)"),
        role: m?.role ?? null,
        sold: 0,
        count: 0,
        collected: 0,
        customers: 0,
        customerIds: new Set(),
      });
    }
    return rows.get(key)!;
  };
  for (const id of members.keys()) row(id);
  for (const s of sales) {
    if (recordCurrency(s, foreign, shopCurrency) !== shopCurrency) continue;
    const r = row(s.created_by);
    r.sold = round(r.sold + Number(s.total));
    r.count += 1;
    if (s.customer_id) r.customerIds.add(s.customer_id);
  }
  for (const p of payments) {
    if (recordCurrency(p, foreign, shopCurrency) !== shopCurrency) continue;
    const r = row(p.created_by);
    r.collected = round(r.collected + Number(p.amount));
  }
  return [...rows.values()]
    // Записи без автора — только если они есть в периоде.
    .filter((r) => r.id || r.count || r.collected)
    .map(({ customerIds, ...r }) => ({ ...r, customers: customerIds.size }))
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, "ru"));
}

/** Один продавец за период: по дням, по клиентам и список продаж. */
export async function sellerDetail(
  db: SupabaseClient,
  organizationId: string,
  sellerId: string,
  start: string,
  end: string,
  shopCurrency: Currency,
): Promise<SellerDetail> {
  const [{ sales, payments }, foreign] = await Promise.all([
    load(db, organizationId, start, end, sellerId),
    foreignParties(db, organizationId, shopCurrency),
  ]);
  const customerIds = [...new Set(sales.map((s) => s.customer_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  for (let i = 0; i < customerIds.length; i += 200) {
    const lookup = await db
      .from("customers")
      .select("id,name")
      .eq("organization_id", organizationId)
      .in("id", customerIds.slice(i, i + 200));
    for (const c of lookup.data ?? []) names.set(c.id as string, c.name as string);
  }

  const days = new Map<string, { date: string; sold: number; count: number; ids: Set<string> }>();
  const customers = new Map<string, { id: string; name: string; sold: number; count: number }>();
  const other = new Map<Currency, { currency: Currency; sold: number; count: number }>();
  let credit = 0;
  let cash = 0;
  let count = 0;
  for (const s of sales) {
    const cur = recordCurrency(s, foreign, shopCurrency);
    const total = Number(s.total);
    if (cur !== shopCurrency) {
      const o = other.get(cur) ?? { currency: cur, sold: 0, count: 0 };
      o.sold = round(o.sold + total);
      o.count += 1;
      other.set(cur, o);
      continue;
    }
    count += 1;
    if (s.paid_immediately) cash = round(cash + total);
    else credit = round(credit + total);
    const date = bishkekDate(s.occurred_at);
    const d = days.get(date) ?? { date, sold: 0, count: 0, ids: new Set<string>() };
    d.sold = round(d.sold + total);
    d.count += 1;
    if (s.customer_id) d.ids.add(s.customer_id);
    days.set(date, d);
    if (s.customer_id) {
      const c = customers.get(s.customer_id) ?? {
        id: s.customer_id,
        name: names.get(s.customer_id) ?? "Клиент",
        sold: 0,
        count: 0,
      };
      c.sold = round(c.sold + total);
      c.count += 1;
      customers.set(s.customer_id, c);
    }
  }
  const collected = round(
    payments
      .filter((p) => recordCurrency(p, foreign, shopCurrency) === shopCurrency)
      .reduce((sum, p) => sum + Number(p.amount), 0),
  );
  return {
    sold: round(credit + cash),
    credit,
    cash,
    count,
    collected,
    days: [...days.values()]
      .map(({ ids, ...d }) => ({ ...d, customers: ids.size }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    customers: [...customers.values()].sort((a, b) => b.sold - a.sold),
    foreign: [...other.values()],
    sales: sales.slice(0, SALES_LIST_LIMIT).map((s) => ({
      id: s.id,
      date: s.occurred_at,
      customerId: s.customer_id,
      customerName: (s.customer_id && names.get(s.customer_id)) || "Клиент",
      total: Number(s.total),
      currency: recordCurrency(s, foreign, shopCurrency),
      paid: s.paid_immediately,
    })),
  };
}
