"use client";

import { useState } from "react";
import type { InvoiceLine } from "@/lib/adre/types";
import { exactProduct, searchProducts, suggestProduct, type StockProduct } from "@/lib/match";
import { decimalLessThan, quantity } from "@/lib/format";
import { InfoTip } from "./info-tip";

/** Выбор продавца по строке: id товара или null — «Не списывать со склада». */
export type StockChoices = Record<number, string | null>;

/** Товар строки: выбор продавца, иначе точное совпадение; похожий — только после «Да». */
export function chosenProduct(line: InvoiceLine, products: StockProduct[], choices: StockChoices): StockProduct | null {
  if (line.n in choices) {
    const id = choices[line.n];
    return id ? (products.find((p) => p.id === id) ?? null) : null;
  }
  return exactProduct(line.name_raw, products);
}

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

/**
 * Продажа по фото: какие строки накладной спишутся со склада (просьба
 * пользователя 15.10.2026). Точное название — само; похожее — «Это „…“?»;
 * «Другой товар» — поиск по складу или «Не списывать со склада».
 */
export function SaleStockLines({
  lines,
  products,
  choices,
  onChoose,
}: {
  lines: InvoiceLine[];
  products: StockProduct[];
  choices: StockChoices;
  onChoose: (n: number, productId: string | null) => void;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const rows = lines.map((line) => {
    const product = chosenProduct(line, products, choices);
    const suggestion = !product && !(line.n in choices) ? suggestProduct(line.name_raw, products) : null;
    return { line, product, suggestion };
  });
  const writtenOff = rows.filter((r) => r.product).length;
  const asking = rows.filter((r) => r.suggestion).length;

  function choose(n: number, productId: string | null) {
    onChoose(n, productId);
    setPicking(null);
    setQuery("");
  }

  return (
    <details className="recognized-lines sale-stock-lines" open={asking > 0 || undefined}>
      <summary>
        Склад · спишем {writtenOff} из {lines.length}
        {asking > 0 && <span className="sale-stock-asking"> · проверьте {asking}</span>}
        {/* Нажатие на «!» не должно сворачивать блок. */}
        <span className="sale-stock-tip" onClick={(e) => e.preventDefault()}>
          <InfoTip>
            Строки с фото, которые совпали с товаром на складе, спишем с остатка. Похожий товар спишем только после
            «Да» - название с фото запомним, в следующий раз узнаем сами. «Не списывать» - строка останется в
            накладной и долге клиента, склад не изменится.
          </InfoTip>
        </span>
      </summary>
      <ol>
        {rows.map(({ line, product, suggestion }) => {
          const short = product && line.qty.trim() !== "" && decimalLessThan(product.stock, safeNumber(line.qty));
          return (
            <li key={line.n} className={suggestion ? "line-doubt" : undefined}>
              <div className="sale-stock-line">
                <span className="recognized-line-name">{line.name_raw || "Без названия"}</span>
                <span className="recognized-line-calc">
                  {safeQuantity(line.qty)} {line.unit}
                </span>
                {product ? (
                  <p className="sale-stock-status">
                    <span className="sale-stock-ok label-with-tip">
                      ✓ Совпало
                      <InfoTip>
                        Спишем со склада: {product.name}. На складе {short ? "только " : ""}
                        {safeQuantity(product.stock)} {product.unit}
                        {short ? " - после продажи остаток уйдёт в минус." : "."}
                      </InfoTip>
                    </span>
                    <button type="button" className="text-button" onClick={() => setPicking(line.n)}>
                      Другой товар
                    </button>
                  </p>
                ) : suggestion ? (
                  <p className="sale-stock-status">
                    <span>Это «{suggestion.name}»?</span>
                    <span className="sale-stock-actions">
                      <button type="button" className="button" onClick={() => choose(line.n, suggestion.id)}>
                        Да
                      </button>
                      <button type="button" className="text-button" onClick={() => setPicking(line.n)}>
                        Другой товар
                      </button>
                    </span>
                  </p>
                ) : (
                  <p className="sale-stock-status">
                    <span className="muted">Не списываем со склада</span>
                    <button type="button" className="text-button" onClick={() => setPicking(line.n)}>
                      Выбрать товар
                    </button>
                  </p>
                )}
              </div>
              {picking === line.n && (
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
                        const first = searchProducts(query.trim() || line.name_raw, products, 1)[0];
                        if (first) choose(line.n, first.id);
                      }
                    }}
                  />
                  <ul className="product-results">
                    {searchProducts(query.trim() || line.name_raw, products, 6).map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => choose(line.n, p.id)}>
                          <span className="product-result-name">{p.name}</span>
                          <small className="muted">
                            {p.sku ? `${p.sku} · ` : ""}есть {safeQuantity(p.stock)} {p.unit}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="sale-stock-actions">
                    <button type="button" className="text-button" onClick={() => choose(line.n, null)}>
                      Не списывать со склада
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setPicking(null);
                        setQuery("");
                      }}
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Количество с фото для сравнения с остатком: «1,5» — как «1.5», нечисло — 0. */
function safeNumber(value: string): string {
  const text = value.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(text) ? text : "0";
}
