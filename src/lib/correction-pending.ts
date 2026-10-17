import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { correctionHref } from "./correction";

export type PendingCorrection = {
  id: string;
  partyName: string;
  amount: string;
  currency: string | null;
  reversedAt: string;
  href: string;
};

/**
 * «Исправить» по фото нажали, а новую запись не сделали: старая уже
 * отменена, копия фото ждёт без записи. Находим по журналу (correct_sale /
 * correct_purchase пишут new_document) — за 60 дней; удалённое фото — значит,
 * передумали. Ошибка — просто пустой список.
 */
export async function pendingCorrections(
  db: SupabaseClient,
  organizationId: string,
  kind: "sale" | "purchase",
): Promise<PendingCorrection[]> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const audit = await db
    .from("audit_events")
    .select("entity_id,metadata,created_at")
    .eq("organization_id", organizationId)
    .eq("action", `${kind}.reversed`)
    .filter("metadata->>correction", "eq", "true")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  const events = ((audit.data ?? []) as { entity_id: string; metadata: Record<string, unknown>; created_at: string }[]).filter(
    (e) => typeof e.metadata?.new_document === "string",
  );
  if (audit.error || !events.length) return [];
  const docIds = events.map((e) => e.metadata.new_document as string);
  const table = kind === "sale" ? "sales" : "purchases";
  const [docs, linked, olds, payments] = await Promise.all([
    db.from("documents").select("id").eq("organization_id", organizationId).in("id", docIds).is("deleted_at", null),
    db.from(table).select("document_id").eq("organization_id", organizationId).in("document_id", docIds),
    db
      .from(table)
      .select(
        kind === "sale"
          ? "id,total,original_amount,original_currency,occurred_at,party_id:customer_id,party:customers(name,currency)"
          : "id,total,original_amount,original_currency,occurred_at,party_id:supplier_id,party:suppliers(name,currency)",
      )
      .eq("organization_id", organizationId)
      .in(
        "id",
        events.map((e) => e.entity_id),
      ),
    kind === "purchase"
      ? db
          .from("payments")
          .select("id,amount")
          .eq("organization_id", organizationId)
          .in(
            "id",
            events.map((e) => e.metadata.payment).filter((p): p is string => typeof p === "string"),
          )
      : Promise.resolve({ data: [] as { id: string; amount: string }[], error: null }),
  ]);
  if (docs.error || linked.error || olds.error) return [];
  const alive = new Set((docs.data ?? []).map((d) => d.id as string));
  const used = new Set((linked.data ?? []).map((r) => (r as { document_id: string }).document_id));
  const oldById = new Map(
    ((olds.data ?? []) as unknown as {
      id: string;
      total: string;
      original_amount: string | null;
      original_currency: string | null;
      occurred_at: string;
      party_id: string;
      party: { name: string; currency: string | null } | null;
    }[]).map((r) => [r.id, r]),
  );
  const paidById = new Map(((payments.data ?? []) as { id: string; amount: string }[]).map((p) => [p.id, p.amount]));
  const result: PendingCorrection[] = [];
  for (const e of events) {
    const doc = e.metadata.new_document as string;
    const old = oldById.get(e.entity_id);
    if (!old || !alive.has(doc) || used.has(doc)) continue;
    const paid = typeof e.metadata.payment === "string" ? paidById.get(e.metadata.payment) : null;
    result.push({
      id: e.entity_id,
      partyName: old.party?.name ?? (kind === "sale" ? "Клиент" : "Поставщик"),
      amount: String(old.original_amount ?? old.total),
      currency: old.original_currency ?? old.party?.currency ?? null,
      reversedAt: e.created_at,
      href: correctionHref(kind, old, doc, paid),
    });
  }
  return result;
}
