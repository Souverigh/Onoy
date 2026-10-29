"use client";

import { useState } from "react";
import type { InvoiceLine, InvoiceResult } from "@/lib/adre/types";
import { searchProducts, type StockProduct } from "@/lib/match";
import { money, quantity } from "@/lib/format";
import { ruDate } from "@/lib/ru-date";
import { StockLineStatus, stockSummary, type StockMatching } from "./sale-stock-lines";

/** «1 строка», «3 строки», «5 строк». */
export function lineWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "строк";
  if (ones === 1) return "строка";
  if (ones >= 2 && ones <= 4) return "строки";
  return "строк";
}

/**
 * Товар склада для новой строки: название, единица и цена (продажная или
 * закупочная — в валюте накладной; иначе пусто, цену введут сами).
 */
export type CatalogProduct = StockProduct & { price: string };

const readable = (v: string) => v.trim() !== "" && Number.isFinite(Number(v));

/** Сумма строки: кол-во × цена, а если их не прочитали — сумма с бумаги. */
export function lineTotal(line: InvoiceLine): number {
  if (readable(line.qty) && readable(line.price)) return Number(line.qty) * Number(line.price);
  return readable(line.sum) ? Number(line.sum) : 0;
}

/** Итог строк в копейках — как computeTotal в normalize.ts. */
export function linesTotal(lines: InvoiceLine[]): number {
  return lines.reduce((cents, line) => cents + Math.round(lineTotal(line) * 100), 0) / 100;
}

/** money()/quantity() бросают на нечисле — пока строку правят, там бывает «1,» или пусто. */
function safe(format: (v: string) => string, value: string | number): string {
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  try {
    return format(text);
  } catch {
    return String(value) || "?";
  }
}

/** Число из поля: запятая — как точка, пробелы между разрядами убираем. */
const decimalText = (v: string) => v.replace(/\s+/g, "").replace(",", ".");

/**
 * Товары накладной — что прочитали с фото, до записи. Список растёт вместе со
 * страницей (своя прокрутка мешала листать форму колесом мыши, 22.10.2026);
 * нажатие на строку открывает её правку. Исправленные строки
 * уходят в запись вместо распознанных (onChange). Продажа со складом
 * (`stock`) — у каждой строки сразу и как она спишется со склада: один
 * список вместо двух одинаковых (21.10.2026).
 */
