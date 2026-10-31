import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money, quantity } from "@/lib/format";
import { memberLabels } from "@/lib/members";
import { DAY_SALE_ERROR_TEXT } from "@/lib/day-sale";
import { Submit } from "@/components/submit";
import { reverseDaySale } from "../actions";

const dayLong = (d: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long" }).format(new Date(`${d}T12:00:00+06:00`));

/**
 * Записанные продажи за день: что продали, сколько получили, что списалось
 * со склада. Владелец может отменить (с причиной) — продукты вернутся.
 * Компьютер — строки слева, итог справа; телефон — одной колонкой.
 */
export default async function DaySalePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; taken?: string; reversed?: string; cancel?: string; error?: string }>;
}) {
  const { id } = await params;
  const flags = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, currency, isOwner } = await getContext();
  const [sale, lines, moves, members] = await Promise.all([
    db
      .from("day_sales")
      .select("id,sale_date,menu_total,received,transfer,created_by,reversed_at,reversal_comment")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle(),
    db
      .from("day_sale_lines")
      .select("qty,price,dishes(name),products(name,unit)")
      .eq("organization_id", organizationId)
      .eq("day_sale_id", id)
      .order("position"),
    db
      .from("inventory_movements")
      .select("qty_delta,products(name,unit)")
      .eq("organization_id", organizationId)
      .eq("day_sale_id", id)
      .lt("qty_delta", 0),
    memberLabels(db, organizationId),
  ]);
  const row = sale.data as {
    id: string;
    sale_date: string;
    menu_total: string;
    received: string;
    transfer: string;
    created_by: string | null;
    reversed_at: string | null;
    reversal_comment: string | null;
  } | null;
  if (!row) notFound();
  const items = (lines.data ?? []) as unknown as {
    qty: string;
    price: string;
    dishes: { name: string } | null;
    products: { name: string; unit: string } | null;
  }[];
  const off = ((moves.data ?? []) as unknown as { qty_delta: string; products: { name: string; unit: string } | null }[]).sort(
    (a, b) => (a.products?.name ?? "").localeCompare(b.products?.name ?? "", "ru"),
  );
  const cash = Math.round((Number(row.received) - Number(row.transfer)) * 100) / 100;
  const discount = Math.round((Number(row.menu_total) - Number(row.received)) * 100) / 100;
  const author = row.created_by ? members.get(row.created_by)?.name : null;
  const reversed = Boolean(row.reversed_at);

  return (
    <>
      <Link className="back-link" href="/money">
        ← Все записи
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ПРОДАЖИ ЗА ДЕНЬ{reversed ? " · ОТМЕНЕНЫ" : ""}</span>
          <h1>{dayLong(row.sale_date)}</h1>
          {author && <p className="muted">Записал: {author}</p>}
        </div>
      </div>
      {flags.done && <p className="notice success">✓ Продажи записаны, продукты списаны со склада.</p>}
      {flags.taken && <p className="notice">За этот день продажи уже были записаны - вот они.</p>}
      {flags.reversed && <p className="notice success">Продажи отменены, продукты вернулись на склад.</p>}
      {flags.error && <p className="form-error">{DAY_SALE_ERROR_TEXT[flags.error] ?? DAY_SALE_ERROR_TEXT.save}</p>}
      {reversed && row.reversal_comment && <p className="notice">Отменены. Причина: {row.reversal_comment}</p>}

      <div className={reversed ? "ds-record reversed" : "ds-record"}>
        <section className="panel ds-record-lines">
          <h2>Что продали</h2>
          <ul className="ds-record-list">
            {items.map((i, n) => (
              <li key={n}>
                <span>{i.dishes?.name ?? i.products?.name ?? "Удалено"}</span>
                <span className="muted">
                  {quantity(i.qty)} × {money(i.price, currency)}
                </span>
                <b>{money(Math.round(Number(i.qty) * Number(i.price) * 100) / 100, currency)}</b>
              </li>
            ))}
          </ul>
          {off.length > 0 && (
            <details className="ds-record-off">
              <summary>Списано со склада: {off.length} продуктов</summary>
              <ul>
                {off.map((m, n) => (
                  <li key={n}>
                    <span>{m.products?.name ?? "Продукт"}</span>
                    <span>
                      {quantity(String(-Number(m.qty_delta)))} {m.products?.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="panel ds-record-total">
          <p className="ds-line">
            <span>По меню</span>
            <b>{money(row.menu_total, currency)}</b>
          </p>
          <p className="ds-line ds-big">
            <span>Получили</span>
            <b>{money(row.received, currency)}</b>
          </p>
          <p className="ds-line">
            <span>Наличными</span>
            <b>{money(cash, currency)}</b>
          </p>
          <p className="ds-line">
            <span>Переводом / QR</span>
            <b>{money(row.transfer, currency)}</b>
          </p>
          {discount > 0 && <p className="muted ds-discount">Меньше, чем по меню, на {money(discount, currency)}: скидки, еда персоналу.</p>}
          {isOwner && !reversed && (
            flags.cancel ? (
              <form action={reverseDaySale} className="ds-cancel">
                <input type="hidden" name="id" value={row.id} />
                <label>
                  Почему отменяете?
                  <textarea name="comment" required maxLength={500} rows={3} placeholder="Например: ошиблись количеством плова" />
                </label>
                <Submit>Да, отменить</Submit>
                <Link className="text-button" href={`/day-sales/${row.id}`}>
                  Не отменять
                </Link>
              </form>
            ) : (
              <Link className="button danger-outline ds-cancel-link" href={`/day-sales/${row.id}?cancel=1`}>
                Отменить продажи дня
              </Link>
            )
          )}
          {reversed && (
            <Link className="button primary ds-cancel-link" href={`/day-sales?date=${row.sale_date}`}>
              Записать день заново
            </Link>
          )}
        </section>
      </div>
    </>
  );
}
