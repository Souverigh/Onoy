import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneKey } from "./contacts";

/** Строка заказа из каталога — снимок из submit_catalog_order (миграция catalog_orders.sql). */
export type OrderItem = { product_id: string; name: string; unit: string; qty: string; price: string };

export type CatalogOrder = {
  id: string;
  created_at: string;
  status: "new" | "accepted" | "sold" | "dismissed";
  customer_id: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  note: string | null;
  items: OrderItem[];
  total: string;
  draft_id: string | null;
  sale_id: string | null;
  handled_by: string | null;
  handled_at: string | null;
};

export type OrderCustomer = { id: string; name: string };

/**
 * На кого заказ: one — клиент известен (с личной страницы или единственный
 * с этим телефоном); many — с этим телефоном несколько клиентов, продавец
 * выбирает; none — новый покупатель.
 */
export type OrderMatch =
  | { kind: "one"; customer: OrderCustomer; byLink: boolean }
  | { kind: "many"; customers: OrderCustomer[] }
  | { kind: "none" };

/** Действующие клиенты магазина по телефону: ключ phoneKey → клиенты. */
export type PhoneBook = Map<string, OrderCustomer[]>;

/**
 * Телефоны клиентов магазина. Номер хранится как ввели («0555 12-34-56» из
 * тетради, «+996555123456» из формы) — сравниваем по phoneKey, как
 * partyFromContact в форме продажи. Объединённые и архивные не берём.
 */
export async function phoneBook(db: SupabaseClient, organizationId: string): Promise<PhoneBook> {
  const { data, error } = await db
    .from("customer_balances")
    .select("id,name,phone")
    .eq("organization_id", organizationId)
    .neq("phone", "")
    .is("merged_into_id", null)
    .is("archived_at", null)
    .range(0, 4999);
  if (error) console.error("phoneBook failed", { message: error.message });
  const book: PhoneBook = new Map();
  for (const c of (data ?? []) as { id: string; name: string; phone: string | null }[]) {
    const key = phoneKey(c.phone);
    if (key.length < 6) continue;
    book.set(key, [...(book.get(key) ?? []), { id: c.id, name: c.name }]);
  }
  return book;
}

/**
 * Клиенты заказов с личной страницы: id → клиент; объединённый — тот, в
 * кого объединили.
 */
export async function linkedCustomers(db: SupabaseClient, organizationId: string, ids: string[]): Promise<Map<string, OrderCustomer>> {
  const found = new Map<string, OrderCustomer>();
  if (!ids.length) return found;
  type Row = { id: string; name: string; merged_into_id: string | null };
  const load = async (list: string[]) =>
    ((await db.from("customers").select("id,name,merged_into_id").eq("organization_id", organizationId).in("id", list)).data ?? []) as Row[];
  const rows = await load(ids);
  const targets = await load([...new Set(rows.map((r) => r.merged_into_id).filter((id): id is string => Boolean(id)))]);
  const byId = new Map(targets.map((t) => [t.id, t]));
  for (const r of rows) {
    const target = r.merged_into_id ? byId.get(r.merged_into_id) : r;
    if (target) found.set(r.id, { id: target.id, name: target.name });
  }
  return found;
}

export function matchOrder(
  order: Pick<CatalogOrder, "customer_id" | "buyer_phone">,
  book: PhoneBook,
  linked: Map<string, OrderCustomer>,
): OrderMatch {
  if (order.customer_id) {
    const customer = linked.get(order.customer_id);
    if (customer) return { kind: "one", customer, byLink: true };
  }
  const found = order.buyer_phone ? (book.get(phoneKey(order.buyer_phone)) ?? []) : [];
  if (found.length === 1) return { kind: "one", customer: found[0], byLink: false };
  if (found.length > 1) return { kind: "many", customers: found };
  return { kind: "none" };
}
