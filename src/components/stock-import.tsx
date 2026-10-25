"use client";

import Link from "next/link";
import { useState } from "react";
import { importProducts, type ImportResult } from "@/app/(workspace)/stock/actions";
import { readTable, type Book } from "@/lib/xlsx-read";
import { buildXlsx } from "@/lib/xlsx";
import { CURRENCY_NAME, CURRENCY_SIGN, type Currency } from "@/lib/currency";
import {
  COST_CURRENCIES,
  IMPORT_FIELD_LABEL,
  STOCK_ERROR_TEXT,
  costCurrency,
  detectColumns,
  importRows,
  mergeImportRows,
  namelessLines,
  priceColumns,
  type ColumnMap,
  type CostCurrency,
  type ImportField,
  type ImportRow,
} from "@/lib/stock";

const FIELDS: ImportField[] = [
  "name",
  "sku",
  "unit",
  "sale_price",
  "purchase_price",
  "purchase_currency",
  "stock",
  "category",
  "subcategory",
];
const MAX_ROWS = 2000;
// Ошибок в итогах видно сразу; остальные — под «Показать ещё».
const SHOWN_ERRORS = 20;

/** Строка файла, которая не загрузилась, и почему; also — повторы того же товара. */
type Failed = { line: number; also?: number[]; name: string; why: string };

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

/** Ячейка предпросмотра: цена закупки — со знаком своей валюты. */
function previewCell(row: ImportRow, field: ImportField): string {
  if (field === "unit") return row.unit ?? "шт";
  if (field === "purchase_price" && row.purchase_price !== null && row.purchase_currency)
    return `${row.purchase_price} ${CURRENCY_SIGN[row.purchase_currency]}`;
  if (field === "purchase_currency") return row.purchase_currency ? CURRENCY_SIGN[row.purchase_currency] : "-";
  return row[field] ?? "-";
}

