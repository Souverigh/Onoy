"use client";

import { useState } from "react";
import { Submit } from "./submit";
import { saveDish } from "@/app/(workspace)/menu/actions";
import { money } from "@/lib/format";
import { CURRENCY_SIGN, isCurrency } from "@/lib/currency";
import { searchProducts } from "@/lib/match";
import { stockNumber } from "@/lib/stock";
import { SHARE_TEXT, dishCost, lineCost, portionInput, portionQty, portionUnit, productShare, shareLevel } from "@/lib/dish";
import type { DishLine, KitchenProduct } from "@/lib/dish-data";

type Line = { product_id: string; input: string };

/**
 * Блюдо меню (макет 31.10.2026): название, цена, категория, состав на
 * порцию (граммы и мл для продуктов в кг и л) и сводка «Продукты /
 * Заработок». Телефон — колонкой, «Сохранить» внизу экрана; компьютер — две
 * колонки, сводка с кнопкой справа.
 */
export function DishForm({
  dish,
  products,
  categories,
  currency,
}: {
  dish?: { id: string; name: string; price: string; category: string | null; lines: DishLine[] };
  /** Продукты склада и те из состава, что уже в архиве. */
  products: KitchenProduct[];
  /** Категории меню, что уже есть, — подсказки. */
  categories: string[];
  currency: string;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const [price, setPrice] = useState(dish && Number(dish.price) ? String(Number(dish.price)).replace(".", ",") : "");
  const [lines, setLines] = useState<Line[]>(
    (dish?.lines ?? []).map((l) => ({ product_id: l.product_id, input: portionInput(l.qty, byId.get(l.product_id)?.unit ?? "шт") })),
  );
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const used = new Set(lines.map((l) => l.product_id));
  const found = query.trim() ? searchProducts(query.trim(), products.filter((p) => !used.has(p.id)), 8) : [];
  const rows = lines.map((l) => {
    const product = byId.get(l.product_id);
    const unit = product?.unit ?? "шт";
    const qty = portionQty(l.input, unit);
    return { ...l, product, unit, qty };
  });
  const priced = rows.flatMap((r) =>
    r.product && r.qty ? [{ qty: r.qty, purchase_price: r.product.purchase_price, purchase_currency: r.product.purchase_currency }] : [],
  );
  const { cost, noPrice, foreign } = dishCost(priced, currency);
  const salePrice = Number(stockNumber(price || "0", 2) ?? 0);
  const share = productShare(cost, salePrice);
  const level = share === null ? null : shareLevel(share);
  const invalid = rows.some((r) => !r.qty);
  const payload = JSON.stringify(rows.flatMap((r) => (r.qty ? [{ product_id: r.product_id, qty: r.qty }] : [])));

  const add = (product: KitchenProduct) => {
    setLines((list) => [...list, { product_id: product.id, input: "" }]);
    setQuery("");
    setFocus(product.id);
  };
  const setInput = (id: string, input: string) => setLines((list) => list.map((l) => (l.product_id === id ? { ...l, input } : l)));
  const remove = (id: string) => setLines((list) => list.filter((l) => l.product_id !== id));

  const save = <Submit>Сохранить</Submit>;

  return (
    <form
      action={saveDish}
      className="dish-form"
      onSubmit={(e) => {
        if (!invalid) return;
        e.preventDefault();
        setTried(true);
      }}
    >
      {dish && <input type="hidden" name="id" value={dish.id} />}
      <input type="hidden" name="lines" value={payload} />

      <section className="panel dish-fields">
        <label className="dish-name">
          Блюдо
          <input name="name" required maxLength={100} defaultValue={dish?.name} placeholder="Например, Плов" autoFocus={!dish} />
        </label>
        <label className="dish-price">
          Цена, {isCurrency(currency) ? CURRENCY_SIGN[currency] : currency}
          <input name="price" inputMode="decimal" autoComplete="off" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
        </label>
        <label className="dish-category">
          Категория
          <input name="category" maxLength={60} list="dish-categories" defaultValue={dish?.category ?? ""} placeholder="Горячее, Салаты…" />
          <datalist id="dish-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </section>

      <section className="panel dish-summary" aria-live="polite">
        <div className="dish-totals">
          <div>
            <span>Продукты</span>
            <b>{money(cost, currency)}</b>
          </div>
          <div className={level === "bad" ? "loss" : "gain"}>
            <span>Заработок</span>
            <b>{salePrice > 0 ? money(Math.round((salePrice - cost) * 100) / 100, currency) : "-"}</b>
          </div>
        </div>
        {share !== null && level && (
          <>
            <div className={`dish-meter ${level}`} aria-hidden="true">
              <i style={{ left: `${Math.min(share, 100)}%` }} />
            </div>
            <p className={`dish-share ${level}`}>
              С каждой порции. Продукты - <b>{share}%</b> от цены. {SHARE_TEXT[level]}
            </p>
          </>
        )}
        {noPrice > 0 && <p className="dish-note">Не у всех продуктов есть цена закупки - она появится после «Закупки продуктов».</p>}
        {foreign > 0 && <p className="dish-note">Продукты, купленные в другой валюте, в сумму не вошли.</p>}
        <div className="dish-save-side">{save}</div>
      </section>

      <section className="panel dish-recipe">
        <h2>
          Из чего <small>на 1 порцию · цена - по последней закупке</small>
        </h2>
        {rows.length > 0 && (
          <ul className="dish-lines">
            {rows.map((r) => {
              const { unit } = portionUnit(r.unit);
              const priced = r.product && r.qty && Number(r.product.purchase_price) > 0 ? r.product : null;
              const sum = priced && r.qty ? lineCost({ qty: r.qty, purchase_price: priced.purchase_price, purchase_currency: null }) : null;
              return (
                <li key={r.product_id} className={tried && !r.qty ? "dish-line missing" : "dish-line"}>
                  <span className="dish-line-name">{r.product?.name ?? "Продукт удалён"}</span>
                  <span className="dish-line-qty">
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      aria-label={`${r.product?.name ?? "Продукт"}: сколько на порцию, ${unit}`}
                      autoFocus={focus === r.product_id}
                      value={r.input}
                      onChange={(e) => setInput(r.product_id, e.target.value)}
                    />
                    <i>{unit}</i>
                  </span>
                  <span className="dish-line-price muted">
                    {r.product && Number(r.product.purchase_price) > 0
                      ? `${money(r.product.purchase_price, r.product.purchase_currency ?? currency)}/${r.unit}`
                      : "нет цены"}
                  </span>
                  <span className="dish-line-sum">{priced && sum !== null ? money(sum, priced.purchase_currency ?? currency) : "-"}</span>
                  <button type="button" className="dish-line-remove" aria-label={`Убрать ${r.product?.name ?? "продукт"}`} onClick={() => remove(r.product_id)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {tried && invalid && <p className="form-error">Впишите, сколько каждого продукта уходит на порцию.</p>}
        <div className="dish-add">
          <input
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder={rows.length ? "+ Ещё продукт со склада" : "+ Продукт со склада: рис, мясо…"}
            aria-label="Добавить продукт со склада"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (found[0]) add(found[0]);
            }}
          />
          {query.trim() && (
            <ul className="product-results dish-results">
              {found.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => add(p)}>
                    <span className="product-result-name">{p.name}</span>
                    <small className="muted">
                      {Number(p.purchase_price) > 0 ? `${money(p.purchase_price, p.purchase_currency ?? currency)}/${p.unit}` : `${p.unit}, нет цены закупки`}
                    </small>
                  </button>
                </li>
              ))}
              {!found.length && <li className="dish-results-empty muted">Нет такого продукта. Добавьте его в «Продукты» или запишите закупку.</li>}
            </ul>
          )}
        </div>
      </section>

      <div className="dish-save-bar">{save}</div>
    </form>
  );
}
