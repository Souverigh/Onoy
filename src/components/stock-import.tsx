"use client";

import Link from "next/link";
import { useState } from "react";
import { importProducts, type ImportResult } from "@/app/(workspace)/stock/actions";
import { readTable, type Table } from "@/lib/xlsx-read";
import {
  IMPORT_FIELD_LABEL,
  STOCK_ERROR_TEXT,
  detectColumns,
  importRows,
  type ColumnMap,
  type ImportField,
} from "@/lib/stock";

const FIELDS: ImportField[] = ["name", "sku", "unit", "sale_price", "purchase_price", "stock"];
const MAX_ROWS = 2000;

/** Буква колонки как в Excel: 0 → A, 26 → AA. */
function letter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function StockImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [header, setHeader] = useState(0);
  const [columns, setColumns] = useState<ColumnMap>({});
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function pick(file: File | null) {
    setResult(null);
    setReadError(null);
    setTable(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const read = await readTable(file);
      const found = detectColumns(read);
      setTable(read);
      setHeader(found?.header ?? -1);
      setColumns(found?.columns ?? { name: 0 });
    } catch (error) {
      console.error("readTable failed", error);
      setReadError(
        /\.xls$/i.test(file.name)
          ? "Старый формат .xls не читаем - в Excel: «Файл → Сохранить как → Книга Excel (.xlsx)»."
          : "Не удалось прочитать файл. Нужен .xlsx или .csv.",
      );
    }
  }

  const rows = table ? importRows(table, header, columns) : [];
  const warned = rows.filter((r) => r.warnings.length > 0);
  const width = table ? Math.max(0, ...table.slice(0, 50).map((r) => r.length)) : 0;
  const headerCells = table && header >= 0 ? (table[header] ?? []) : [];

  async function upload() {
    if (!rows.length || saving) return;
    setSaving(true);
    try {
      setResult(
        await importProducts(
          rows.slice(0, MAX_ROWS).map((r) => ({
            name: r.name,
            sku: r.sku,
            unit: r.unit,
            sale_price: r.sale_price,
            purchase_price: r.purchase_price,
            stock: r.stock,
          })),
        ),
      );
    } catch (error) {
      console.error("importProducts failed", error);
      setResult({ error: "network" });
    } finally {
      setSaving(false);
    }
  }

  if (result && !("error" in result)) {
    return (
      <div className="stock-import-result">
        <p className="notice success" role="status">
          Готово: новых товаров - {result.created}, обновлено - {result.updated}.
        </p>
        {result.errors.length > 0 && (
          <div className="photo-check-mismatch" role="status">
            Не загрузили строк: {result.errors.length}.
            <ul>
              {result.errors.slice(0, 20).map((e) => (
                <li key={e.row}>
                  Строка {rows[e.row - 1]?.line ?? e.row} «{rows[e.row - 1]?.name}» -{" "}
                  {STOCK_ERROR_TEXT[e.error] ?? "проверьте значения"}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="simple-operation-actions">
          <Link className="button primary" href="/stock">
            Открыть склад
          </Link>
          <button type="button" className="button" onClick={() => void pick(null).then(() => setFileName(null))}>
            Загрузить ещё файл
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stock-import">
      <label className="button page-add">
        {fileName ? `Файл: ${fileName} - выбрать другой` : "Выбрать файл Excel или CSV"}
        <input
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            void pick(file);
          }}
        />
      </label>
      {readError && (
        <p className="form-error" role="alert">
          {readError}
        </p>
      )}
      {table && (
        <>
          <h2>Какая колонка что значит</h2>
          <p className="muted">
            {header >= 0
              ? `Нашли шапку в строке ${header + 1}. Проверьте колонки - если что-то не так, выберите вручную.`
              : "Шапку не нашли - выберите колонки вручную."}
          </p>
          <div className="form-grid stock-import-columns">
            {FIELDS.map((field) => (
              <label key={field}>
                {IMPORT_FIELD_LABEL[field]}
                {field === "name" ? " *" : ""}
                <select
                  value={columns[field] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setColumns((prev) => {
                      const next = { ...prev };
                      if (value === "") delete next[field];
                      else next[field] = Number(value);
                      return next;
                    });
                  }}
                >
                  {field !== "name" && <option value="">- нет -</option>}
                  {Array.from({ length: width }, (_, c) => (
                    <option key={c} value={c}>
                      {letter(c)}
                      {headerCells[c] ? ` · ${headerCells[c].slice(0, 30)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Шапка в строке
              <select value={header} onChange={(e) => setHeader(Number(e.target.value))}>
                <option value={-1}>Нет шапки</option>
                {Array.from({ length: Math.min(10, table.length) }, (_, r) => (
                  <option key={r} value={r}>
                    {r + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h2>
            Товаров в файле: {rows.length}
            {rows.length > MAX_ROWS && <span className="muted"> - загрузим первые {MAX_ROWS}</span>}
          </h2>
          {warned.length > 0 && (
            <p className="photo-check-mismatch" role="status">
              В {warned.length} строках есть непонятные значения - они загрузятся без них (подробности в таблице).
            </p>
          )}
          {rows.length > 0 ? (
            <div className="table-wrap">
              <table className="stock-import-preview">
                <thead>
                  <tr>
                    <th>Стр.</th>
                    {FIELDS.filter((f) => columns[f] !== undefined).map((f) => (
                      <th key={f}>{IMPORT_FIELD_LABEL[f]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((r) => (
                    <tr key={r.line} className={r.warnings.length ? "warning" : ""}>
                      <td>{r.line}</td>
                      {FIELDS.filter((f) => columns[f] !== undefined).map((f) => (
                        <td key={f}>{f === "unit" ? (r.unit ?? "шт") : (r[f] ?? "-")}</td>
                      ))}
                    </tr>
                  ))}
                  {warned
                    .filter((r) => rows.indexOf(r) >= 30)
                    .slice(0, 10)
                    .map((r) => (
                      <tr key={r.line} className="warning">
                        <td>{r.line}</td>
                        <td colSpan={FIELDS.filter((f) => columns[f] !== undefined).length}>{r.name}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {rows.length > 30 && <p className="muted">Показаны первые 30 строк.</p>}
            </div>
          ) : (
            <p className="muted">В колонке «Название» пусто - выберите другую колонку.</p>
          )}
          {warned.length > 0 && (
            <ul className="stock-import-warnings muted">
              {warned.slice(0, 10).map((r) => (
                <li key={r.line}>
                  Строка {r.line}: {r.warnings.join("; ")}
                </li>
              ))}
            </ul>
          )}
          {result && "error" in result && (
            <p className="form-error" role="alert">
              {result.error === "network"
                ? "Нет связи с сервером - попробуйте ещё раз: повторная загрузка ничего не задвоит."
                : (STOCK_ERROR_TEXT[result.error] ?? STOCK_ERROR_TEXT.save)}
            </p>
          )}
          <div className="simple-operation-actions">
            <button type="button" className="button primary" disabled={!rows.length || saving} onClick={() => void upload()}>
              {saving ? "Загружаем…" : `Загрузить товаров: ${Math.min(rows.length, MAX_ROWS)}`}
            </button>
          </div>
          <p className="operation-hint">
            Товар с тем же кодом или названием обновится (цена, единица), остаток станет как в файле. Новые - добавятся.
            Повторная загрузка того же файла ничего не задвоит.
          </p>
        </>
      )}
    </div>
  );
}
