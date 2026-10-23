import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayBounds } from "./day-summary";
import { memberLabels } from "./members";

/** Исправление за день: какая запись чем заменена, кто исправил, было → стало. */
export type DayCorrection = {
  kind: "sale" | "purchase";
  newId: string;
  party: string;
  /** Кто нажал «Записать» исправление. */
  who: string;
  at: string;
  oldTotal: number;
  newTotal: number;
  /** Валюта долга клиента/поставщика — в ней total. */
  currency: string | null;
  /** Сумма стала меньше. */
  decreased: boolean;
  /** Продажа была «Наличными», стала «В долг». */
  cashToDebt: boolean;
  href: string;
};

type Row = {
  id: string;
  total: string;
  paid_immediately?: boolean;
  party: { name: string; currency: string | null } | null;
};

/**
 * Исправления продаж и приходов за день (просьба пользователя 22.10.2026):
 * по журналу отмен с replaced_by — их пишет замена при записи новой
 * (atomic_correction.sql). Владелец видит, где сумма уменьшилась или
 * наличные стали долгом. Ошибка — пустой список: итоги дня важнее.
 */
export async function dayCorrections(db: SupabaseClient, organizationId: string, date: string): Promise<DayCorrection[]> {
  const { start, end } = dayBounds(date);
  const audit = await db
    .from("audit_events")
    .select("action,entity_id,actor_id,metadata,created_at")
    .eq("organization_id", organizationId)
    .in("action", ["sale.reversed", "purchase.reversed"])
    .not("metadata->>replaced_by", "is", null)
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false })
    .limit(100);
  if (audit.error) {
    console.error("dayCorrections: audit failed", { message: audit.error.message });
    return [];
  }
  const events = (audit.data ?? []) as {
    action: string;
    entity_id: string;
    actor_id: string | null;
    metadata: { replaced_by?: unknown };
    created_at: string;
  }[];
  if (!events.length) return [];
  const ids = (kind: string) =>
    events
      .filter((e) => e.action === `${kind}.reversed`)
      .flatMap((e) => [e.entity_id, String(e.metadata.replaced_by)]);
  const saleIds = ids("sale");
  const purchaseIds = ids("purchase");
  const [sales, purchases, members] = await Promise.all([
    saleIds.length
      ? db
          .from("sales")
          .select("id,total,paid_immediately,party:customers(name,currency)")
          .eq("organization_id", organizationId)
          .in("id", saleIds)
      : Promise.resolve({ data: [], error: null }),
    purchaseIds.length
      ? db
          .from("purchases")
          .select("id,total,party:suppliers(name,currency)")
          .eq("organization_id", organizationId)
          .in("id", purchaseIds)
      : Promise.resolve({ data: [], error: null }),
    memberLabels(db, organizationId),
  ]);
  if (sales.error || purchases.error) {
    console.error("dayCorrections: records failed", { message: (sales.error ?? purchases.error)?.message });
    return [];
  }
  const rows = new Map(
    [...((sales.data ?? []) as unknown as Row[]), ...((purchases.data ?? []) as unknown as Row[])].map((r) => [r.id, r]),
  );
  const result: DayCorrection[] = [];
  for (const e of events) {
    const kind = e.action === "sale.reversed" ? "sale" : "purchase";
    const old = rows.get(e.entity_id);
    const fresh = rows.get(String(e.metadata.replaced_by));
    if (!old || !fresh) continue;
    const oldTotal = Number(old.total);
    const newTotal = Number(fresh.total);
    result.push({
      kind,
      newId: fresh.id,
      party: fresh.party?.name ?? old.party?.name ?? (kind === "sale" ? "Клиент" : "Поставщик"),
      who: e.actor_id ? (members.get(e.actor_id)?.name ?? "бывший сотрудник") : "-",
      at: e.created_at,
      oldTotal,
      newTotal,
      currency: fresh.party?.currency ?? old.party?.currency ?? null,
      decreased: newTotal < oldTotal - 0.005,
      cashToDebt: kind === "sale" && old.paid_immediately === true && fresh.paid_immediately === false,
      href: kind === "sale" ? `/money/send/${fresh.id}` : `/purchases/${fresh.id}`,
    });
  }
  return result;
}
