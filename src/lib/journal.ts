import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { periodBounds, periodDays, type JournalFilters } from "./journal-filters";

export type JournalKind = "sale" | "purchase";

export type JournalRow = {
  id: string;
  total: string;
  occurred_at: string;
  reversed_at: string | null;
  reversal_comment: string | null;
  document_id: string | null;
  paid_immediately?: boolean;
  created_by: string | null;
  party_id: string;
  party: { name: string; currency: string | null } | null;
};

/** Итог по валюте долга: сумма действующих записей; у продаж — в долг и наличными. */
export type JournalTotal = { currency: string | null; sum: number; debt: number; cash: number; count: number };

export type JournalData = {
  rows: JournalRow[];
  hasMore: boolean;
  totals: JournalTotal[];
  /** Действующих записей и отменённых — по всем отобранным, не только на странице;
   *  без отбора «отменённые / действующие» — числа на вкладках видны с любой из них. */
  count: number;
  reversedCount: number;
  /** Итог посчитан не по всем записям (их больше лимита) — показываем «не меньше». */
  partial: boolean;
};

// Продаж и прихода на странице (просьба пользователя 28.10.2026: последние 15, дальше — «Дальше →»).
export const JOURNAL_PAGE = 15;
const TOTALS_LIMIT = 10000;

// «Кто внёс» — чья запись (maker_id): исправление владельцем остаётся за продавцом.
const SELECT = {
  sale: "id,total,occurred_at,reversed_at,reversal_comment,document_id,paid_immediately,created_by:maker_id,party_id:customer_id,party:customers(name,currency)",
  purchase: "id,total,occurred_at,reversed_at,reversal_comment,document_id,created_by:maker_id,party_id:supplier_id,party:suppliers(name,currency)",
};
const TOTALS_SELECT = {
  sale: "total,reversed_at,paid_immediately,party:customers(currency)",
  purchase: "total,reversed_at,party:suppliers(currency)",
};

/**
 * Журнал продаж или прихода: строки страницы и итоги по всем отобранным.
 * `page: "all"` — все строки (выгрузка в Excel), без итогов страницы.
 */
export async function journalData(
  db: SupabaseClient,
  organizationId: string,
  kind: JournalKind,
  f: JournalFilters,
  today: string,
  page: number | "all" = f.page,
): Promise<JournalData> {
  const empty: JournalData = { rows: [], hasMore: false, totals: [], count: 0, reversedCount: 0, partial: false };
  const sale = kind === "sale";
  const table = sale ? "sales" : "purchases";
  const partyColumn = sale ? "customer_id" : "supplier_id";

  // Поиск по клиенту или поставщику — по части имени.
  let partyIds: string[] | null = null;
  if (f.q) {
    const text = f.q.replace(/[%_\\]/g, " ").trim();
    const found = await db
      .from(sale ? "customers" : "suppliers")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", `%${text}%`)
      .limit(500);
    partyIds = (found.data ?? []).map((p) => p.id as string);
    if (!partyIds.length) return empty;
  }
  const { gte, lt } = periodBounds(periodDays(f, today));

  const filtered = (select: string, byStatus = true) => {
    let q = db
      .from(table)
      .select(select)
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .eq("is_opening", false);
    if (gte) q = q.gte("occurred_at", gte);
    if (lt) q = q.lt("occurred_at", lt);
    if (partyIds) q = q.in(partyColumn, partyIds);
    if (f.by) q = q.eq("maker_id", f.by);
    if (!byStatus) return q;
    if (f.status === "reversed") q = q.not("reversed_at", "is", null);
    else if (f.status === "active") q = q.is("reversed_at", null);
    else if (f.status === "debt" && sale) q = q.is("reversed_at", null).eq("paid_immediately", false);
    else if (f.status === "cash" && sale) q = q.is("reversed_at", null).eq("paid_immediately", true);
    return q;
  };

  const sortColumn = f.sort.startsWith("sum") ? "total" : "occurred_at";
  const ascending = f.sort.endsWith("asc");
  const from = page === "all" ? 0 : (page - 1) * JOURNAL_PAGE;
  const to = page === "all" ? TOTALS_LIMIT - 1 : from + JOURNAL_PAGE; // +1 строка — есть ли следующая страница
  const [rowsResult, totalsResult] = await Promise.all([
    filtered(SELECT[kind]).order(sortColumn, { ascending }).order("id").range(from, to),
    page === "all" ? Promise.resolve({ data: null, error: null }) : filtered(TOTALS_SELECT[kind], false).range(0, TOTALS_LIMIT - 1),
  ]);
  if (rowsResult.error) throw new Error(sale ? "Не удалось загрузить продажи" : "Не удалось загрузить приход");
  const all = (rowsResult.data ?? []) as unknown as JournalRow[];
  const rows = page === "all" ? all : all.slice(0, JOURNAL_PAGE);

  const byCurrency = new Map<string | null, JournalTotal>();
  let count = 0;
  let reversedCount = 0;
  const totalsRows = (totalsResult.data ?? []) as unknown as {
    total: string;
    reversed_at: string | null;
    paid_immediately?: boolean;
    party: { currency: string | null } | null;
  }[];
  for (const r of totalsRows) {
    if (r.reversed_at) {
      reversedCount += 1;
      continue;
    }
    // «В долг» / «Наличными» — итог только по ним; отменённые посчитаны выше все.
    if (sale && f.status === "debt" && r.paid_immediately) continue;
    if (sale && f.status === "cash" && !r.paid_immediately) continue;
    count += 1;
    const currency = r.party?.currency ?? null;
    const t = byCurrency.get(currency) ?? { currency, sum: 0, debt: 0, cash: 0, count: 0 };
    const amount = Number(r.total);
    t.sum += amount;
    t.count += 1;
    if (r.paid_immediately) t.cash += amount;
    else t.debt += amount;
    byCurrency.set(currency, t);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    rows,
    hasMore: page !== "all" && all.length > JOURNAL_PAGE,
    totals: [...byCurrency.values()]
      .map((t) => ({ ...t, sum: round(t.sum), debt: round(t.debt), cash: round(t.cash) }))
      .sort((a, b) => b.count - a.count),
    count,
    reversedCount,
    partial: totalsRows.length >= TOTALS_LIMIT,
  };
}
