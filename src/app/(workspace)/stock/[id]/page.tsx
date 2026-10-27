import { randomUUID } from "node:crypto";
import { word } from "@/lib/business";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money, quantity, decimalLessThan } from "@/lib/format";
import { ProductForm, type ProductEntry } from "@/components/product-form";
import { Submit } from "@/components/submit";
import { QtyStepper } from "@/components/qty-stepper";
import { adjustStock, archiveProduct, undoProductMerge } from "../actions";
import { ProductMerge } from "@/components/product-merge";
import { ConfirmButton } from "@/components/confirm-button";
import { STOCK_ERROR_TEXT } from "@/lib/stock";
import { convertAmount, isCurrency, ratePair } from "@/lib/currency";
import { officialRates } from "@/lib/fx";
import { ProductPhotoField } from "@/components/product-photo-field";
import { productPhotoUrl } from "@/lib/product-photo";
import { loadCategories } from "@/lib/category-data";

type Movement = {
  id: string;
  created_at: string;
  qty_delta: string;
  reason: "purchase" | "sale" | "opening" | "adjustment" | "receipt" | "return";
  note: string | null;
  unit_cost: string | null;
  cost_currency: string | null;
  sale_id: string | null;
  purchase_id: string | null;
  sales: { reversed_at: string | null; customers: { name: string } | null } | null;
  purchases: { reversed_at: string | null; document_id: string | null; suppliers: { name: string } | null } | null;
  /** Возврат от клиента (return_items): отменён — запись возврата или сама продажа. */
  returned?: { customerId: string | null; customer: string | null; reversed: boolean };
};

