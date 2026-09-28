import Link from "next/link";
import type { Directory } from "@/lib/validation";
import type { Entry } from "@/lib/directory";
import { Submit } from "./submit";
import { ContactFill } from "./contact-fill";
import { saveEntry } from "@/app/(workspace)/[kind]/actions";
import { CURRENCIES, CURRENCY_NAME, CURRENCY_SIGN, partyCurrency, type Currency } from "@/lib/currency";
export function EntryForm({
  kind,
  entry,
  error,
  shopCurrency,
}: {
  kind: Directory;
  entry?: Entry;
  error?: string;
  shopCurrency: Currency;
}) {
  const sign = CURRENCY_SIGN[partyCurrency(entry, shopCurrency)];
  return (
    <form action={saveEntry} className="entry-form">
      <input type="hidden" name="kind" value={kind} />
      {entry && <input type="hidden" name="id" value={entry.id} />}
      {!entry && kind !== "products" && <ContactFill />}
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
            В какой валюте долг
            <select name="currency" defaultValue={entry?.currency ?? ""}>
              <option value="">Как у магазина — {CURRENCY_NAME[shopCurrency]}</option>
              {CURRENCIES.filter((c) => c !== shopCurrency).map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_NAME[c]} ({CURRENCY_SIGN[c]})
                </option>
              ))}
            </select>
            <small className="muted">
              {kind === "suppliers"
                ? "Если поставщик считает в долларах (как Хороз) — выберите доллар: долг будет в долларах, оплаты в сомах пересчитаются по курсу."
                : "Долг клиента ведётся в этой валюте; записи в другой валюте пересчитываются по курсу."}{" "}
              Сменить можно, пока нет записей.
            </small>
          </label>
          {kind === "customers" && (
            <label>
              Лимит долга, {sign} (необязательно)
              <input
                name="credit_limit"
                inputMode="decimal"
                placeholder="Без лимита"
                defaultValue={entry?.credit_limit ?? ""}
              />
              <small className="muted">
                Если долг после продажи станет больше — форма продажи предупредит.
              </small>
            </label>
          )}
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
            : error === "currency_locked"
              ? "Валюту нельзя сменить: у контрагента уже есть записи в прежней валюте."
            : error === "invalid"
              ? "Проверьте заполнение полей. Суммы — неотрицательные числа, до 2 знаков после запятой."
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
