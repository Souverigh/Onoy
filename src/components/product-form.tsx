"use client";

import { useState } from "react";
import { Submit } from "./submit";
import { QtyStepper } from "./qty-stepper";
import { PriceMarkup } from "./price-markup";
import { VariantPicker, VariantQtyGrid } from "./variant-picker";
import { saveProduct } from "@/app/(workspace)/stock/actions";
import { saveProductModel } from "@/app/(workspace)/stock/model/actions";
import { PRODUCT_UNITS } from "@/lib/stock";
import { CURRENCIES, CURRENCY_SIGN, isCurrency, type Currency } from "@/lib/currency";
import type { Category } from "@/lib/category";
import type { VariantAxisField } from "@/lib/business";
import { attrsKey, combinations, goodsCount, MODEL_LIMITS, variantsSummary } from "@/lib/product-model";
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

/**
 * Товар: новый или правка. С модулем «Размеры и цвета» у нового товара —
 * блок размеров и цветов (решение пользователя 31.10.2026: одна форма).
 * Ничего не выбрали — один обычный товар; выбрали — каждое сочетание
 * станет товаром (save_product_model) с этой единицей, ценами и минимумом.
 * Код и другие названия у такого товара не спрашиваем: код уникален, а
 * одно название на все цвета запутает приход по фото — их вписывают потом
 * на странице каждого товара.
 */
export function ProductForm({
  product,
  currency,
  categories,
  hints,
  variantAxes,
}: {
  product?: ProductEntry;
  currency: Currency;
  /** Категории магазина и подсказки по названию (category.ts). */
  categories: Category[];
  hints: Record<string, string>;
  /** Размеры и цвета — только новому товару и только с модулем. */
  variantAxes?: VariantAxisField[];
}) {
  const sign = CURRENCY_SIGN[currency];
  const [axes, setAxes] = useState(variantAxes ?? []);
  const [unit, setUnit] = useState(product?.unit ?? "шт");
  const [sale, setSale] = useState(field(product?.sale_price));
  const [purchase, setPurchase] = useState(field(product?.purchase_price));
  const [purchaseCurrency, setPurchaseCurrency] = useState(
    isCurrency(product?.purchase_currency) ? product.purchase_currency : currency,
  );
  const [qty, setQty] = useState<Record<string, string>>({});
  const chosen = axes.filter((a) => a.values.length);
  const variants = combinations(chosen);
  const many = variants.length > 0;
  const rows = variants.map((attrs) => ({ attrs, qty: qty[attrsKey(chosen, attrs)] ?? "" }));

  return (
    <form action={many ? saveProductModel : saveProduct} className="entry-form">
      {product && <input type="hidden" name="id" value={product.id} />}
      {many && (
        <>
          <input type="hidden" name="axes" value={JSON.stringify(chosen.map(({ key, values }) => ({ key, values })))} />
          <input type="hidden" name="rows" value={JSON.stringify(rows)} />
        </>
      )}
      <label>
        Название
        <input
          name="name"
          required
          maxLength={many ? MODEL_LIMITS.name : 160}
          defaultValue={product?.name}
          placeholder="Например, Кабель ВВГнг 3х2,5"
          autoFocus={!product}
        />
      </label>
      <div className="form-grid">
        <label>
          Единица
          <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {PRODUCT_UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label>
          Цена продажи, {sign}
          <input
            name="sale_price"
            inputMode="decimal"
            autoComplete="off"
            value={sale}
            onChange={(e) => setSale(e.target.value)}
            placeholder="0"
          />
        </label>
        {!many && (
          <label>
            Код товара
            <input name="sku" maxLength={80} autoComplete="off" defaultValue={product?.sku ?? ""} placeholder="Необязательно" />
            <small className="muted">Артикул, штрихкод или свой номер - по нему тоже ищется.</small>
          </label>
        )}
      </div>
      <CategoryField categories={categories} hints={hints} initial={product?.category_id ?? null} />
      {axes.length > 0 && (
        <section className="variant-block">
          <p className="variant-block-title">
            Размеры и цвета <small>необязательно - не выбрали, будет один товар</small>
          </p>
          <VariantPicker axes={axes} onChange={setAxes} />
          {many && (
            <p className="variant-result">
              Получится <b>{goodsCount(variants.length)}</b>: {variantsSummary(chosen)}. Код товара каждому можно вписать
              потом на его странице.
            </p>
          )}
        </section>
      )}
      {/* Количество при создании — только если товар уже лежит в магазине:
          пришедший от поставщика записывают «Товаром от поставщика» (долг, закупка). */}
      {!product && (
        <details className="more-fields">
          <summary>
            <span className="more-fields-title">Товар уже есть в магазине - указать количество</span>
          </summary>
          <div className="more-fields-body">
            {many ? (
              <>
                <p className="muted model-section-hint">Сколько каждого есть сейчас. Нет - оставьте пустым.</p>
                <VariantQtyGrid
                  chosen={chosen}
                  cell={(attrs) => {
                    const key = attrsKey(chosen, attrs);
                    return (
                      <input
                        className="variant-qty"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        aria-label={`Сколько есть: ${chosen.map((a) => attrs[a.key]).join(", ")}`}
                        value={qty[key] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [key]: e.target.value }))}
                      />
                    );
                  }}
                />
              </>
            ) : (
              <label>
                Сколько есть сейчас
                <QtyStepper name="opening_stock" label="Сколько есть сейчас" />
                <small className="muted">
                  Запишется как начальный остаток. Пришёл от поставщика - оставьте пустым и запишите «Товар от
                  поставщика»: будут долг и цена закупки.
                </small>
              </label>
            )}
          </div>
        </details>
      )}
      <details className="more-fields" open={Boolean(product && (Number(product.purchase_price) || Number(product.min_stock) || product.aliases.length))}>
        <summary>
          <span className="more-fields-title">{many ? "Закупка и минимум" : "Закупка, минимум, другие названия"}</span>
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
                  value={purchase}
                  onChange={(e) => setPurchase(e.target.value)}
                  placeholder="0"
                />
                <select
                  name="purchase_currency"
                  aria-label="Валюта закупки"
                  value={purchaseCurrency}
                  onChange={(e) => setPurchaseCurrency(e.target.value as Currency)}
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
          <PriceMarkup sale={sale} purchase={purchase} purchaseCurrency={purchaseCurrency} currency={currency} unit={unit} />
          {!many && (
            <label>
              Другие названия
              <textarea
                name="aliases"
                rows={2}
                defaultValue={product?.aliases.join(", ") ?? ""}
                placeholder="Как товар пишут в накладных поставщика или называют покупатели - через запятую"
              />
            </label>
          )}
        </div>
      </details>
      <div className="simple-operation-actions">
        <Submit>{product ? "Сохранить" : many ? `Добавить ${goodsCount(variants.length)}` : "Добавить товар"}</Submit>
        {!product && (
          <button className="button" type="submit" name="next" value="new">
            Добавить и ещё один
          </button>
        )}
      </div>
    </form>
  );
}
