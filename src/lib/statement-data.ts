import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentLabel, type PaymentKind } from "./entry-labels";

export function bishkekToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function monthStart() {
  const today = bishkekToday();
  return `${today.slice(0, 7)}-01`;
}
function toIso(date: string) {
  return new Date(`${date}T00:00:00+06:00`).toISOString();
}

export type StatementEntry = {
  kind: "sale" | "purchase" | "payment";
  /** Для kind="payment": оплата, скидка или возврат. */
  paymentKind?: PaymentKind;
  amount: number;
  occurred_at: string;
  reversed: boolean;
  /** Долг или аванс, перенесённый из бумажной тетради. */
  opening: boolean;
};
export function statementEntryLabel(entry: Pick<StatementEntry, "kind" | "opening" | "paymentKind">) {
  if (entry.kind === "payment") return paymentLabel(entry.paymentKind, { opening: entry.opening });
  if (entry.opening) return "Долг из тетради";
  return entry.kind === "sale" ? "Продажа" : "Товар от поставщика";
}

export type StatementData = {
  partyName: string;
  shopName: string;
  currency: string;
  from: string;
  to: string;
  opening: number;
  closing: number;
  entries: StatementEntry[];
} | null;

export async function getStatementData(
  db: SupabaseClient,
  organizationId: string,
  kind: "customers" | "suppliers",
  id: string,
  rawFrom?: string,
  rawTo?: string,
): Promise<StatementData> {
  const partyTable = kind;
  const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
  const docTable = kind === "customers" ? "sales" : "purchases";
  const from = rawFrom && /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) ? rawFrom : monthStart();
  const to = rawTo && /^\d{4}-\d{2}-\d{2}$/.test(rawTo) ? rawTo : bishkekToday();
  const fromIso = toIso(from);
  const toIsoEnd = new Date(new Date(toIso(to)).getTime() + 86400000).toISOString();

  const [party, shop] = await Promise.all([
    db.from(partyTable).select("id,name,phone,currency").eq("organization_id", organizationId).eq("id", id).maybeSingle(),
    db.from("organizations").select("name,currency").eq("id", organizationId).maybeSingle(),
  ]);
  if (party.error || !party.data) return null;

  const paymentDirection = kind === "customers" ? "incoming" : "outgoing";
  // Продажа за наличные долг не меняет (как в customer_balances) — в акт не идёт.
  const docs = () => {
    const q = db
      .from(docTable)
      .select("id,total,occurred_at,reversed_at,is_opening")
      .eq("organization_id", organizationId)
      .eq(partyColumn, id)
      .eq("status", "posted");
    return kind === "customers" ? q.eq("paid_immediately", false) : q;
  };
  const [docsBefore, paymentsBefore, docsInPeriod, paymentsInPeriod] = await Promise.all([
    docs().lt("occurred_at", fromIso),
    db.from("payments").select("amount,reversed_at").eq("organization_id", organizationId).eq(partyColumn, id).eq("direction", paymentDirection).eq("status", "confirmed").lt("occurred_at", fromIso),
    docs().gte("occurred_at", fromIso).lt("occurred_at", toIsoEnd).order("occurred_at"),
    db.from("payments").select("id,amount,occurred_at,reversed_at,status,is_opening,kind").eq("organization_id", organizationId).eq(partyColumn, id).eq("direction", paymentDirection).neq("status", "rejected").gte("occurred_at", fromIso).lt("occurred_at", toIsoEnd).order("occurred_at"),
  ]);

  const sum = (rows: { amount?: string; total?: string; reversed_at: string | null }[]) =>
    rows.filter((r) => !r.reversed_at).reduce((s, r) => s + Number(r.amount ?? r.total ?? 0), 0);
  const opening = sum(docsBefore.data ?? []) - sum(paymentsBefore.data ?? []);

  const entries: StatementEntry[] = [
    ...(docsInPeriod.data ?? []).map((d) => ({
      kind: (kind === "customers" ? "sale" : "purchase") as StatementEntry["kind"],
      amount: Number(d.total),
      occurred_at: d.occurred_at,
      reversed: Boolean(d.reversed_at),
      opening: Boolean(d.is_opening),
    })),
    ...(paymentsInPeriod.data ?? [])
      .filter((p) => p.status !== "pending")
      .map((p) => ({
        kind: "payment" as const,
        paymentKind: p.kind as PaymentKind,
        amount: -Number(p.amount),
        occurred_at: p.occurred_at,
        reversed: Boolean(p.reversed_at),
        opening: Boolean(p.is_opening),
      })),
  ].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const closing = entries.reduce((s, e) => s + (e.reversed ? 0 : e.amount), opening);

  return {
    partyName: party.data.name,
    shopName: shop.data?.name ?? "Магазин",
    // Акт — в валюте долга контрагента (ТЗ §15.2: долларовому — в USD).
    currency: (party.data.currency ?? shop.data?.currency ?? "KGS") as string,
    from,
    to,
    opening,
    closing,
    entries,
  };
}
