/**
 * Заказ из каталога глазами клиента (get_catalog_orders / get_client_orders):
 * товары, сумма и статус — без телефона и имени. sale_id — только на личной
 * странице клиента (накладная).
 */
export type ClientOrder = {
  id: string;
  created_at: string;
  status: "new" | "accepted" | "sold" | "dismissed";
  total: string;
  items: { name: string; unit: string; qty: string; price: string }[];
  sale_id?: string | null;
  /** Валюта цен (магазина) — на личной странице клиента, где своя валюта долга. */
  currency?: string;
};

/** Что с заказом — словами для клиента. */
export const CLIENT_ORDER_STATUS: Record<ClientOrder["status"], { label: string; tone: "" | "green" | "muted" }> = {
  new: { label: "Отправлен", tone: "" },
  accepted: { label: "Магазин оформляет", tone: "" },
  sold: { label: "Продан", tone: "green" },
  dismissed: { label: "Отменён магазином", tone: "muted" },
};

/** Сколько заказов браузер помнит из общего каталога. */
export const MY_ORDERS_LIMIT = 20;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ответ базы → известная форма; мусор отбрасываем. */
export function clientOrders(raw: unknown): ClientOrder[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is ClientOrder => Boolean(o && typeof o === "object" && uuidPattern.test(String((o as ClientOrder).id))))
    .filter((o) => o.status in CLIENT_ORDER_STATUS)
    .map((o) => ({ ...o, items: Array.isArray(o.items) ? o.items : [] }));
}
