import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money, quantity, decimalLessThan } from "@/lib/format";
import { ProductForm, type ProductEntry } from "@/components/product-form";
import { Submit } from "@/components/submit";
import { QtyStepper } from "@/components/qty-stepper";
import { adjustStock, archiveProduct } from "../actions";
import { STOCK_ERROR_TEXT } from "@/lib/stock";

type Movement = {
  id: string;
  created_at: string;
  qty_delta: string;
  reason: "purchase" | "sale" | "opening" | "adjustment" | "receipt";
  note: string | null;
  unit_cost: string | null;
  cost_currency: string | null;
  sale_id: string | null;
  purchase_id: string | null;
  sales: { reversed_at: string | null; customers: { name: string } | null } | null;
  purchases: { reversed_at: string | null; document_id: string | null; suppliers: { name: string } | null } | null;
};

const STOCKED_TEXT: Record<string, string> = {
  receipt: "Товар от поставщика записан на склад.",
  writeoff: "Списание записано.",
  count: "Остаток исправлен по пересчёту.",
};

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; stocked?: string; restored?: string; mode?: string }>;
}) {
  const { id } = await params;
  const { error, saved, stocked, restored, mode } = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, currency } = await getContext();
  const [productResult, movementsResult] = await Promise.all([
    db
      .from("product_balances")
      .select("id,name,sku,unit,sale_price,purchase_price,min_stock,aliases,stock,archived_at,sold_count")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle(),
    db
      .from("inventory_movements")
      .select(
        "id,created_at,qty_delta,reason,note,unit_cost,cost_currency,sale_id,purchase_id,sales(reversed_at,customers(name)),purchases(reversed_at,document_id,suppliers(name))",
      )
      .eq("organization_id", organizationId)
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const product = productResult.data as (ProductEntry & { stock: string; archived_at: string | null; sold_count: number }) | null;
  if (productResult.error || !product) notFound();
  const movements = (movementsResult.data ?? []) as unknown as Movement[];
  const low = !decimalLessThan("0", product.stock) || decimalLessThan(product.stock, product.min_stock);
  const date = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(
      new Date(iso),
    );
  const label = (m: Movement) => {
    if (m.reason === "sale") return { text: `Продажа · ${m.sales?.customers?.name ?? "клиент"}`, href: m.sale_id ? `/money/send/${m.sale_id}` : null, reversed: Boolean(m.sales?.reversed_at) };
    if (m.reason === "purchase")
      return {
        text: `Товар от поставщика · ${m.purchases?.suppliers?.name ?? "поставщик"}`,
        href: m.purchases?.document_id ? `/documents/${m.purchases.document_id}` : null,
        reversed: Boolean(m.purchases?.reversed_at),
      };
    if (m.reason === "receipt") return { text: "Пришло", href: null, reversed: false };
    if (m.reason === "opening") return { text: m.note ?? "Начальный остаток", href: null, reversed: false };
    return { text: Number(m.qty_delta) < 0 && m.note !== "Пересчёт" && m.note !== "Импорт" ? "Списание" : (m.note ?? "Исправление"), href: null, reversed: false };
  };

  return (
    <>
      <Link className="back-link" href="/stock">
        ← Склад
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ТОВАР{product.sku ? ` · КОД ${product.sku}` : ""}</span>
          <h1>{product.name}</h1>
          <p className="muted">
            {Number(product.sale_price) > 0 ? `${money(product.sale_price, currency)} за ${product.unit}` : "цена не указана"}
            {Number(product.purchase_price) > 0 && ` · закупка ${money(product.purchase_price, currency)}`}
            {product.sold_count > 0 && ` · продаж за 90 дней: ${product.sold_count}`}
          </p>
        </div>
      </div>
      {product.archived_at && (
        <p className="notice" role="status">
          Товар в архиве — в продаже его не видно.
        </p>
      )}
      {(saved || restored) && (
        <p className="notice success" role="status">
          {restored ? "Товар снова в продаже." : "Сохранено."}
        </p>
      )}
      {stocked && STOCKED_TEXT[stocked] && (
        <p className="notice success" role="status">
          {STOCKED_TEXT[stocked]}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {STOCK_ERROR_TEXT[error] ?? STOCK_ERROR_TEXT.save}
        </p>
      )}

      <section className="panel stock-panel">
        <div className="stock-now">
          <span className="muted">На складе</span>
          <strong className={low ? "warning" : ""}>
            {quantity(product.stock)} {product.unit}
          </strong>
          {low && <small className="warning">{decimalLessThan("0", product.stock) ? "Меньше минимума" : "Закончился"}</small>}
        </div>
        <div className="stock-receive">
          <Link className="button primary" href="/money/new?type=purchase&mode=items">
            + Товар от поставщика
          </Link>
          <small className="muted">Поставщик, количество и цена закупки — долг поставщику и остаток сразу.</small>
        </div>
        <form action={adjustStock} className="stock-adjust">
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          <fieldset className="payment-direction">
            <legend>Исправить остаток</legend>
            <label>
              <input type="radio" name="mode" value="writeoff" defaultChecked={!mode || mode === "writeoff" || mode === "receipt"} />
              Списать (−)
            </label>
            <label>
              <input type="radio" name="mode" value="count" defaultChecked={mode === "count"} />
              Пересчитал — на самом деле
            </label>
          </fieldset>
          <div className="form-grid">
            <label>
              Количество, {product.unit}
              <QtyStepper name="qty" label={`Количество, ${product.unit}`} required />
            </label>
            <label>
              Комментарий
              <input name="note" maxLength={200} autoComplete="off" placeholder="Для списания — обязательно" />
            </label>
          </div>
          <div className="simple-operation-actions">
            <Submit>Записать</Submit>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Движение товара</h2>
        {movements.length ? (
          <ul className="stock-list">
            {movements.map((m) => {
              const l = label(m);
              const delta = Number(m.qty_delta);
              return (
                <li key={m.id} className={l.reversed ? "op-list-item reversed" : "op-list-item"}>
                  {l.href ? (
                    <Link className="op-list-main" href={l.href}>
                      <strong>{l.text}</strong>
                    </Link>
                  ) : (
                    <span className="op-list-main">
                      <strong>{l.text}</strong>
                    </span>
                  )}
                  <span className={`op-list-amount ${delta > 0 ? "stock-plus" : ""}`}>
                    {delta > 0 ? "+" : "−"}
                    {quantity(String(m.qty_delta).replace(/^-/, ""))} {product.unit}
                  </span>
                  <span className="op-list-meta muted">
                    {date(m.created_at)}
                    {m.unit_cost != null && Number(m.unit_cost) > 0
                      ? ` · по ${money(m.unit_cost, (m.cost_currency as Parameters<typeof money>[1]) ?? currency)}`
                      : ""}
                    {l.reversed ? " · отменена — в остатке не считается" : ""}
                    {m.note && !["Пересчёт", "Импорт", "Начальный остаток"].includes(m.note) && m.reason !== "opening" ? ` · ${m.note}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Движений пока нет.</p>
        )}
      </section>

      <section className="panel">
        <h2>Изменить товар</h2>
        <ProductForm product={product} currency={currency} />
      </section>
      <form action={archiveProduct} className="stock-archive">
        <input type="hidden" name="id" value={product.id} />
        <input type="hidden" name="archived" value={product.archived_at ? "false" : "true"} />
        <button className="text-button" type="submit">
          {product.archived_at ? "Вернуть в продажу" : "Убрать в архив (больше не продаём)"}
        </button>
      </form>
    </>
  );
}
