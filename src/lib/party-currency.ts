import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCurrency, type Currency } from "./currency";

/**
 * Контрагенты не в валюте магазина (Хороз в долларах и т.п.) — id → валюта.
 * Их записи в итогах не складываются с остальными: у каждой валюты свой
 * блок (ТЗ §15.2: «в итоге дня доллары отдельной строкой»). id клиентов и
 * поставщиков — uuid, поэтому одна общая карта.
 */
export async function foreignParties(
  db: SupabaseClient,
  organizationId: string,
  shopCurrency: Currency,
): Promise<Map<string, Currency>> {
  const [customers, suppliers] = await Promise.all([
    db.from("customers").select("id,currency").eq("organization_id", organizationId).not("currency", "is", null).neq("currency", shopCurrency),
    db.from("suppliers").select("id,currency").eq("organization_id", organizationId).not("currency", "is", null).neq("currency", shopCurrency),
  ]);
  const map = new Map<string, Currency>();
  for (const row of [...(customers.data ?? []), ...(suppliers.data ?? [])])
    if (isCurrency(row.currency)) map.set(row.id, row.currency);
  return map;
}

/** Валюта записи по её контрагенту. */
export function recordCurrency(
  row: { customer_id?: string | null; supplier_id?: string | null },
  foreign: Map<string, Currency>,
  shopCurrency: Currency,
): Currency {
  const id = row.customer_id ?? row.supplier_id;
  return (id && foreign.get(id)) || shopCurrency;
}
