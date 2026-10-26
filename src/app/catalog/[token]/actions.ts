"use server";

import { after } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";
import { notifyShop } from "@/lib/push";
import { normalizePhone } from "@/lib/contacts";
import { clientOrders, MY_ORDERS_LIMIT, type ClientOrder } from "@/lib/client-orders";

const tokenPattern = /^[a-f0-9]{32}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderInput = {
  token: string;
  /** Ссылка личной страницы клиента — каталог открыт оттуда; иначе null. */
  client: string | null;
  items: { id: string; qty: number }[];
  name: string;
  phone: string;
  note: string;
};

export type OrderResult =
  | { ok: true; id: string }
  | { error: "phone" | "changed" | "too_many" | "catalog" | "save" };

/**
 * Заказ из каталога — в Depter (задача № 12): магазин видит его в «Заказах»
 * и одним нажатием делает продажу. Цены считает база по складу
 * (submit_catalog_order), браузер присылает только товары и количество.
 */
export async function submitCatalogOrder(input: OrderInput): Promise<OrderResult> {
  if (!tokenPattern.test(input.token)) return { error: "catalog" };
  const client = input.client && tokenPattern.test(input.client) ? input.client : null;
  const items = (Array.isArray(input.items) ? input.items : [])
    .filter((i) => uuidPattern.test(String(i.id)) && Number.isFinite(i.qty) && i.qty > 0 && i.qty < 1e6)
    .slice(0, 200)
    .map((i) => ({ id: i.id, qty: String(Math.round(i.qty * 1000) / 1000) }));
  if (!items.length) return { error: "save" };
  const phone = String(input.phone ?? "").trim() ? normalizePhone(String(input.phone)).slice(0, 40) : "";
  if (!client && phone.replace(/\D/g, "").length < 6) return { error: "phone" };

  const result = await createAnonClient().rpc("submit_catalog_order", {
    p_token: input.token,
    p_items: items,
    p_name: String(input.name ?? "").slice(0, 100),
    p_phone: phone || null,
    p_note: String(input.note ?? "").slice(0, 1000),
    p_client: client,
  });
  if (result.error) {
    const message = result.error.message;
    if (/phone_required|invalid_phone/.test(message)) return { error: "phone" };
    if (message.includes("order_changed")) return { error: "changed" };
    if (message.includes("too_many_orders")) return { error: "too_many" };
    if (message.includes("invalid_catalog")) return { error: "catalog" };
    console.error("submitCatalogOrder failed", { message });
    return { error: "save" };
  }
  const id = String(result.data);
  // Магазину — push «Новый заказ» (после ответа: клиенту не ждать).
  after(() => notifyShop("order", id));
  return { ok: true, id };
}

/**
 * «Мои заказы» в каталоге: с личной страницы клиента — его заказы (с любого
 * устройства); из общего каталога — те, что отправлены из этого браузера
 * (номера браузер помнит сам).
 */
export async function loadMyOrders(token: string, ids: string[], client: string | null): Promise<ClientOrder[]> {
  if (!tokenPattern.test(token)) return [];
  const anon = createAnonClient();
  const result =
    client && tokenPattern.test(client)
      ? await anon.rpc("get_client_orders", { p_token: client })
      : await anon.rpc("get_catalog_orders", {
          p_token: token,
          p_ids: (Array.isArray(ids) ? ids : []).filter((id) => uuidPattern.test(String(id))).slice(0, MY_ORDERS_LIMIT),
        });
  if (result.error) {
    console.error("loadMyOrders failed", { message: result.error.message });
    return [];
  }
  // Накладная — только на личной странице, в каталоге без неё.
  return clientOrders(result.data).map((o) => ({ ...o, sale_id: null }));
}
