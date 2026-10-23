"use client";

import { useMemo, useState } from "react";
import { searchProducts } from "@/lib/match";
import { money } from "@/lib/format";
import { Submit } from "./submit";
import { saveCatalogProducts } from "@/app/(workspace)/stock/catalog/actions";

export type CatalogProductRow = { id: string; name: string; unit: string; sale_price: string; catalog_hidden: boolean };

/**
 * Владелец: какие товары видны клиентам в каталоге. Галочка — показывать;
 * товар без цены продажи в каталог не попадает (галочка недоступна).
 */
export function CatalogProducts({ products, currency }: { products: CatalogProductRow[]; currency: string }) {
  const [hidden, setHidden] = useState(() => new Set(products.filter((p) => p.catalog_hidden).map((p) => p.id)));
  const [query, setQuery] = useState("");
  const initial = useMemo(() => new Set(products.filter((p) => p.catalog_hidden).map((p) => p.id)), [products]);
  const priced = products.filter((p) => Number(p.sale_price) > 0);
  const visible = priced.filter((p) => !hidden.has(p.id)).length;
  const trimmed = query.trim();
  const rows = trimmed ? searchProducts(trimmed, products, 300) : products;
  const changed = hidden.size !== initial.size || [...hidden].some((id) => !initial.has(id));

  function toggle(id: string, show: boolean) {
    setHidden((current) => {
      const next = new Set(current);
      if (show) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={saveCatalogProducts} className="catalog-products">
      {/* Только изменённые: скрыть и показать — остальные товары база не трогает. */}
      <input type="hidden" name="hide" value={JSON.stringify([...hidden].filter((id) => !initial.has(id)))} />
      <input type="hidden" name="show" value={JSON.stringify([...initial].filter((id) => !hidden.has(id)))} />
      <div className="section-title">
        <h2>Товары в каталоге</h2>
        <span className="muted">
          видно {visible} из {priced.length}
        </span>
      </div>
      <p className="muted catalog-products-hint">
        Клиенты видят название и цену продажи. Остатки, цены закупки и коды не видны. Товары без цены продажи в
        каталог не попадают.
      </p>
      <div className="catalog-products-tools">
        <input
          type="search"
          placeholder="Найти товар"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Найти товар"
        />
        <button type="button" className="text-button" onClick={() => setHidden(new Set())}>
          Показать все
        </button>
        <button type="button" className="text-button" onClick={() => setHidden(new Set(products.map((p) => p.id)))}>
          Скрыть все
        </button>
      </div>
      <ul className="catalog-products-list">
        {rows.slice(0, 300).map((p) => {
          const noPrice = !(Number(p.sale_price) > 0);
          return (
            <li key={p.id} className={noPrice ? "muted" : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={!noPrice && !hidden.has(p.id)}
                  disabled={noPrice}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                />
                <span className="catalog-products-name">{p.name}</span>
                <span className="catalog-products-price">
                  {noPrice ? "нет цены" : `${money(p.sale_price, currency)} / ${p.unit}`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {rows.length > 300 && <p className="muted">Показаны первые 300 - уточните поиск.</p>}
      <div className="catalog-products-save">
        <Submit disabled={!changed}>{changed ? "Сохранить" : "Сохранено"}</Submit>
      </div>
    </form>
  );
}