type ReturnRow = {
  id: string;
  created_at: string;
  qty: string;
  price: string;
  payments: { reversed_at: string | null; customer_id: string | null; customers: { name: string } | null } | null;
  sales: { reversed_at: string | null } | null;
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
  searchParams: Promise<{
    error?: string;
    saved?: string;
    stocked?: string;
    restored?: string;
    mode?: string;
    merged?: string;
    unmerged?: string;
  }>;
}) {
  const { id } = await params;
  const { error, saved, stocked, restored, mode, merged, unmerged } = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, currency, isOwner, business } = await getContext();
  const [productResult, movementsResult, returnsResult, photoResult, categoryData] = await Promise.all([
    db
      .from("product_balances")
      .select("id,name,sku,unit,sale_price,purchase_price,purchase_currency,min_stock,aliases,stock,archived_at,sold_count,category_id")
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
    db
      .from("return_items")
      .select("id,created_at,qty,price,payments(reversed_at,customer_id,customers(name)),sales(reversed_at)")
      .eq("organization_id", organizationId)
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Фото для каталога и объединение — из таблицы товаров (в представлении остатков их нет).
    db.from("products").select("photo_path,merged_into_id,model_id").eq("organization_id", organizationId).eq("id", id).maybeSingle(),
    loadCategories(db, organizationId),
  ]);
  const photoRow = photoResult.data as { photo_path: string | null; merged_into_id: string | null; model_id?: string | null } | null;
  // Размер или цвет модели (миграция 20261029100000) — ссылка на все её товары.
  const modelId = photoRow?.model_id ?? null;
  const photoPath = photoRow?.photo_path ?? null;
  const mergedIntoId = photoRow?.merged_into_id ?? null;
  // Объединение (владелец): с чем объединён, что объединили сюда за сутки, другие товары для выбора.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [mergedIntoResult, recentMergesResult, othersResult] = await Promise.all([
    mergedIntoId
      ? db.from("products").select("id,name").eq("organization_id", organizationId).eq("id", mergedIntoId).maybeSingle()
      : null,
    isOwner
      ? db
          .from("product_merges")
          .select("id,from_id")
          .eq("organization_id", organizationId)
          .eq("into_id", id)
          .is("undone_at", null)
          .gt("created_at", dayAgo)
          .order("created_at", { ascending: false })
      : null,
    isOwner && !mergedIntoId
      ? db
          .from("products")
          .select("id,name,sku,aliases")
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .is("merged_into_id", null)
          .neq("id", id)
          .order("name")
          .range(0, 4999)
      : null,
  ]);
  const mergedInto = (mergedIntoResult?.data as { id: string; name: string } | null) ?? null;
  const recentMerges = (recentMergesResult?.data ?? []) as { id: string; from_id: string }[];
  const mergedFrom = recentMerges.length
    ? (((await db.from("products").select("id,name").eq("organization_id", organizationId).in("id", recentMerges.map((m) => m.from_id)))
        .data ?? []) as { id: string; name: string }[])
    : [];
  const others = (othersResult?.data ?? []) as { id: string; name: string; sku: string | null; aliases: string[] | null }[];
  const product = productResult.data as (ProductEntry & { stock: string; archived_at: string | null; sold_count: number }) | null;
  if (productResult.error || !product) notFound();
  // Закупка в другой валюте — показываем и в валюте магазина по курсу сегодня.
  const costCurrency = isCurrency(product.purchase_currency) ? product.purchase_currency : currency;
  let costInShop: string | null = null;
  if (costCurrency !== currency && Number(product.purchase_price) > 0) {
    const [strong, weak] = ratePair(costCurrency, currency);
    const quote = (await officialRates([costCurrency, currency]))[`${strong}/${weak}`];
    if (quote) costInShop = money(convertAmount(Number(product.purchase_price), costCurrency, currency, quote.rate).toFixed(2), currency);
  }
  // Возвраты от клиентов — в общей ленте (таблицы нет до миграции return_items).
  const returns: Movement[] = ((returnsResult.error ? [] : (returnsResult.data ?? [])) as unknown as ReturnRow[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    qty_delta: r.qty,
    reason: "return",
    note: null,
    unit_cost: null,
    cost_currency: null,
    sale_id: null,
    purchase_id: null,
    sales: null,
    purchases: null,
    returned: {
      customerId: r.payments?.customer_id ?? null,
      customer: r.payments?.customers?.name ?? null,
      reversed: Boolean(r.payments?.reversed_at || r.sales?.reversed_at),
    },
  }));
  const movements = [...((movementsResult.data ?? []) as unknown as Movement[]), ...returns]
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, 50);
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
    if (m.reason === "return")
      return {
        text: `Возврат · ${m.returned?.customer ?? "клиент"}`,
        href: m.returned?.customerId ? `/customers/${m.returned.customerId}` : null,
        reversed: Boolean(m.returned?.reversed),
      };
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
            {Number(product.purchase_price) > 0 && ` · закупка ${money(product.purchase_price, costCurrency)}`}
            {costInShop && ` (≈ ${costInShop} по курсу сегодня)`}
            {product.sold_count > 0 && ` · продаж за 90 дней: ${product.sold_count}`}
          </p>
          {modelId && (
            <Link className="text-button" href={`/stock/model/${modelId}`}>
              Все размеры и цвета модели →
            </Link>
          )}
        </div>
      </div>
      {mergedInto ? (
        <p className="notice" role="status">
          Товар объединён с <Link href={`/stock/${mergedInto.id}`}>{mergedInto.name}</Link> - остаток и все записи там.
        </p>
      ) : (
        product.archived_at && (
          <p className="notice" role="status">
            Товар в архиве - в продаже его не видно.
          </p>
        )
      )}
      {(merged || unmerged) && (
        <p className="notice success" role="status">
          {merged ? "Товары объединены - остаток и записи дубля теперь здесь." : "Объединение отменено."}
        </p>
      )}
      {recentMerges.map((m) => (
        <form key={m.id} action={undoProductMerge} className="product-merge-undo">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="merge" value={m.id} />
          <span>Сюда объединён «{mergedFrom.find((p) => p.id === m.from_id)?.name ?? "товар"}».</span>
          <ConfirmButton
            className="button danger-outline"
            danger={false}
            confirmLabel="Да, разъединить"
            message="Отменить объединение?"
            text="Остаток, продажи, приходы и возвраты вернутся к прежнему товару, он снова будет в продаже."
          >
            Отменить объединение
          </ConfirmButton>
        </form>
      ))}
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

      {!product.archived_at && (
        <section className="panel">
          <ProductPhotoField productId={product.id} name={product.name} initialUrl={productPhotoUrl(photoPath)} />
        </section>
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
            + {word(business, "purchase")}
          </Link>
          <small className="muted">Поставщик, количество и цена закупки - долг поставщику и остаток сразу.</small>
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
              Пересчитал - на самом деле
            </label>
          </fieldset>
          <div className="form-grid">
            <label>
              Количество, {product.unit}
              <QtyStepper name="qty" label={`Количество, ${product.unit}`} required />
            </label>
            <label>
              Комментарий
              <input name="note" maxLength={200} autoComplete="off" placeholder="Для списания - обязательно" />
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
                    {l.reversed ? " · отменена - в остатке не считается" : ""}
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
        <ProductForm product={product} currency={currency} categories={categoryData.categories} hints={categoryData.hints} />
      </section>
      {isOwner && !mergedInto && others.length > 0 && (
        <section className="panel">
          <ProductMerge id={product.id} name={product.name} others={others} />
        </section>
      )}
      {!mergedInto && (
        <form action={archiveProduct} className="stock-archive">
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="archived" value={product.archived_at ? "false" : "true"} />
          <button className="text-button" type="submit">
            {product.archived_at ? "Вернуть в продажу" : "Убрать в архив (больше не продаём)"}
          </button>
        </form>
      )}
    </>
  );
}
