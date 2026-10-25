import { money } from "@/lib/format";
import { CLIENT_ORDER_STATUS, type ClientOrder } from "@/lib/client-orders";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(
    new Date(value),
  );
const qtyText = (value: string) => String(Number(value)).replace(".", ",");

/**
 * «Мои заказы» для клиента — в каталоге и на его личной странице: когда
 * заказал, что, сумма и что с заказом сейчас. invoiceHref — накладная
 * проданного заказа (только на личной странице).
 */
export function ClientOrders({
  orders,
  currency,
  invoiceHref,
}: {
  orders: ClientOrder[];
  currency: string;
  invoiceHref?: (saleId: string) => string;
}) {
  return (
    <ul className="client-orders">
      {orders.map((o) => {
        const status = CLIENT_ORDER_STATUS[o.status];
        const cur = o.currency ?? currency;
        return (
          <li key={o.id}>
            <details>
              <summary>
                <span>
                  <strong>{money(o.total, cur)}</strong>
                  <small className="muted">
                    {" "}
                    · {dateTime(o.created_at)} · {o.items.length} {o.items.length === 1 ? "товар" : o.items.length < 5 ? "товара" : "товаров"}
                  </small>
                </span>
                <span className={status.tone === "green" ? "tag green" : status.tone === "muted" ? "tag client-order-off" : "tag"}>
                  {status.label}
                </span>
              </summary>
              <ul className="client-order-lines">
                {o.items.map((i, n) => (
                  <li key={n}>
                    <span>
                      {i.name}
                      <small className="muted">
                        {" "}
                        · {qtyText(i.qty)} {i.unit}
                      </small>
                    </span>
                    <span>{money((Math.round(Number(i.qty) * Number(i.price) * 100) / 100).toFixed(2), cur)}</span>
                  </li>
                ))}
              </ul>
              {o.status === "sold" && o.sale_id && invoiceHref && (
                <a className="text-button" href={invoiceHref(o.sale_id)}>
                  Накладная
                </a>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
}
