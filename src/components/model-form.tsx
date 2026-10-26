"use client";

import Link from "next/link";
import { useState } from "react";
import { Submit } from "./submit";
import { CategoryField } from "./category-field";
import { saveProductModel } from "@/app/(workspace)/stock/model/actions";
import { CURRENCIES, CURRENCY_SIGN, type Currency } from "@/lib/currency";
import type { Category } from "@/lib/category";
import { quantity } from "@/lib/format";
import { addAxisValues, attrsKey, combinations, type ModelAxis, type VariantAttrs } from "@/lib/product-model";

export type ModelAxisField = ModelAxis & { label: string; suggest: readonly string[] };
export type ModelVariant = { id: string; attrs: VariantAttrs; stock: string; archived: boolean };

/** «1 товар», «3 товара», «12 товаров». */
const goods = (n: number) => {
  const mod10 = n % 10,
    mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "товар" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "товара" : "товаров";
  return `${n} ${word}`;
};

/** «85.50» → «85,5» для поля ввода; ноль — пусто. */
const field = (value: string | undefined) => (!value || Number(value) === 0 ? "" : String(Number(value)).replace(".", ","));

/**
 * Модель с размерами и цветами: оси с вариантами, сетка сочетаний с
 * количеством и цены. Новая модель — все сочетания станут товарами; у
 * существующей сетка показывает остатки, а новые размеры и цвета добавляют
 * недостающие товары.
 */
