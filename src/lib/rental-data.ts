import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RentalRow = {
  id: string;
  customer_id: string;
  issued_at: string;
  days: number;
  due_on: string;
  sale_id: string | null;
  extra_sale_id: string | null;
  collateral_kind: string;
  collateral_note: string | null;
  deposit: string | null;
  deposit_returned_at: string | null;
  note: string | null;
  returned_at: string | null;
  reversed_at: string | null;
  reversal_comment: string | null;
  created_by: string | null;
  /** Часть, оплаченная сразу (частичная оплата). */
  payment: { amount: string; reversed_at: string | null } | null;
  customers: { name: string; phone: string | null } | null;
  rental_items: { id: string; n: number; product_id: string; price_per_day: string; returned_at: string | null; products: { name: string } | null }[];
};

export const RENTAL_COLUMNS =
  "id,customer_id,issued_at,days,due_on,sale_id,extra_sale_id,collateral_kind,collateral_note,deposit,deposit_returned_at,note,returned_at,reversed_at,reversal_comment,created_by,payment:payments(amount,reversed_at),customers(name,phone),rental_items(id,n,product_id,price_per_day,returned_at,products(name))";

/** Вещи на руках: товар → до какого дня и у кого (самая ранняя выдача). */
export async function onHand(
  db: SupabaseClient,
  organizationId: string,
): Promise<Map<string, { count: number; due: string; who: string }>> {
  const { data, error } = await db
    .from("rental_items")
    .select("product_id,rentals!inner(due_on,reversed_at,customers(name))")
    .eq("organization_id", organizationId)
    .is("returned_at", null)
    .is("rentals.reversed_at", null)
    .range(0, 4999);
  // Таблицы ещё нет (миграция не применена) — проката нет.
  if (error) return new Map();
  const out = new Map<string, { count: number; due: string; who: string }>();
  for (const row of (data ?? []) as unknown as { product_id: string; rentals: { due_on: string; customers: { name: string } | null } }[]) {
    const prev = out.get(row.product_id);
    const due = row.rentals.due_on;
    const who = row.rentals.customers?.name ?? "";
    if (!prev) out.set(row.product_id, { count: 1, due, who });
    else out.set(row.product_id, { count: prev.count + 1, ...(due < prev.due ? { due, who } : { due: prev.due, who: prev.who }) });
  }
  return out;
}

/** Для главной: сколько выдач просрочено и сколько вернуть сегодня (день по Бишкеку). */
export async function rentalsDue(db: SupabaseClient, organizationId: string, today: string): Promise<{ late: number; today: number }> {
  const { data, error } = await db
    .from("rentals")
    .select("due_on")
    .eq("organization_id", organizationId)
    .is("returned_at", null)
    .is("reversed_at", null)
    .lte("due_on", today)
    .range(0, 4999);
  if (error) return { late: 0, today: 0 };
  const rows = (data ?? []) as { due_on: string }[];
  return { late: rows.filter((r) => r.due_on < today).length, today: rows.filter((r) => r.due_on === today).length };
}