export function StockImport({ shopCurrency }: { shopCurrency: Currency }) {
  const [file, setFile] = useState<File | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  // Скрытые в Excel строки (фильтр, «скрыть») — по умолчанию грузим, как и раньше.
  const [skipHidden, setSkipHidden] = useState(false);
  const [header, setHeader] = useState(0);
  const [columns, setColumns] = useState<ColumnMap>({});
  // Валюта закупки для строк, где её нет ни в колонке валюты, ни в ячейке цены.
  const [currency, setCurrency] = useState<CostCurrency>(shopCurrency);
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function pick(file: File | null, sheet = 0) {
    setResult(null);
    setReadError(null);
    setBook(null);
    setFile(file);
    if (!file) return;
    try {
      const opened = await readTable(file, sheet);
      const read = opened.table;
      const found = detectColumns(read);
      setBook(opened);
      setSkipHidden(false);
      setHeader(found?.header ?? -1);
      setColumns(found?.columns ?? { name: 0 });
      // «Цена закупки, $» в шапке — по умолчанию доллары.
      const costColumn = found?.columns.purchase_price;
      const headerCurrency = found && costColumn !== undefined ? costCurrency(read[found.header]?.[costColumn]) : null;
      setCurrency(headerCurrency ?? shopCurrency);
    } catch (error) {
      console.error("readTable failed", error);
      setReadError(
        /\.xls$/i.test(file.name)
          ? "Старый формат .xls не читаем - в Excel: «Файл → Сохранить как → Книга Excel (.xlsx)»."
          : "Не удалось прочитать файл. Нужен .xlsx или .csv.",
      );
    }
  }

  const fileName = file?.name ?? null;
  const hidden = new Set(book?.hidden ?? []);
  // Исходный лист — для скачивания не загруженных строк; table — без скрытых, если их пропускаем.
  const sheetRows = book?.table ?? null;
  const table = sheetRows && skipHidden ? sheetRows.map((r, i) => (hidden.has(i + 1) ? [] : r)) : sheetRows;
  const rows = table ? importRows(table, header, columns, currency) : [];
  // Один товар в нескольких строках — одной строкой, остатки сложены.
  const merged = mergeImportRows(rows);
  const uploaded = merged.slice(0, MAX_ROWS);
  const repeats = rows.length - merged.length;
  const nameless = table ? namelessLines(table, header, columns) : [];
  const hiddenUsed = skipHidden ? [] : rows.filter((r) => hidden.has(r.line)).map((r) => r.line);
  const foreignCost = merged.filter((r) => r.purchase_currency && r.purchase_currency !== shopCurrency).length;
  const warned = rows.filter((r) => r.warnings.length > 0);
  const width = table ? Math.max(0, ...table.slice(0, 50).map((r) => r.length)) : 0;
  const headerCells = table && header >= 0 ? (table[header] ?? []) : [];
  // «Цена опт» и «Цена розн.»: какая колонка взята ценой продажи — видно сразу.
  const otherPrices = priceColumns(headerCells).filter((c) => !Object.values(columns).includes(c));

  async function upload() {
    if (!uploaded.length || saving) return;
    setSaving(true);
    try {
      setResult(
        await importProducts(
          uploaded.map((r) => ({
            name: r.name,
            sku: r.sku,
            unit: r.unit,
            sale_price: r.sale_price,
            purchase_price: r.purchase_price,
            purchase_currency: r.purchase_currency,
            stock: r.stock,
            category: r.category,
            subcategory: r.subcategory,
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

  // Всё, что не попало на склад: ошибки базы, строки без названия, строки сверх MAX_ROWS.
  const failed: Failed[] =
    result && !("error" in result)
      ? [
          ...result.errors.map((e) => {
            const row = uploaded[e.row - 1];
            const why =
              e.error === "sku_other" && e.other
                ? `код «${row?.sku}» уже у товара «${e.other}» - проверьте код`
                : (STOCK_ERROR_TEXT[e.error] ?? "проверьте значения");
            return { line: row?.line ?? e.row, also: row?.also, name: row?.name ?? "", why };
          }),
          ...nameless.map((line) => ({ line, name: "", why: "нет названия" })),
          ...(result.stopped !== undefined ? uploaded.slice(result.stopped) : []).map((r) => ({
            line: r.line,
            also: r.also,
            name: r.name,
            why: "загрузка оборвалась - строка не записана, загрузите файл ещё раз",
          })),
          ...merged.slice(MAX_ROWS).map((r) => ({
            line: r.line,
            also: r.also,
            name: r.name,
            why: `больше ${MAX_ROWS} товаров в одном файле - загрузите их отдельным файлом`,
          })),
        ].sort((x, y) => x.line - y.line)
      : [];

  /** Не загруженные строки — Excel в том же виде, что исходный файл, плюс колонка «Почему». */
  function downloadFailed() {
    if (!sheetRows || !failed.length) return;
    // Повтор товара — все его строки, иначе после исправления остаток сложится не весь.
    const lines = failed.flatMap((f) => [f.line, ...(f.also ?? [])].map((line) => ({ line, why: f.why })));
    lines.sort((x, y) => x.line - y.line);
    const source = lines.map((f) => sheetRows[f.line - 1] ?? []);
    const headerRow = header >= 0 ? (sheetRows[header] ?? []) : [];
    const columnCount = Math.max(headerRow.length, ...source.map((r) => r.length));
    const xlsx = buildXlsx([
      {
        name: "Не загружены",
        columns: [
          ...Array.from({ length: columnCount }, (_, c) => ({ header: headerRow[c] || letter(c), width: c === columns.name ? 40 : 14 })),
          { header: "Почему не загрузилась", width: 60 },
        ],
        rows: lines.map((f, i) => [
          ...Array.from({ length: columnCount }, (_, c) => source[i][c] ?? ""),
          f.why.charAt(0).toUpperCase() + f.why.slice(1),
        ]),
      },
    ]);
    const url = URL.createObjectURL(new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Не загружены - ${(fileName ?? "товары").replace(/\.(xlsx|csv)$/i, "")}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (result && !("error" in result)) {
    const failedItem = (f: Failed) => (
      <li key={f.line}>
        {f.also?.length ? `Строки ${[f.line, ...f.also].join(", ")}` : `Строка ${f.line}`}
        {f.name ? ` «${f.name}»` : ""} - {f.why}
      </li>
    );
    return (
      <div className="stock-import-result">
        <p className="notice success" role="status">
          {result.stopped !== undefined ? "Загружено частично" : "Готово"}: новых товаров - {result.created}, обновлено -{" "}
          {result.updated}.{result.restored ? ` Из архива вернули: ${result.restored}.` : ""}
          {result.categorized ? ` Категория поставлена у ${result.categorized}.` : ""}
        </p>
        {result.stopped !== undefined && (
          <p className="form-error" role="alert">
            Связь оборвалась: записаны первые {result.stopped} товаров из {uploaded.length}, остальные - нет. Загрузите этот
            же файл ещё раз - записанные не задвоятся.
          </p>
        )}
        {result.recoded.length > 0 && (
          <div className="photo-check-mismatch" role="status">
            У {result.recoded.length} товаров сменился код на код из файла:
            <ul>
              {result.recoded.slice(0, SHOWN_ERRORS).map((e) => {
                const row = uploaded[e.row - 1];
                return (
                  <li key={e.row}>
                    Строка {row?.line ?? e.row} «{row?.name}»: было «{e.old}», стало «{row?.sku}»
                  </li>
                );
              })}
            </ul>
            {result.recoded.length > SHOWN_ERRORS && <small className="muted">И ещё {result.recoded.length - SHOWN_ERRORS}.</small>}
          </div>
        )}
        {result.categoryError && (
          <p className="form-error" role="alert">
            Товары загружены, но категории поставить не удалось. Загрузите файл ещё раз - товары не задвоятся.
          </p>
        )}
        {failed.length > 0 && (
          <div className="photo-check-mismatch" role="status">
            Не загрузили строк: {failed.length}. Остальные товары на складе.
            <ul>{failed.slice(0, SHOWN_ERRORS).map(failedItem)}</ul>
            {failed.length > SHOWN_ERRORS && (
              <details>
                <summary>Показать ещё {failed.length - SHOWN_ERRORS}</summary>
                <ul>{failed.slice(SHOWN_ERRORS).map(failedItem)}</ul>
              </details>
            )}
            <button type="button" className="button" onClick={downloadFailed}>
              Скачать эти строки (Excel)
            </button>
            <small className="muted">
              В файле - только эти строки и колонка «Почему не загрузилась». Исправьте и загрузите его снова: остальные
              товары не задвоятся.
            </small>
          </div>
        )}
        <div className="simple-operation-actions">
          <Link className="button primary" href="/stock">
            Открыть склад
          </Link>
          <button type="button" className="button" onClick={() => void pick(null)}>
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
      {book && book.sheets.length > 1 && (
        <label className="stock-import-sheet">
          Лист книги
          <select value={book.sheet} onChange={(e) => void pick(file, Number(e.target.value))}>
            {book.sheets.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
          <small className="muted">В файле листов: {book.sheets.length}. Загружается только выбранный.</small>
        </label>
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
            {columns.purchase_price !== undefined && (
              <label>
                {columns.purchase_currency !== undefined ? "Валюта, если в строке пусто" : "Цена закупки в"}
                <select value={currency} onChange={(e) => setCurrency(e.target.value as CostCurrency)}>
                  {COST_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_NAME[c]} ({CURRENCY_SIGN[c]})
                    </option>
                  ))}
                </select>
                <small className="muted">
                  {columns.purchase_currency !== undefined
                    ? "Если в колонке валюты пусто или «0,29 $» не написано в цене."
                    : "Для всех товаров файла. Разные валюты - добавьте в Excel колонку «Валюта закупки»."}
                </small>
              </label>
            )}
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

          {columns.purchase_price !== undefined && (
            <div className="operation-hint">
              Как писать валюту закупки в Excel - в колонке «Валюта закупки» или рядом с ценой («0,29 $»):
              <ul>
                <li>доллары - $, USD, доллар, у.е.</li>
                <li>рубли - ₽, руб, RUB</li>
                <li>сомы - сом, KGS, с</li>
              </ul>
              Большие или маленькие буквы - неважно.
            </div>
          )}

          <h2>
            Товаров в файле: {merged.length}
            {merged.length > MAX_ROWS && <span className="muted"> - загрузим первые {MAX_ROWS}</span>}
          </h2>
          {repeats > 0 && (
            <p className="photo-check-mismatch" role="status">
              Одни и те же товары повторяются в файле ({repeats} строк) - загрузим каждый один раз: остатки сложим, цену и
              остальное возьмём из последней строки. Строки - в списке ниже.
            </p>
          )}
          {otherPrices.length > 0 && (
            <p className="photo-check-mismatch" role="status">
              В файле несколько колонок цены:{" "}
              {[columns.sale_price, ...otherPrices]
                .filter((c): c is number => c !== undefined)
                .map((c) => `«${headerCells[c]}»`)
                .join(", ")}
              .{" "}
              {columns.sale_price !== undefined
                ? `Ценой продажи взята «${headerCells[columns.sale_price]}» - если нужна другая, выберите её выше.`
                : "Выберите выше, какая из них - цена продажи."}
            </p>
          )}
          {hiddenUsed.length > 0 && (
            <div className="photo-check-mismatch" role="status">
              В Excel скрыто строк с товарами: {hiddenUsed.length} (
              {hiddenUsed.length > 10 ? `строки ${hiddenUsed.slice(0, 10).join(", ")} и ещё ${hiddenUsed.length - 10}` : `строки ${hiddenUsed.join(", ")}`}
              ) - они тоже загрузятся.
              <label className="stock-import-check">
                <input type="checkbox" checked={skipHidden} onChange={(e) => setSkipHidden(e.target.checked)} />
                Не загружать скрытые строки
              </label>
            </div>
          )}
          {skipHidden && (
            <p className="muted">
              Скрытые строки не загрузятся.{" "}
              <button type="button" className="text-button" onClick={() => setSkipHidden(false)}>
                Загрузить и их
              </button>
            </p>
          )}
          {foreignCost > 0 && (
            <p className="muted">
              Цена закупки не в {CURRENCY_SIGN[shopCurrency]} у {foreignCost} товаров - сохраним как есть, в валюте
              закупки. Цена продажи остаётся в {CURRENCY_SIGN[shopCurrency]}.
            </p>
          )}
          {nameless.length > 0 && (
            <p className="photo-check-mismatch" role="status">
              Строк без названия: {nameless.length} - не загрузятся (
              {nameless.length > 10 ? `строки ${nameless.slice(0, 10).join(", ")} и ещё ${nameless.length - 10}` : `строки ${nameless.join(", ")}`}
              ). Если это товары - впишите название в Excel.
            </p>
          )}
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
                        <td key={f}>{previewCell(r, f)}</td>
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
              {warned.slice(0, SHOWN_ERRORS).map((r) => (
                <li key={r.line}>
                  Строка {r.line}: {r.warnings.join("; ")}
                </li>
              ))}
            </ul>
          )}
          {warned.length > SHOWN_ERRORS && (
            <details className="stock-import-warnings-more">
              <summary>Показать ещё {warned.length - SHOWN_ERRORS}</summary>
              <ul className="stock-import-warnings muted">
                {warned.slice(SHOWN_ERRORS).map((r) => (
                  <li key={r.line}>
                    Строка {r.line}: {r.warnings.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result && "error" in result && (
            <p className="form-error" role="alert">
              {result.error === "network"
                ? "Нет связи с сервером - попробуйте ещё раз: повторная загрузка ничего не задвоит."
                : (STOCK_ERROR_TEXT[result.error] ?? STOCK_ERROR_TEXT.save)}
            </p>
          )}
          <div className="simple-operation-actions">
            <button type="button" className="button primary" disabled={!uploaded.length || saving} onClick={() => void upload()}>
              {saving ? "Загружаем…" : `Загрузить товаров: ${uploaded.length}`}
            </button>
          </div>
          <p className="operation-hint">
            Товар с тем же кодом или названием обновится (цена, единица, категория), остаток станет как в файле - даже
            если после скачивания файла были продажи. Товар из архива вернётся. Новые - добавятся. Категории из файла,
            которых ещё нет, создадутся. Повторная загрузка того же файла товары не задвоит.
          </p>
        </>
      )}
    </div>
  );
}
