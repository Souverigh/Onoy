import { Submit } from "./submit";
import { QtyStepper } from "./qty-stepper";
import { saveProduct } from "@/app/(workspace)/stock/actions";
import { PRODUCT_UNITS } from "@/lib/stock";
import { CURRENCIES, CURRENCY_SIGN, isCurrency, type Currency } from "@/lib/currency";
import type { Category } from "@/lib/category";
import { CategoryField } from "./category-field";

export type ProductEntry = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  sale_price: string;
  purchase_price: string;
  /** Валюта цены закупки; null — валюта магазина. */
  purchase_currency: string | null;
  min_stock: string;
  aliases: string[];
  category_id?: string | null;
};

/** «85.50» → «85,5» для поля ввода; ноль — пусто. */
const field = (value: string | undefined) => {
  if (!value || Number(value) === 0) return "";
  return String(Number(value)).replace(".", ",");
};

export function ProductForm({
  product,
  currency,
  categories,
  hints,
}: {
  product?: ProductEntry;
  currency: Currency;
  /** Категории магазина и подсказки по названию (category.ts). */
  categories: Category[];
  hints: Record<string, string>;
}) {
  const sign = CURRENCY_SIGN[currency];
  return (
    <form action={saveProduct} className="entry-form">
      {product && <input type="hidden" name="id" value={product.id} />}
      <label>
        Название
        <input
          name="name"
          required
          maxLength={160}
          defaultValue={product?.name}
          placeholder="Например, Кабель ВВГнг 3х2,5"
          autoFocus={!product}
        />
      </label>
      <div className="form-grid">
        <label>
          Единица
          <select name="unit" defaultValue={product?.unit ?? "шт"}>
            {PRODUCT_UNITS.map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
        </label>
        <label>
          Цена продажи, {sign}
          <input
            name="sale_price"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={field(product?.sale_price)}
            placeholder="0"
          />
        </label>
        {!product && (
          <label>
            Сколько есть сейчас
            <QtyStepper name="opening_stock" label="Сколько есть сейчас" />
            <small className="muted">Можно оставить пустым и добавить позже («Пришло»).</small>
          </label>
        )}
        <label>
          Код товара
          <input name="sku" maxLength={80} autoComplete="off" defaultValue={product?.sku ?? ""} placeholder="Пусто - номер присвоим сами" />
          <small className="muted">Артикул, штрихкод или свой номер - по нему тоже ищется.</small>
        </label>
      </div>
      <CategoryField categories={categories} hints={hints} initial={product?.category_id ?? null} />
      <details className="more-fields" open={Boolean(product && (Number(product.purchase_price) || Number(product.min_stock) || product.aliases.length))}>
        <summary>
          <span className="more-fields-title">Закупка, минимум, другие названия</span>
        </summary>
        <div className="more-fields-body">
          <div className="form-grid">
            <label>
              Цена закупки
              <span className="input-with-select">
                <input
                  name="purchase_price"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={field(product?.purchase_price)}
                  placeholder="0"
                />
                <select
                  name="purchase_currency"
                  aria-label="Валюта закупки"
                  defaultValue={isCurrency(product?.purchase_currency) ? product.purchase_currency : currency}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_SIGN[c]}
                    </option>
                  ))}
                </select>
              </span>
              <small className="muted">Закупаете в долларах - выберите $, продажа останется в {sign}.</small>
            </label>
            <label>
              Минимальный остаток
              <input name="min_stock" inputMode="decimal" autoComplete="off" defaultValue={field(product?.min_stock)} placeholder="0" />
              <small className="muted">Меньше - товар попадёт в «Мало на складе».</small>
            </label>
          </div>
          <label>
            Другие названия
            <textarea
              name="aliases"
              rows={2}
              defaultValue={product?.aliases.join(", ") ?? ""}
              placeholder="Как товар пишут в накладных поставщика или называют покупатели - через запятую"
            />
          </label>
        </div>
      </details>
      <div className="simple-operation-actions">
        <Submit>{product ? "Сохранить" : "Добавить товар"}</Submit>
        {!product && (
          <button className="button" type="submit" name="next" value="new">
            Добавить и ещё один
          </button>
        )}
      </div>
    </form>
  );
}
