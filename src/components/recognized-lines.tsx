"use client";

import { useState } from "react";
import type { InvoiceLine, InvoiceResult } from "@/lib/adre/types";
import { money, quantity } from "@/lib/format";
import { ruDate } from "@/lib/ru-date";

/** «1 строка», «3 строки», «5 строк». */
export function lineWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "строк";
  if (ones === 1) return "строка";
  if (ones >= 2 && ones <= 4) return "строки";
  return "строк";
}

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
 * Что прочитали с фото накладной — до записи. Список прокручивается внутри
 * блока; нажатие на строку открывает её правку. Исправленные строки уходят
 * в запись вместо распознанных (onChange).
 */
export function RecognizedLines({
  result,
  currency,
  paperTotal,
  onChange,
  defaultOpen = false,
}: {
  result: InvoiceResult;
  currency: string;
  paperTotal: number | null;
  onChange: (lines: InvoiceLine[]) => void;
  defaultOpen?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
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

  // Новая строка — сразу в правку; сумма записи пересчитается за строками.
  function add() {
    const n = lines.reduce((max, line) => Math.max(max, line.n), 0) + 1;
    onChange([...lines, { n, name_raw: "", qty: "1", unit: "шт", price: "", sum: "0", confidence: 1 }]);
    setEditing(n);
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

  return (
    <details className="recognized-lines" open={defaultOpen || undefined}>
      <summary>
        Что прочитали в накладной · {lines.length} {lineWord(lines.length)}
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
            </li>
          );
        })}
      </ol>
      <button type="button" className="button recognized-line-add" onClick={add}>
        + Добавить строку
      </button>
      <p className="muted">
        Сумма строк: {safe((v) => money(v, currency), linesTotal(lines))}
        {paperTotal != null && <> · итог накладной: {money(paperTotal, currency)}</>}. Нажмите на строку, чтобы
        исправить.
      </p>
    </details>
  );
}
