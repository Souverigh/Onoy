"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Submit } from "./submit";
import { CategoryField } from "./category-field";
import { saveProductModel } from "@/app/(workspace)/stock/model/actions";
import { CURRENCIES, CURRENCY_SIGN, type Currency } from "@/lib/currency";
import type { Category } from "@/lib/category";
import { quantity } from "@/lib/format";
import { addAxisValues, attrsKey, combinations, type ModelAxis, type VariantAttrs } from "@/lib/product-model";

type AxisGroup = { label: string; values: readonly string[] };
export type ModelAxisField = ModelAxis & { label: string; placeholder: string; groups: readonly AxisGroup[] };
export type ModelVariant = { id: string; attrs: VariantAttrs; stock: string; archived: boolean };

/** «85.50» → «85,5» для поля ввода; ноль — пусто. */
const field = (value: string | undefined) => (!value || Number(value) === 0 ? "" : String(Number(value)).replace(".", ","));

/** «1 товар», «3 товара», «12 товаров». */
const goods = (n: number) => {
  const mod10 = n % 10,
    mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "товар" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "товара" : "товаров";
  return `${n} ${word}`;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Порядок как в подсказках (XS, S, M…), свои — в конце, как добавили. */
function ordered(values: readonly string[], groups: readonly AxisGroup[]) {
  const known = [...new Set(groups.flatMap((g) => g.values))];
  return [
    ...known.flatMap((k) => values.filter((v) => same(v, k))),
    ...values.filter((v) => !known.some((k) => same(k, v))),
  ];
}

/**
 * Выбор размеров или цветов: кнопка со списком выбранного, по нажатию —
 * группы с галочками, «Выбрать все» и свой вариант. Значения, у которых уже
 * есть товары (locked), не снять.
 */
function AxisPicker({
  axis,
  locked,
  onChange,
}: {
  axis: ModelAxisField;
  locked: (value: string) => boolean;
  onChange: (values: string[]) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState("");
  const has = (value: string) => axis.values.some((v) => same(v, value));
  const set = (values: string[]) => onChange(ordered(values, axis.groups));
  const toggle = (value: string) =>
    has(value) ? !locked(value) && set(axis.values.filter((v) => !same(v, value))) : set([...axis.values, value]);
  const own = axis.values.filter((v) => !axis.groups.some((g) => g.values.some((k) => same(k, v))));
  const addOwn = () => {
    set(addAxisValues(axis.values, draft));
    setDraft("");
  };
  const option = (value: string) => (
    <label key={value} className="axis-option">
      <input type="checkbox" checked={has(value)} disabled={has(value) && locked(value)} onChange={() => toggle(value)} />
      <span>{value}</span>
    </label>
  );

  return (
    <div className="axis-field">
      <span className="axis-field-label">{axis.label}</span>
      <details ref={menu} className="more-menu axis-picker">
        <summary className={axis.values.length ? "axis-picker-button" : "axis-picker-button empty"}>
          <span>{axis.values.length ? axis.values.join(", ") : axis.placeholder}</span>
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="more-menu-list axis-picker-panel">
          {axis.groups.map((group) => {
            const all = group.values.every(has);
            return (
              <div key={group.label} className="axis-group">
                <div className="axis-group-head">
                  <strong>{group.label}</strong>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      set(
                        all
                          ? axis.values.filter((v) => locked(v) || !group.values.some((k) => same(k, v)))
                          : [...axis.values, ...group.values.filter((k) => !has(k))],
                      )
                    }
                  >
                    {all ? "Снять все" : "Выбрать все"}
                  </button>
                </div>
                <div className="axis-options">{group.values.map(option)}</div>
              </div>
            );
          })}
          {own.length > 0 && (
            <div className="axis-group">
              <div className="axis-group-head">
                <strong>Свои</strong>
              </div>
              <div className="axis-options">{own.map(option)}</div>
            </div>
          )}
          <div className="model-axis-add">
            <input
              value={draft}
              placeholder="Свой вариант"
              aria-label={`Свой вариант: ${axis.label.toLowerCase()}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addOwn();
              }}
            />
            <button type="button" className="button" onClick={addOwn}>
              Добавить
            </button>
          </div>
          <button type="button" className="button primary axis-done" onClick={() => menu.current?.removeAttribute("open")}>
            Готово
          </button>
        </div>
      </details>
    </div>
  );
}

/**
 * Модель с размерами и цветами, по блокам: модель (название, категория) →
 * размеры и цвета → количество (по умолчанию выключено: новый товар обычно
 * приходит через «Товар от поставщика») → цены. Новая модель — все сочетания
 * станут товарами (цвет можно не выбирать); у существующей таблица
 * показывает остатки, а новые размеры и цвета добавляют недостающие товары.
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
  const [name, setName] = useState(model?.name ?? "");
  // Количество — только если человек явно сказал, что товар уже лежит в магазине.
  const [haveStock, setHaveStock] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  // В модель идут только оси, где что-то выбрано: без цвета — одни размеры.
  const chosen = axes.filter((a) => a.values.length);
  const existing = new Map(variants.map((v) => [attrsKey(chosen, v.attrs), v]));
  const locked = (key: string) => (value: string) => variants.some((v) => v.attrs[key] === value);
  const all = combinations(chosen);
  const fresh = all.filter((attrs) => !existing.has(attrsKey(chosen, attrs)));
  const rows = fresh.map((attrs) => ({ attrs, qty: haveStock ? (qty[attrsKey(chosen, attrs)] ?? "") : "" }));
  const sign = CURRENCY_SIGN[currency];
  const label = (attrs: VariantAttrs) => chosen.map((a) => attrs[a.key]).join(", ");
  const shownName = name.trim() || "Футболка Nike";

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
        aria-label={`Сколько есть: ${label(attrs)}`}
        value={qty[key] ?? ""}
        onChange={(e) => setQty((q) => ({ ...q, [key]: e.target.value }))}
      />
    );
  };

  // Размеры — столбцами; цвета — строками (без цвета — одна строка).
  const [cols, rowsAxis] = chosen;
  const grid =
    cols && chosen.length <= 2 ? (
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
            {(rowsAxis ? rowsAxis.values : [null]).map((r) => (
              <tr key={r ?? "-"}>
                <th scope="row">{r ?? "Кол-во"}</th>
                {cols.values.map((c) => (
                  <td key={c}>{cell(rowsAxis && r ? { [cols.key]: c, [rowsAxis.key]: r } : { [cols.key]: c })}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <ul className="variant-list">
        {all.map((attrs) => (
          <li key={attrsKey(chosen, attrs)}>
            <span>{label(attrs)}</span>
            {cell(attrs)}
          </li>
        ))}
      </ul>
    );

  return (
    <form action={saveProductModel} className="entry-form model-form">
      {model && <input type="hidden" name="model_id" value={model.id} />}
      <input type="hidden" name="axes" value={JSON.stringify(chosen.map(({ key, values }) => ({ key, values })))} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />

      {!model && (
        <section className="model-section">
          <h2 className="model-section-title">1. Модель</h2>
          <div className="form-grid">
            <label>
              Название
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Например, Футболка Nike"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <CategoryField categories={categories} hints={hints} initial={null} />
          </div>
        </section>
      )}

      <section className="model-section">
        <h2 className="model-section-title">{model ? "Размеры и цвета" : "2. Размеры и цвета"}</h2>
        <div className="form-grid">
          {axes.map((axis, index) => (
            <AxisPicker
              key={axis.key}
              axis={axis}
              locked={locked(axis.key)}
              onChange={(values) => setAxes((list) => list.map((a, i) => (i === index ? { ...a, values } : a)))}
            />
          ))}
        </div>
        {!model && fresh.length > 0 && (
          <div className="model-preview">
            <span className="muted">Получится {goods(fresh.length)}:</span>
            {fresh.slice(0, 6).map((attrs) => (
              <span key={attrsKey(chosen, attrs)} className="tag">
                {shownName} ({label(attrs)})
              </span>
            ))}
            {fresh.length > 6 && <span className="muted">и ещё {fresh.length - 6}</span>}
          </div>
        )}
        {model && chosen.length > 0 && (
          <>
            <p className="muted model-section-hint">Остатки. Нажмите на число - откроется товар.</p>
            {grid}
          </>
        )}
      </section>

      {fresh.length > 0 && (
        <section className="model-section">
          <label className="setting-switch">
            <span>
              <strong>{model ? "Новые размеры уже есть в магазине" : "Товар уже есть в магазине"}</strong>
              <small className="muted">
                Включите, чтобы указать, сколько штук лежит сейчас. Товар пришёл от поставщика - оставьте выключенным
                и запишите «Товар от поставщика»: будут долг и цена закупки.
              </small>
            </span>
            <input type="checkbox" role="switch" checked={haveStock} onChange={(e) => setHaveStock(e.target.checked)} />
          </label>
          {haveStock && !model && grid}
        </section>
      )}

      <section className="model-section">
        <h2 className="model-section-title">{model ? "Цены" : "3. Цены"}</h2>
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
        {model && (
          <label className="setting-switch">
            <span>
              <strong>Поставить эти цены всем размерам и цветам</strong>
              <small className="muted">Выключено - цены только у новых. Цену одного товара можно поменять на его странице.</small>
            </span>
            <input type="checkbox" role="switch" name="apply_prices" />
          </label>
        )}
      </section>

      <div className="model-actions">
        {model ? (
          <Submit>{fresh.length ? `Сохранить и добавить ${goods(fresh.length)}` : "Сохранить"}</Submit>
        ) : fresh.length ? (
          <Submit>{`Создать ${goods(fresh.length)}`}</Submit>
        ) : (
          <button type="button" className="button primary" disabled>
            Выберите хотя бы один размер
          </button>
        )}
      </div>
    </form>
  );
}
