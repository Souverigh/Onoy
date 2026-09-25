import Link from "next/link";
import type { Directory } from "@/lib/validation";
import type { Entry } from "@/lib/directory";
import { Submit } from "./submit";
import { saveEntry } from "@/app/(workspace)/[kind]/actions";
export function EntryForm({
  kind,
  entry,
  error,
}: {
  kind: Directory;
  entry?: Entry;
  error?: string;
}) {
  return (
    <form action={saveEntry} className="entry-form">
      <input type="hidden" name="kind" value={kind} />
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <label>
        Название / имя
        <input
          name="name"
          required
          maxLength={160}
          defaultValue={entry?.name}
          placeholder={
            kind === "products" ? "Например, Horoz LED 12W" : "Например, Асан"
          }
        />
      </label>
      {kind === "products" ? (
        <>
          <div className="form-grid">
            <label>
              Артикул (SKU)
              <input
                name="sku"
                defaultValue={entry?.sku ?? ""}
                maxLength={80}
              />
            </label>
            <label>
              Единица измерения
              <select name="unit" defaultValue={entry?.unit ?? "шт"}>
                {["шт", "м", "кг", "упак", "л"].map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <label>
              Закупочная цена, сом
              <input
                name="purchase_price"
                inputMode="decimal"
                defaultValue={entry?.purchase_price ?? "0"}
                required
              />
            </label>
            <label>
              Продажная цена, сом
              <input
                name="sale_price"
                inputMode="decimal"
                defaultValue={entry?.sale_price ?? "0"}
                required
              />
            </label>
            <label>
              Минимальный остаток
              <input
                name="min_stock"
                inputMode="decimal"
                defaultValue={entry?.min_stock ?? "0"}
                required
              />
            </label>
          </div>
          <p className="muted">
            Фактический остаток будет меняться при проведении прихода и продажи.
          </p>
        </>
      ) : (
        <>
          <label>
            Телефон
            <input
              name="phone"
              type="tel"
              maxLength={40}
              defaultValue={entry?.phone ?? ""}
            />
          </label>
          <label>
            Заметка
            <textarea
              name="notes"
              maxLength={2000}
              defaultValue={entry?.notes ?? ""}
              rows={3}
            />
          </label>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error === "duplicate"
            ? "Товар с таким артикулом уже существует."
            : error === "invalid"
              ? "Проверьте заполнение полей. Цены должны быть неотрицательными, до 2 знаков после запятой."
              : "Не удалось сохранить запись. Повторите попытку."}
        </p>
      )}
      <div className="actions">
        <Submit>{entry ? "Сохранить изменения" : "Добавить"}</Submit>
        <Link className="button" href={`/${kind}`}>
          Назад к списку
        </Link>
      </div>
    </form>
  );
}
