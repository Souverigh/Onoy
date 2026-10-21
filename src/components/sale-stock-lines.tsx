"use client";

import { useState } from "react";
import type { InvoiceLine } from "@/lib/adre/types";
import { chosenProduct, searchProducts, suggestProduct, type StockChoices, type StockProduct } from "@/lib/match";
import { decimalLessThan, quantity } from "@/lib/format";
import { InfoTip } from "./info-tip";

/** Для commit_sale: по каждой строке — товар или null. Порядок строк — как на фото. */
export function lineProductsValue(lines: InvoiceLine[], products: StockProduct[], choices: StockChoices): string {
  return JSON.stringify(lines.map((line) => ({ n: line.n, product: chosenProduct(line, products, choices)?.id ?? null })));
}

function safeQuantity(value: string): string {
  try {
    return quantity(value.trim());
  } catch {
    return value;
  }
}

/** Склад для продажи по фото: товары, выбор продавца по строкам и смена выбора. */
export type StockMatching = {
  products: StockProduct[];
  choices: StockChoices;
  onChoose: (n: number, productId: string | null) => void;
};

/** Что спишется по строке: точное совпадение, «Это „…“?» или ничего. */
export function stockRow(line: InvoiceLine, stock: StockMatching) {
  const product = chosenProduct(line, stock.products, stock.choices);
  const suggestion = !product && !(line.n in stock.choices) ? suggestProduct(line.name_raw, stock.products) : null;
  return { product, suggestion };
}

/** Сводка для заголовка списка: сколько строк спишем и сколько спросить. */
export function stockSummary(lines: InvoiceLine[], stock: StockMatching) {
  const rows = lines.map((line) => stockRow(line, stock));
  return { writtenOff: rows.filter((r) => r.product).length, asking: rows.filter((r) => r.suggestion).length };
}

/**
 * Склад у одной строки накладной (продажа по фото, просьба пользователя
 * 15.10.2026; в одном списке со строками — 21.10.2026): точное название —
 * само; похожее — «Это „…“?»; «Другой товар» — поиск по складу или
 * «Не списывать со склада».
 */
export function StockLineStatus({ line, stock }: { line: InvoiceLine; stock: StockMatching }) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const { product, suggestion } = stockRow(line, stock);
  const short = product && line.qty.trim() !== "" && decimalLessThan(product.stock, safeNumber(line.qty));

  function choose(productId: string | null) {
    stock.onChoose(line.n, productId);
    setPicking(false);
    setQuery("");
  }

  return (
    <div className="stock-line">
      {product ? (
        <p className="sale-stock-status">
          <span className="sale-stock-ok label-with-tip">
            ✓ Со склада{short ? " - уйдёт в минус" : ""}
            <InfoTip>
              Спишем со склада: {product.name}. На складе {short ? "только " : ""}
              {safeQuantity(product.stock)} {product.unit}
              {short ? " - после продажи остаток уйдёт в минус." : "."}
            </InfoTip>
          </span>
          <button type="button" className="text-button" onClick={() => setPicking(true)}>
            Другой товар
          </button>
        </p>
      ) : suggestion ? (
        <p className="sale-stock-status sale-stock-doubt">
          <span>Склад: это «{suggestion.name}»?</span>
          <span className="sale-stock-actions">
            <button type="button" className="button" onClick={() => choose(suggestion.id)}>
              Да
            </button>
            <button type="button" className="text-button" onClick={() => setPicking(true)}>
              Другой
            </button>
          </span>
        </p>
      ) : (
        <p className="sale-stock-status">
          <span className="muted">Не списываем со склада</span>
          <button type="button" className="text-button" onClick={() => setPicking(true)}>
            Выбрать товар
          </button>
        </p>
      )}
      {picking && (
        <div className="sale-stock-picker">
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoFocus
            aria-label="Найти товар на складе"
            placeholder="Найти: название или код"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter выбирает первый найденный, а не отправляет продажу.
              if (e.key === "Enter") {
                e.preventDefault();
                const first = searchProducts(query.trim() || line.name_raw, stock.products, 1)[0];
                if (first) choose(first.id);
              }
            }}
          />
          <ul className="product-results">
            {searchProducts(query.trim() || line.name_raw, stock.products, 6).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => choose(p.id)}>
                  <span className="product-result-name">{p.name}</span>
                  <small className="muted">
                    {p.sku ? `${p.sku} · ` : ""}есть {safeQuantity(p.stock)} {p.unit}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <div className="sale-stock-actions">
            <button type="button" className="text-button" onClick={() => choose(null)}>
              Не списывать со склада
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setPicking(false);
                setQuery("");
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Количество с фото для сравнения с остатком: «1,5» — как «1.5», нечисло — 0. */
function safeNumber(value: string): string {
  const text = value.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(text) ? text : "0";
}