export function ModelForm({
  model,
  axes: initialAxes,
  variants = [],
  prices,
  currency,
  categories,
  hints,
}: {
  model?: { id: string; name: string };
  axes: ModelAxisField[];
  variants?: ModelVariant[];
  prices?: { sale: string; purchase: string; purchaseCurrency: string | null };
  currency: Currency;
  categories: Category[];
  hints: Record<string, string>;
}) {
  const [axes, setAxes] = useState(initialAxes);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const existing = new Map(variants.map((v) => [attrsKey(axes, v.attrs), v]));
  // Значение, у которого уже есть товары, не убрать: товары останутся.
  const used = (key: string, value: string) => variants.some((v) => v.attrs[key] === value);
  const fresh = combinations(axes).filter((attrs) => !existing.has(attrsKey(axes, attrs)));
  const rows = fresh.map((attrs) => ({ attrs, qty: qty[attrsKey(axes, attrs)] ?? "" }));
  const sign = CURRENCY_SIGN[currency];

  const add = (index: number, raw: string) =>
    setAxes((list) => list.map((a, i) => (i === index ? { ...a, values: addAxisValues(a.values, raw) } : a)));
  const remove = (index: number, value: string) =>
    setAxes((list) => list.map((a, i) => (i === index ? { ...a, values: a.values.filter((v) => v !== value) } : a)));

  const cell = (attrs: VariantAttrs) => {
    const key = attrsKey(axes, attrs);
    const variant = existing.get(key);
    if (variant)
      return (
        <Link href={`/stock/${variant.id}`} className={variant.archived ? "variant-cell muted" : "variant-cell"}>
          {variant.archived ? "в архиве" : quantity(variant.stock)}
        </Link>
      );
    return (
      <input
        className="variant-qty"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        aria-label={`Сколько есть: ${axes.map((a) => attrs[a.key]).join(", ")}`}
        value={qty[key] ?? ""}
        onChange={(e) => setQty((q) => ({ ...q, [key]: e.target.value }))}
      />
    );
  };

  // Две оси — таблицей: размеры по столбцам, цвета по строкам; иначе списком.
  const [cols, rowsAxis] = axes.length === 2 ? axes : [null, null];
  const grid =
    cols && rowsAxis && cols.values.length && rowsAxis.values.length ? (
      <div className="table-wrap">
        <table className="variant-grid">
          <thead>
            <tr>
              <th />
              {cols.values.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsAxis.values.map((r) => (
              <tr key={r}>
                <th scope="row">{r}</th>
                {cols.values.map((c) => (
                  <td key={c}>{cell({ [cols.key]: c, [rowsAxis.key]: r })}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <ul className="variant-list">
        {combinations(axes).map((attrs) => (
          <li key={attrsKey(axes, attrs)}>
            <span>{axes.map((a) => attrs[a.key]).join(", ")}</span>
            {cell(attrs)}
          </li>
        ))}
      </ul>
    );

  return (
    <form action={saveProductModel} className="entry-form">
      {model && <input type="hidden" name="model_id" value={model.id} />}
      <input type="hidden" name="axes" value={JSON.stringify(axes.map(({ key, values }) => ({ key, values })))} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      {!model && (
        <label>
          Название модели
          <input name="name" required maxLength={100} placeholder="Например, Футболка Nike" autoFocus />
          <small className="muted">Товары назовутся так: «Футболка Nike (M, Чёрный)».</small>
        </label>
      )}

      {axes.map((axis, index) => (
        <fieldset className="model-axis" key={axis.key}>
          <legend>{axis.label}</legend>
          <div className="model-axis-values">
            {axis.values.map((value) =>
              used(axis.key, value) ? (
                <span key={value} className="model-value">
                  {value}
                </span>
              ) : (
                <button
                  key={value}
                  type="button"
                  className="model-value active"
                  aria-label={`Убрать ${value}`}
                  onClick={() => remove(index, value)}
                >
                  {value} ×
                </button>
              ),
            )}
            {axis.suggest
              .filter((s) => !axis.values.some((v) => v.toLowerCase() === s.toLowerCase()))
              .map((s) => (
                <button key={s} type="button" className="category-chip" onClick={() => add(index, s)}>
                  + {s}
                </button>
              ))}
          </div>
          <div className="model-axis-add">
            <input
              value={drafts[axis.key] ?? ""}
              placeholder={`Свой вариант: ${axis.label.toLowerCase()}`}
              aria-label={`Свой вариант: ${axis.label.toLowerCase()}`}
              onChange={(e) => setDrafts((d) => ({ ...d, [axis.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                add(index, drafts[axis.key] ?? "");
                setDrafts((d) => ({ ...d, [axis.key]: "" }));
              }}
            />
            <button
              type="button"
              className="button"
              onClick={() => {
                add(index, drafts[axis.key] ?? "");
                setDrafts((d) => ({ ...d, [axis.key]: "" }));
              }}
            >
              Добавить
            </button>
          </div>
        </fieldset>
      ))}

      <div className="model-grid-block">
        <h2 className="model-grid-title">{model ? "Остатки" : "Сколько есть сейчас"}</h2>
        <p className="muted">
          {model
            ? "Нажмите на число - откроется товар. Новые размеры и цвета появятся здесь с полем для количества."
            : "Пусто - ноль, можно добавить позже через «Пришло»."}
        </p>
        {grid}
      </div>

      <div className="form-grid">
        <label>
          Цена продажи, {sign}
          <input name="sale_price" inputMode="decimal" autoComplete="off" defaultValue={field(prices?.sale)} placeholder="0" />
        </label>
        <label>
          Цена закупки
          <span className="input-with-select">
            <input
              name="purchase_price"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={field(prices?.purchase)}
              placeholder="0"
            />
            <select name="purchase_currency" aria-label="Валюта закупки" defaultValue={prices?.purchaseCurrency ?? currency}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_SIGN[c]}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>
      {model ? (
        <label className="setting-switch">
          <span>
            <strong>Поставить эти цены всем размерам и цветам</strong>
            <small className="muted">Выключено - цены только у новых. У одного товара цену можно поменять на его странице.</small>
          </span>
          <input type="checkbox" role="switch" name="apply_prices" />
        </label>
      ) : (
        <CategoryField categories={categories} hints={hints} initial={null} />
      )}

      <div className="simple-operation-actions">
        <Submit>
          {model
            ? fresh.length
              ? `Сохранить и добавить ${goods(fresh.length)}`
              : "Сохранить"
            : `Создать ${goods(fresh.length)}`}
        </Submit>
      </div>
    </form>
  );
}
