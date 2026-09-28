import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentLabelWithSide, type PaymentKind } from "./entry-labels";

export type RecentRecord = {
  key: string;
  label: string;
  party: string;
  partyHref: string | null;
  amount: string;
  at: string;
  reversed: boolean;
};

/** Последние записи магазина (продажи, приходы, оплаты) — для главного экрана. */
export async function recentRecords(db: SupabaseClient, organizationId: string, limit = 6): Promise<RecentRecord[]> {
  const [sales, purchases, payments] = await Promise.all([
    db
      .from("sales")
      .select("id,customer_id,total,paid_immediately,created_at,reversed_at,is_opening")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("purchases")
      .select("id,supplier_id,total,created_at,reversed_at,is_opening")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("payments")
      .select("id,customer_id,supplier_id,direction,amount,created_at,reversed_at,is_opening,kind,status")
      .eq("organization_id", organizationId)
      .neq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(limit),
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
  for (const p of [...(customers.data ?? []), ...(suppliers.data ?? [])]) names.set(p.id, p.name);

  const rows: RecentRecord[] = [
    ...(sales.data ?? []).map((r) => ({
      key: `s${r.id}`,
      label: r.is_opening ? "Долг из тетради" : r.paid_immediately ? "Продажа · наличные" : "Продажа в долг",
      party: names.get(r.customer_id) ?? "Клиент",
      partyHref: `/customers/${r.customer_id}`,
      amount: String(r.total),
      at: r.created_at,
      reversed: Boolean(r.reversed_at),
    })),
    ...(purchases.data ?? []).map((r) => ({
      key: `p${r.id}`,
      label: r.is_opening ? "Долг из тетради" : "Приход",
      party: names.get(r.supplier_id) ?? "Поставщик",
      partyHref: `/suppliers/${r.supplier_id}`,
      amount: String(r.total),
      at: r.created_at,
      reversed: Boolean(r.reversed_at),
    })),
    ...(payments.data ?? []).map((r) => {
      const partyId = r.customer_id ?? r.supplier_id;
      return {
        key: `m${r.id}`,
        label:
          r.status === "pending"
            ? "Заявка «Я оплатил»"
            : paymentLabelWithSide(r.kind as PaymentKind, r.direction as "incoming" | "outgoing", r.is_opening),
        party: (partyId && names.get(partyId)) || "",
        partyHref: partyId ? `/${r.customer_id ? "customers" : "suppliers"}/${partyId}` : null,
        amount: String(r.amount),
        at: r.created_at,
        reversed: Boolean(r.reversed_at),
      };
    }),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
