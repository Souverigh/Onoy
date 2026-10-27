import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BUSINESS, PRESETS, businessType, resolveModules, type ShopStats } from "./business";
import { onHand } from "./rental-data";
import { money } from "./format";

/** Последняя смена вида за сутки (журнал set_business_profile) — для «Вернуть прежний вид». */
export async function lastBusinessChange(db: SupabaseClient, organizationId: string) {
  const { data } = await db
    .from("audit_events")
    .select("created_at,metadata")
    .eq("organization_id", organizationId)
    .eq("action", "organization.business_profile")
    .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const from = (data?.metadata as { from?: { type?: string | null; modules?: string[] | null } } | null)?.from;
  if (!data || !from) return null;
  const type = businessType(from.type ?? DEFAULT_BUSINESS);
  const overrides = (from.modules ?? []).filter((o) => typeof o === "string");
  return { type, overrides, label: PRESETS[type].label, modules: resolveModules(type, overrides) };
}


/** Что живо в магазине — для окна «Что изменится» при смене вида. */
export async function shopStats(db: SupabaseClient, organizationId: string, currency: string): Promise<ShopStats> {
  const [out, deposits, link, orders] = await Promise.all([
    onHand(db, organizationId),
    db
      .from("rentals")
      .select("deposit")
      .eq("organization_id", organizationId)
      .not("deposit", "is", null)
      .is("deposit_returned_at", null)
      .is("reversed_at", null)
      .range(0, 4999),
    db.from("catalog_links").select("revoked_at").eq("organization_id", organizationId).maybeSingle(),
    db.from("catalog_orders").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["new", "accepted"]),
  ]);
  const depositSum = ((deposits.data ?? []) as { deposit: string }[]).reduce((s, r) => s + Number(r.deposit), 0);
  return {
    rentalsOut: [...out.values()].reduce((s, o) => s + o.count, 0),
    deposits: depositSum > 0 ? money(depositSum.toFixed(2), currency) : null,
    catalogOpen: Boolean(link.data && !link.data.revoked_at),
    openOrders: orders.count ?? 0,
  };
}
