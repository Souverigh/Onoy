"use client";

import { useState, type ReactNode } from "react";
import type { VariantAxisField } from "@/lib/business";
import { COLOR_SWATCHES, addAxisValues, attrsKey, combinations, type ModelAxis, type VariantAttrs } from "@/lib/product-model";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Порядок как в подсказках (XS, S, M…), свои — в конце, как добавили. */
function ordered(values: readonly string[], groups: VariantAxisField["groups"]) {
  const known = [...new Set(groups.flatMap((g) => g.values))];
  return [
    ...known.flatMap((k) => values.filter((v) => same(v, k))),
    ...values.filter((v) => !known.some((k) => same(k, v))),
  ];
}

/**
 * Одна ось (макет 31.10.2026): название, справа «Буквенные ▾» и «+ Свой
 * размер»; размеры — сплошной полосой, цвета — кружками. Значения, у которых
 * уже есть товары (locked), не снять.
 */
function AxisChoice({
  axis,
  locked,
  onChange,
}: {
  axis: VariantAxisField;
  locked: (value: string) => boolean;
  onChange: (values: string[]) => void;
}) {
  const has = (value: string) => axis.values.some((v) => same(v, value));
  // Системы размеров (буквенные, цифровые, обувь) — по одной, сразу та, где уже есть выбранное.
  const [tab, setTab] = useState(() => Math.max(0, axis.groups.findIndex((g) => g.values.some(has))));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  // Свои варианты, добавленные здесь: остаются на месте, даже если отметку сняли.
  const [added, setAdded] = useState<string[]>([]);
  const set = (values: string[]) => onChange(ordered(values, axis.groups));
  const toggle = (value: string) =>
    has(value) ? !locked(value) && set(axis.values.filter((v) => !same(v, value))) : set([...axis.values, value]);
  const addOwn = () => {
    const values = addAxisValues(axis.values, draft);
    setAdded((list) => [...list, ...values.filter((v) => !axis.values.includes(v))]);
    set(values);
    setDraft("");
    setAdding(false);
  };
  const group = axis.groups[tab] ?? axis.groups[0];
  const own = [...axis.values, ...added.filter((a) => !has(a))].filter((v) => !axis.groups.some((g) => g.values.some((k) => same(k, v))));
  const shown = [...(group?.values ?? []), ...own];
  const isColor = axis.key === "color";
  // Выбранное в другой системе размеров не видно на полосе — пишем строкой.
  const hidden = axis.values.filter((v) => !shown.some((s) => same(s, v)));

  return (
    <div className="variant-axis">
      <div className="variant-axis-head">
        <span className="variant-axis-name">{axis.label}</span>
        <span className="variant-axis-tools">
          {axis.groups.length > 1 && (
            <select className="variant-system" aria-label="Система размеров" value={tab} onChange={(e) => setTab(Number(e.target.value))}>
              {axis.groups.map((g, i) => (
                <option key={g.label} value={i}>
                  {g.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="variant-add" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {axis.own}
          </button>
        </span>
      </div>
      {adding && (
        <div className="variant-own">
          <input
            autoFocus
            value={draft}
            maxLength={30}
            placeholder={axis.example}
            aria-label={axis.own}
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
      )}
      {isColor ? (
        <div className="variant-swatches" role="group" aria-label={axis.label}>
          {shown.map((value) => {
            const swatch = COLOR_SWATCHES[value];
            const on = has(value);
            return (
              <button
                key={value}
                type="button"
                title={value}
                aria-label={value}
                aria-pressed={on}
                disabled={on && locked(value)}
                className={`${swatch ? "variant-swatch" : "variant-chip"}${swatch?.light ? " light" : ""}${on ? " on" : ""}`}
                style={swatch ? { background: swatch.color } : undefined}
                onClick={() => toggle(value)}
              >
                {swatch ? null : value}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="variant-strip" role="group" aria-label={axis.label}>
          {shown.map((value) => {
            const on = has(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                disabled={on && locked(value)}
                className={on ? "on" : undefined}
                onClick={() => toggle(value)}
              >
                {value}
              </button>
            );
          })}
        </div>
      )}
      {isColor ? (
        <p className="variant-picked">{axis.values.length ? axis.values.join(", ") : <span className="muted">Не выбрано - без цвета</span>}</p>
      ) : (
        hidden.length > 0 && <p className="variant-picked">Ещё выбрано: {hidden.join(", ")}</p>
      )}
    </div>
  );
}

/** Все оси модели одна под другой. */
export function VariantPicker({
  axes,
  onChange,
  locked = () => () => false,
}: {
  axes: VariantAxisField[];
  onChange: (axes: VariantAxisField[]) => void;
  locked?: (key: string) => (value: string) => boolean;
}) {
  return (
    <div className="variant-axes">
      {axes.map((axis, index) => (
        <AxisChoice
          key={axis.key}
          axis={axis}
          locked={locked(axis.key)}
          onChange={(values) => onChange(axes.map((a, i) => (i === index ? { ...a, values } : a)))}
        />
      ))}
    </div>
  );
}

/**
 * Количество по сочетаниям: размеры — столбцами, цвета — строками (без
 * цвета — одна строка); три оси и больше — списком. cell рисует ячейку.
 */
export function VariantQtyGrid({ chosen, cell }: { chosen: readonly ModelAxis[]; cell: (attrs: VariantAttrs) => ReactNode }) {
  const [cols, rowsAxis] = chosen;
  if (!cols) return null;
  if (chosen.length > 2)
    return (
      <ul className="variant-list">
        {combinations(chosen).map((attrs) => (
          <li key={attrsKey(chosen, attrs)}>
            <span>{chosen.map((a) => attrs[a.key]).join(", ")}</span>
            {cell(attrs)}
          </li>
        ))}
      </ul>
    );
  return (
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
  );
}
