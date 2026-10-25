"use client";

import { useState } from "react";
import type { InvoiceLine } from "@/lib/adre/types";
import {
  NEW_PRODUCT,
  chosenProduct,
  lineName,
  productByModel,
  searchProducts,
  suggestProduct,
  type StockChoices,
  type StockProduct,
} from "@/lib/match";
import { decimalLessThan, quantity } from "@/lib/format";
import { InfoTip } from "./info-tip";

/**
 * Для commit_sale / commit_purchase: по каждой строке — товар, null («не
 * списывать» / «не принимать») или у прихода new — «Новый товар» (только
 * нажатый). Строку прихода без товара и без выбора не передаём: база сама
 * найдёт товар по коду или названию по всему складу (в форме склад может быть
 * неполным) и только потом заведёт новый.
 */
export function lineProductsValue(
  lines: InvoiceLine[],
  products: StockProduct[],
  choices: StockChoices,
  purchase = false,
): string {
  return JSON.stringify(
    lines.flatMap((line) => {
      const product = chosenProduct(line, products, choices)?.id ?? null;
      if (purchase && !product && choices[line.n] === NEW_PRODUCT) return [{ n: line.n, product: null, new: true }];
      if (purchase && !product && !(line.n in choices)) return [];
      return [{ n: line.n, product }];
    }),
  );
}

function safeQuantity(value: string): string {
  try {
    return quantity(value.trim());
  } catch {
    return value;
  }
}

/** Склад для строк фото: товары, выбор по строкам и его смена; purchase — приход. */
export type StockMatching = {
  products: StockProduct[];
  choices: StockChoices;
  onChoose: (n: number, productId: string | null) => void;
  purchase?: boolean;
};

/**
 * Что будет со строкой: товар (выбран, по коду или точному названию), вопрос
 * «Это …?» (похожий по названию или модели) или ничего — у продажи «не
 * списываем», у прихода «новый товар».
 */
export function stockRow(line: InvoiceLine, stock: StockMatching) {
  const product = chosenProduct(line, stock.products, stock.choices);
  const chosen = line.n in stock.choices;
  const suggestion =
    !product && !chosen
      ? (suggestProduct(lineName(line.name_raw), stock.products) ?? productByModel(line.name_raw, stock.products))
      : null;
  const isNew = Boolean(stock.purchase) && !product && !suggestion && (!chosen || stock.choices[line.n] === NEW_PRODUCT);
  return { product, suggestion, isNew };
}

/** Сводка для заголовка списка: сколько строк со склада, сколько новых и сколько спросить. */
export function stockSummary(lines: InvoiceLine[], stock: StockMatching) {
  const rows = lines.map((line) => stockRow(line, stock));
  return {
    writtenOff: rows.filter((r) => r.product).length,
    added: rows.filter((r) => r.isNew).length,
    asking: rows.filter((r) => r.suggestion).length,
  };
}

/**
 * Склад у одной строки накладной (продажа по фото — 15.10.2026, приход —
 * 26.10.2026): найденный товар — сам; похожий — «Это „…“?»; «Другой товар» —
 * поиск по складу; у продажи — «Не списывать», у прихода — «Новый товар» и
 * «Не принимать на склад».
 */
export function StockLineStatus({ line, stock }: { line: InvoiceLine; stock: StockMatching }) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const { product, suggestion, isNew } = stockRow(line, stock);
  const purchase = Boolean(stock.purchase);
  const short = !purchase && product && line.qty.trim() !== "" && decimalLessThan(product.stock, safeNumber(line.qty));
  const searchText = lineName(line.name_raw);

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
            {purchase ? `✓ На склад: ${product.name}` : `✓ Со склада${short ? " - уйдёт в минус" : ""}`}
            <InfoTip>
              {purchase ? (
                <>
                  Приход ляжет на товар «{product.name}»{product.sku ? ` (код ${product.sku})` : ""}. Название с накладной
                  запомним - в следующий раз найдём сами.
                </>
              ) : (
                <>
                  Спишем со склада: {product.name}. На складе {short ? "только " : ""}
                  {safeQuantity(product.stock)} {product.unit}
                  {short ? " - после продажи остаток уйдёт в минус." : "."}
                </>
              )}
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
            {purchase && (
              <button type="button" className="text-button" onClick={() => choose(NEW_PRODUCT)}>
                Новый товар
              </button>
            )}
            <button type="button" className="text-button" onClick={() => setPicking(true)}>
              Другой
            </button>
          </span>
        </p>
      ) : (
        <p className="sale-stock-status">
          <span className="muted">
            {isNew ? "Новый товар на складе" : purchase ? "Не принимаем на склад" : "Не списываем со склада"}
          </span>
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
              // Enter выбирает первый найденный, а не отправляет запись.
              if (e.key === "Enter") {
                e.preventDefault();
                const first = searchProducts(query.trim() || searchText, stock.products, 1)[0];
                if (first) choose(first.id);
              }
            }}
          />
          <ul className="product-results">
            {searchProducts(query.trim() || searchText, stock.products, 6).map((p) => (
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
            {purchase && (
              <button type="button" className="text-button" onClick={() => choose(NEW_PRODUCT)}>
                Новый товар
              </button>
            )}
            <button type="button" className="text-button" onClick={() => choose(null)}>
              {purchase ? "Не принимать на склад" : "Не списывать со склада"}
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
