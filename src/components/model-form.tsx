"use client";

import Link from "next/link";
import { useState } from "react";
import { Submit } from "./submit";
import { PriceMarkup } from "./price-markup";
import { VariantPicker, VariantQtyGrid } from "./variant-picker";
import { saveProductModel } from "@/app/(workspace)/stock/model/actions";
import { CURRENCIES, CURRENCY_SIGN, isCurrency, type Currency } from "@/lib/currency";
import type { VariantAxisField } from "@/lib/business";
import { quantity } from "@/lib/format";
import { attrsKey, combinations, goodsCount, type VariantAttrs } from "@/lib/product-model";

export type ModelVariant = { id: string; attrs: VariantAttrs; stock: string; archived: boolean };

/** «85.50» → «85,5» для поля ввода; ноль — пусто. */
const field = (value: string | undefined) => (!value || Number(value) === 0 ? "" : String(Number(value)).replace(".", ","));

/**
 * Товар с размерами и цветами после создания (создают в «Новом товаре»):
 * таблица остатков, новые размеры и цвета добавляют недостающие товары,
 * цены — новым или всем сразу.
 */
export function ModelForm({
  model,
  axes: initialAxes,
  variants,
  prices,
  unit,
  currency,
}: {
  model: { id: string; name: string };
  axes: VariantAxisField[];
  variants: ModelVariant[];
  prices?: { sale: string; purchase: string; purchaseCurrency: string | null };
  /** Единица товаров модели — для строки наценки. */
  unit: string;
  currency: Currency;
}) {
  const [axes, setAxes] = useState(initialAxes);
  // Количество — только если человек явно сказал, что новые размеры уже лежат в магазине.
  const [haveStock, setHaveStock] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [sale, setSale] = useState(field(prices?.sale));
  const [purchase, setPurchase] = useState(field(prices?.purchase));
  const [purchaseCurrency, setPurchaseCurrency] = useState(isCurrency(prices?.purchaseCurrency) ? prices.purchaseCurrency : currency);
  // В модель идут только оси, где что-то выбрано.
  const chosen = axes.filter((a) => a.values.length);
  const existing = new Map(variants.map((v) => [attrsKey(chosen, v.attrs), v]));
  const locked = (key: string) => (value: string) => variants.some((v) => v.attrs[key] === value);
  const fresh = combinations(chosen).filter((attrs) => !existing.has(attrsKey(chosen, attrs)));
  const rows = fresh.map((attrs) => ({ attrs, qty: haveStock ? (qty[attrsKey(chosen, attrs)] ?? "") : "" }));
  const sign = CURRENCY_SIGN[currency];

  const cell = (attrs: VariantAttrs) => {
    const key = attrsKey(chosen, attrs);
    const variant = existing.get(key);
    if (variant)
      return (
        <Link href={`/stock/${variant.id}`} className={variant.archived ? "variant-cell muted" : "variant-cell"}>
          {variant.archived ? "в архиве" : quantity(variant.stock)}
        </Link>
      );
    if (!haveStock) return <span className="variant-cell new">новый</span>;
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
  };

  return (
    <form action={saveProductModel} className="entry-form model-form">
      <input type="hidden" name="model_id" value={model.id} />
      <input type="hidden" name="axes" value={JSON.stringify(chosen.map(({ key, values }) => ({ key, values })))} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />

      <section className="model-section">
        <h2 className="model-section-title">Размеры и цвета</h2>
        <VariantPicker axes={axes} onChange={setAxes} locked={locked} />
        {chosen.length > 0 && (
          <>
            <p className="muted model-section-hint">Остатки. Нажмите на число - откроется товар.</p>
            <VariantQtyGrid chosen={chosen} cell={cell} />
          </>
        )}
      </section>

      {fresh.length > 0 && (
        <section className="model-section">
          <label className="setting-switch">
            <span>
              <strong>Новые размеры уже есть в магазине</strong>
              <small className="muted">
                Включите, чтобы указать, сколько штук лежит сейчас. Товар пришёл от поставщика - оставьте выключенным
                и запишите «Товар от поставщика»: будут долг и цена закупки.
              </small>
            </span>
            <input type="checkbox" role="switch" checked={haveStock} onChange={(e) => setHaveStock(e.target.checked)} />
          </label>
        </section>
      )}

      <section className="model-section">
        <h2 className="model-section-title">Цены</h2>
        <div className="form-grid">
          <label>
            Цена продажи, {sign}
            <input name="sale_price" inputMode="decimal" autoComplete="off" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="0" />
          </label>
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
          </label>
        </div>
        <PriceMarkup sale={sale} purchase={purchase} purchaseCurrency={purchaseCurrency} currency={currency} unit={unit} />
        <label className="setting-switch">
          <span>
            <strong>Поставить эти цены всем размерам и цветам</strong>
            <small className="muted">Выключено - цены только у новых. Цену одного товара можно поменять на его странице.</small>
          </span>
          <input type="checkbox" role="switch" name="apply_prices" />
        </label>
      </section>

      <div className="model-actions">
        <Submit>{fresh.length ? `Сохранить и добавить ${goodsCount(fresh.length)}` : "Сохранить"}</Submit>
      </div>
    </form>
  );
}
