"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Submit } from "./submit";
import { commitDaySale } from "@/app/(workspace)/day-sales/actions";
import { money, quantity } from "@/lib/format";
import { normalizeText } from "@/lib/match";
import { stockNumber } from "@/lib/stock";
import { menuTotal, writeOff, type Recipe, type SoldItem } from "@/lib/day-sale";

export type DaySaleDish = { id: string; name: string; price: string; category: string | null; recipe: Recipe };
export type DaySaleGood = { id: string; name: string; unit: string; price: string; stock: string };
export type DaySaleStock = { name: string; unit: string; stock: string; purchase_price: string; purchase_currency: string | null };

type Row = { key: string; kind: SoldItem["kind"]; id: string; name: string; price: number; group: string; note?: string };

const GOODS = "Товары со склада";

/**
 * «Продажи за день» кафе (макет 31.10.2026): сколько каких блюд и товаров
 * продали, сколько получили (из них переводом), что спишется со склада.
 * Телефон — список с кнопками − +, итог и «Записать» внизу; компьютер —
 * таблица (количество с клавиатуры) и сводка справа.
 */
export function DaySalesForm({
  date,
  today,
  dishes,
  goods,
  stock,
  currency,
}: {
  date: string;
  today: string;
  dishes: DaySaleDish[];
  goods: DaySaleGood[];
  /** Продукты склада: остаток и цена закупки — для «спишется» и заработка. */
  stock: Record<string, DaySaleStock>;
  currency: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [onlySold, setOnlySold] = useState(false);
  const [received, setReceived] = useState("");
  const [transfer, setTransfer] = useState("");
  const [allOff, setAllOff] = useState(false);
  const [tried, setTried] = useState(false);

  const rows: Row[] = [
    ...[...dishes]
      .sort((a, b) => (a.category ?? "￿").localeCompare(b.category ?? "￿", "ru") || a.name.localeCompare(b.name, "ru"))
      .map((d) => ({ key: `d:${d.id}`, kind: "dish" as const, id: d.id, name: d.name, price: Number(d.price), group: d.category ?? "Блюда" })),
    ...goods.map((g) => ({
      key: `p:${g.id}`,
      kind: "product" as const,
      id: g.id,
      name: g.name,
      price: Number(g.price),
      group: GOODS,
      note: `на складе ${quantity(g.stock)} ${g.unit}`,
    })),
  ];
  const count = (key: string) => Number(stockNumber(qty[key] || "0", 3) ?? 0);
  const sold: SoldItem[] = rows.filter((r) => count(r.key) > 0).map((r) => ({ kind: r.kind, id: r.id, qty: count(r.key), price: r.price }));
  const total = menuTotal(sold);
  const pieces = Math.round(sold.reduce((s, i) => s + i.qty, 0) * 1000) / 1000;
  const recipes = new Map(dishes.map((d) => [d.id, d.recipe]));
  const off = [...writeOff(sold, recipes).entries()]
    .map(([id, need]) => ({ id, need, ...(stock[id] ?? { name: "Продукт", unit: "", stock: "0", purchase_price: "0", purchase_currency: null }) }))
    // Не хватает: нужно больше, чем есть на складе (минус на складе — как ноль).
    .map((p) => ({ ...p, short: Math.round((p.need - Math.max(Number(p.stock), 0)) * 1000) / 1000 }))
    .sort((a, b) => Number(b.short > 0) - Number(a.short > 0) || a.name.localeCompare(b.name, "ru"));
  const cost = off.reduce((s, p) => s + ((p.purchase_currency ?? currency) === currency ? p.need * Number(p.purchase_price) : 0), 0);
  const got = Number(stockNumber(received || String(total), 2) ?? 0);
  const shortages = off.filter((p) => p.short > 0);
  const q = normalizeText(search);
  const shown = rows.filter((r) => (!q || normalizeText(r.name).includes(q)) && (!onlySold || count(r.key) > 0));
  const groups = [...new Set(shown.map((r) => r.group))];
  const payload = JSON.stringify(sold.map((i) => (i.kind === "dish" ? { dish_id: i.id, qty: String(i.qty) } : { product_id: i.id, qty: String(i.qty) })));

  const step = (key: string, by: number) =>
    setQty((all) => {
      const next = Math.max(0, Math.round((count(key) + by) * 1000) / 1000);
      return { ...all, [key]: next ? String(next) : "" };
    });
  const save = <Submit>Записать</Submit>;

  return (
    <form
      action={commitDaySale}
      className="ds-form"
      onSubmit={(e) => {
        if (sold.length) return;
        e.preventDefault();
        setTried(true);
      }}
    >
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="lines" value={payload} />
      <input type="hidden" name="menu_total" value={String(total)} />

      <div className="ds-head">
        <h1>Продажи за день</h1>
        <input
          type="date"
          className="ds-date"
          aria-label="День"
          value={date}
          max={today}
          onChange={(e) => e.target.value && router.push(`/day-sales?date=${e.target.value}`)}
        />
      </div>

      <section className="ds-list">
        <div className="ds-tools">
          <input type="search" placeholder="Найти блюдо или товар" aria-label="Найти блюдо или товар" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="method-pills ds-filter" role="group" aria-label="Показать">
            <button type="button" className={onlySold ? "" : "active"} aria-pressed={!onlySold} onClick={() => setOnlySold(false)}>
              Все
            </button>
            <button type="button" className={onlySold ? "active" : ""} aria-pressed={onlySold} onClick={() => setOnlySold(true)}>
              Проданные{sold.length ? ` (${sold.length})` : ""}
            </button>
          </span>
        </div>
        <div className="ds-row ds-row-head" aria-hidden="true">
          <span>Блюдо или товар</span>
          <span className="ds-price">Цена</span>
          <span className="ds-qty">Продали</span>
          <span className="ds-sum">Сумма</span>
        </div>
        {groups.map((group) => (
          <div key={group} className="ds-group">
            <p className="ds-category">{group}</p>
            {shown
              .filter((r) => r.group === group)
              .map((r) => {
                const n = count(r.key);
                return (
                  <div key={r.key} className={n > 0 ? "ds-row on" : "ds-row"}>
                    <span className="ds-name">
                      {r.name}
                      <small className="ds-sub">
                        {money(r.price, currency)}
                        {r.note ? ` · ${r.note}` : ""}
                      </small>
                      {r.note && <small className="ds-note">{r.note}</small>}
                    </span>
                    <span className="ds-price">{money(r.price, currency)}</span>
                    <span className="ds-qty">
                      <button type="button" className="ds-step" aria-label={`Меньше: ${r.name}`} onClick={() => step(r.key, -1)}>
                        −
                      </button>
                      <input
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        aria-label={`Сколько продали: ${r.name}`}
                        value={qty[r.key] ?? ""}
                        onChange={(e) => setQty((all) => ({ ...all, [r.key]: e.target.value }))}
                      />
                      <button type="button" className="ds-step" aria-label={`Больше: ${r.name}`} onClick={() => step(r.key, 1)}>
                        +
                      </button>
                    </span>
                    <span className="ds-sum">{n > 0 ? money(Math.round(n * r.price * 100) / 100, currency) : ""}</span>
                  </div>
                );
              })}
          </div>
        ))}
        {!shown.length && (
          <p className="muted ds-empty">{rows.length ? "Ничего не нашлось." : "В меню пока нет блюд, а на складе - товаров с ценой продажи."}</p>
        )}
      </section>

      <section className="ds-summary">
        <div className="ds-line">
          <span>Блюд и товаров</span>
          <b>{quantity(pieces)}</b>
        </div>
        <div className="ds-line ds-big">
          <span>По меню</span>
          <b>{money(total, currency)}</b>
        </div>
        <label>
          Получили на самом деле
          <input name="received" inputMode="decimal" autoComplete="off" placeholder={total ? String(total) : "0"} value={received} onChange={(e) => setReceived(e.target.value)} />
        </label>
        <label>
          Из них переводом / QR
          <input name="transfer" inputMode="decimal" autoComplete="off" placeholder="0 - всё наличными" value={transfer} onChange={(e) => setTransfer(e.target.value)} />
          <small className="muted">Остальное - наличными, войдёт в кассу дня.</small>
        </label>
        {sold.length > 0 && cost > 0 && (
          <div className="ds-gain">
            <span>Заработок за день</span>
            <b>≈ {money(Math.round(got - cost), currency)}</b>
          </div>
        )}
        {off.length > 0 && (
          <div className="ds-off">
            <p className="ds-off-title">
              Спишется со склада
              {off.length > 3 && (
                <button type="button" className="text-button" onClick={() => setAllOff(!allOff)}>
                  {allOff ? "свернуть" : `все ${off.length}`}
                </button>
              )}
            </p>
            {(allOff ? off : off.slice(0, 3)).map((p) => (
              <p key={p.id} className={p.short > 0 ? "ds-off-row short" : "ds-off-row"}>
                <span>{p.name}</span>
                <span>
                  {quantity(p.need)} {p.unit}
                  {p.short > 0 ? ` · есть ${quantity(Math.max(Number(p.stock), 0))}` : ""}
                </span>
              </p>
            ))}
            {shortages.length > 0 && (
              <p className="ds-short">
                {shortages.length === 1
                  ? `${shortages[0].name}: не хватает ${quantity(shortages[0].short)} ${shortages[0].unit}.`
                  : `Не хватает ${shortages.length} продуктов.`}{" "}
                Возможно, не записали закупку - остаток уйдёт в минус.
              </p>
            )}
          </div>
        )}
        {tried && !sold.length && <p className="form-error">Отметьте, сколько продали, хотя бы одно блюдо или товар.</p>}
        <div className="ds-save-side">{save}</div>
      </section>

      <div className="ds-bar">
        <span className="ds-bar-total">
          <b>{money(total, currency)}</b>
          <small>{quantity(pieces)} шт.</small>
        </span>
        {save}
      </div>
    </form>
  );
}