export function RecognizedLines({
  result,
  currency,
  paperTotal,
  onChange,
  defaultOpen = false,
  stock,
  catalog = [],
}: {
  result: InvoiceResult;
  currency: string;
  paperTotal: number | null;
  onChange: (lines: InvoiceLine[]) => void;
  defaultOpen?: boolean;
  stock?: StockMatching;
  /** Товары склада — для «+ Добавить строку» поиском, как в «Товарах со склада». */
  catalog?: CatalogProduct[];
}) {
  const [editing, setEditing] = useState<number | null>(null);
  // «+ Добавить строку»: поиск товара открыт; что набрали.
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const lines = result.lines;
  const date = result.date ? ruDate(result.date) || result.date : null;
  const head = [
    result.number ? `№ ${result.number}` : null,
    date ? `от ${date}` : null,
    result.seller?.name_raw ? `продавец: ${result.seller.name_raw}` : null,
    result.buyer?.name_raw ? `покупатель: ${result.buyer.name_raw}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function update(n: number, patch: Partial<InvoiceLine>) {
    onChange(
      lines.map((line) => {
        if (line.n !== n) return line;
        const next = { ...line, ...patch, confidence: 1 };
        return { ...next, sum: String(Math.round(lineTotal(next) * 100) / 100) };
      }),
    );
  }

  const trimmed = query.trim();
  const results = trimmed ? searchProducts(trimmed, catalog, 8) : [];

  function closeAdding() {
    setAdding(false);
    setQuery("");
    setActive(0);
  }

  // Новая строка: товар со склада (название, единица, цена; у продажи — сразу
  // «Со склада») или своя строка с набранным названием — сразу в правку.
  // Сумма записи пересчитается за строками.
  function add(product: CatalogProduct | null) {
    const n = lines.reduce((max, line) => Math.max(max, line.n), 0) + 1;
    const price = product && Number(product.price) > 0 ? String(Number(product.price)) : "";
    const line: InvoiceLine = {
      n,
      name_raw: product ? product.name : trimmed,
      qty: "1",
      unit: product?.unit || "шт",
      price,
      sum: price || "0",
      confidence: 1,
    };
    onChange([...lines, line]);
    if (product && stock) stock.onChoose(n, product.id);
    // Без цены — сразу в правку, чтобы ввести её.
    setEditing(product && price ? null : n);
    closeAdding();
  }

  function remove(n: number) {
    onChange(lines.filter((line) => line.n !== n));
    setEditing(null);
  }

  // Enter в поле строки не должен отправлять всю форму прихода.
  const closeOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setEditing(null);
    }
  };

  const summary = stock ? stockSummary(lines, stock) : null;
  return (
    // Есть что проверить по складу — список открыт сразу.
    <details className="recognized-lines" open={defaultOpen || Boolean(summary?.asking) || undefined}>
      <summary>
        Товары накладной · {lines.length} {lineWord(lines.length)}
        {summary &&
          (stock?.purchase ? (
            <span className="muted">
              {" "}
              · на склад {summary.writtenOff}
              {summary.added > 0 ? ` · новых ${summary.added}` : ""}
            </span>
          ) : (
            <span className="muted"> · со склада {summary.writtenOff}</span>
          ))}
        {summary && summary.asking > 0 && <span className="sale-stock-asking"> · проверьте {summary.asking}</span>}
      </summary>
      {head && <p className="muted">{head}</p>}
      <ol>
        {lines.map((line) => {
          const doubt = line.confidence < 0.8;
          const total = lineTotal(line);
          if (editing === line.n)
            return (
              <li key={line.n} className="recognized-line-edit">
                <label className="recognized-line-field-name">
                  Название
                  <input
                    value={line.name_raw}
                    maxLength={200}
                    autoComplete="off"
                    onKeyDown={closeOnEnter}
                    onChange={(e) => update(line.n, { name_raw: e.target.value })}
                  />
                </label>
                <label>
                  Кол-во
                  <input
                    value={line.qty}
                    inputMode="decimal"
                    autoComplete="off"
                    onKeyDown={closeOnEnter}
                    onChange={(e) => update(line.n, { qty: decimalText(e.target.value) })}
                  />
                </label>
                <label>
                  Ед.
                  <input
                    value={line.unit}
                    maxLength={20}
                    autoComplete="off"
                    onKeyDown={closeOnEnter}
                    onChange={(e) => update(line.n, { unit: e.target.value })}
                  />
                </label>
                <label>
                  Цена
                  <input
                    value={line.price}
                    inputMode="decimal"
                    autoComplete="off"
                    onKeyDown={closeOnEnter}
                    onChange={(e) => update(line.n, { price: decimalText(e.target.value) })}
                  />
                </label>
                <div className="recognized-line-edit-foot">
                  <span>
                    Сумма: <strong>{safe((v) => money(v, currency), total)}</strong>
                  </span>
                  <button type="button" className="text-button danger-text" onClick={() => remove(line.n)}>
                    Удалить строку
                  </button>
                  <button type="button" className="button" onClick={() => setEditing(null)}>
                    Готово
                  </button>
                </div>
              </li>
            );
          return (
            <li key={line.n} className={doubt ? "line-doubt" : undefined}>
              <button type="button" className="recognized-line" onClick={() => setEditing(line.n)}>
                <span className="recognized-line-name">{line.name_raw || "Без названия"}</span>
                <span className="recognized-line-calc">
                  {safe(quantity, line.qty)} {line.unit} × {safe((v) => money(v, currency), line.price)}
                  {doubt && " · плохо читается"}
                </span>
                <span className="recognized-line-sum">{safe((v) => money(v, currency), total)}</span>
              </button>
              {stock && <StockLineStatus line={line} stock={stock} />}
            </li>
          );
        })}
      </ol>
      <div className="recognized-line-adder">
        {adding ? (
          <span className="sale-sheet-search">
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoFocus
              role="combobox"
              aria-expanded={Boolean(trimmed)}
              aria-label="Товар: название или код"
              placeholder={catalog.length ? "Товар: название или код" : "Название товара"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  if (!trimmed) return;
                  e.preventDefault();
                  const count = results.length + 1;
                  setActive((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
                } else if (e.key === "Enter") {
                  // Enter добавляет строку, а не отправляет всю форму.
                  e.preventDefault();
                  if (!trimmed) return;
                  add(active < results.length ? results[active] : null);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeAdding();
                }
              }}
              onBlur={() => {
                if (!trimmed) closeAdding();
              }}
            />
            {trimmed && (
              <ul className="product-results sale-sheet-dropdown" role="listbox">
                {results.map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={i === active ? "active" : ""}
                      // Не терять фокус поиска до клика.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => add(p)}
                    >
                      <span className="product-result-name">{p.name}</span>
                      <small className="muted">
                        {p.sku ? `${p.sku} · ` : ""}
                        {Number(p.price) > 0 ? `${safe((v) => money(v, currency), p.price)} · ` : ""}есть{" "}
                        {safe(quantity, p.stock)} {p.unit}
                      </small>
                    </button>
                  </li>
                ))}
                <li role="option" aria-selected={active === results.length}>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`product-new ${active === results.length ? "active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(results.length)}
                    onClick={() => add(null)}
                  >
                    + Своя строка «{trimmed}»
                  </button>
                </li>
              </ul>
            )}
          </span>
        ) : (
          <button type="button" className="button recognized-line-add" onClick={() => setAdding(true)}>
            + Добавить строку
          </button>
        )}
      </div>
      <p className="muted">
        Сумма строк: {safe((v) => money(v, currency), linesTotal(lines))}
        {paperTotal != null && <> · итог накладной: {money(paperTotal, currency)}</>}. Нажмите на строку, чтобы
        исправить.
      </p>
    </details>
  );
}
