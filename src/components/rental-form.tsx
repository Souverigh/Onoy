"use client";

import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { issueRental, type RentalState } from "@/app/(workspace)/rentals/actions";
import { PartyPicker, type PickerParty } from "./party-picker";
import { NewCustomerInline } from "./new-customer-inline";
import { Submit } from "./submit";
import { Icon } from "./icon";
import { money } from "@/lib/format";
import { COLLATERAL_KINDS, COLLATERAL_LABEL, DAY_CHOICES, MAX_DAYS, daysWord, rentalTotal, type CollateralKind } from "@/lib/rentals";
import type { Currency } from "@/lib/currency";

/** Вещь склада для выдачи: цена за сутки — цена продажи; free — сколько не на руках; size — размер у модели. */
export type RentalThing = { id: string; name: string; size: string | null; price: number; free: number };
/** Модель с размерами — одной карточкой; вещь без модели — карточка из одной вещи. */
export type RentalGroup = { key: string; name: string; things: RentalThing[] };

const ERROR_TEXT: Record<string, string> = {
  party: "Выберите клиента из списка или добавьте нового.",
  items: "Выберите хотя бы одну вещь.",
  days: "Срок - от 1 до 365 дней.",
  amount: "Проверьте сумму и залог - только цифры.",
  collateral: "Выберите, что оставили в залог.",
  busy: "Одну из вещей только что выдали - обновите страницу и выберите другую.",
  save: "Не получилось записать. Проверьте связь и нажмите ещё раз.",
};

/** Без поиска показываем столько карточек; остальное — поиском или «Показать все». */
const FIRST_GROUPS = 24;

/** «2800.5» → «2800,5» — как в полях формы. */
const asInput = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const parse = (s: string) => Number(s.replace(/\s/g, "").replace(",", ".")) || 0;

/**
 * «Выдать» (модуль «Прокат»): клиент, вещи со склада карточками (у модели —
 * кнопки размеров), на сколько дней, сумма (цены за сутки × дни, можно
 * поправить) и залог. Итог, оплата и «Выдать» — панелью внизу экрана, как в
 * продаже.
 */
export function RentalForm({
  customers,
  groups,
  shopCurrency,
  initialParty = "",
}: {
  customers: PickerParty[];
  groups: RentalGroup[];
  shopCurrency: Currency;
  initialParty?: string;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState<PickerParty[]>([]);
  const allCustomers = useMemo(() => [...customers, ...created], [customers, created]);
  const [party, setParty] = useState(initialParty);
  const [newCustomer, setNewCustomer] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Выбранные вещи: id товара и цена за сутки (строкой, как в поле).
  const [picked, setPicked] = useState<{ id: string; price: string }[]>([]);
  const [days, setDays] = useState(1);
  const [ownDays, setOwnDays] = useState<string | null>(null);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [paid, setPaid] = useState(true);
  const [collateral, setCollateral] = useState<CollateralKind>("passport");
  const [depositOpen, setDepositOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [state, action, saving] = useActionState(async (prev: RentalState, form: FormData): Promise<RentalState> => {
    try {
      return await issueRental(prev, form);
    } catch (err) {
      unstable_rethrow(err);
      return { error: "save" };
    }
  }, {});
  const errorRef = useRef<HTMLParagraphElement>(null);
  const error = localError ?? state.error ?? null;
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [error, state]);

  const byId = useMemo(() => new Map(groups.flatMap((g) => g.things.map((t) => [t.id, { ...t, group: g.name }] as const))), [groups]);
  const chosenCount = (id: string) => picked.filter((p) => p.id === id).length;
  const q = query.trim().toLowerCase();
  const shown = q
    ? groups.filter((g) => g.name.toLowerCase().includes(q) || g.things.some((t) => t.size?.toLowerCase() === q))
    : showAll
      ? groups
      : groups.slice(0, FIRST_GROUPS);
  const autoTotal = rentalTotal(picked.map((p) => parse(p.price)), days);
  const total = amountText == null ? autoTotal : parse(amountText);
  const label = (id: string) => {
    const t = byId.get(id);
    return t ? (t.size ? `${t.group}, ${t.size}` : t.name) : "Вещь";
  };

  function toggle(t: RentalThing) {
    setLocalError(null);
    // Свободна одна штука — нажатие ещё раз убирает; несколько — добавляет следующую.
    if (chosenCount(t.id) >= t.free) setPicked((list) => list.filter((p) => p.id !== t.id));
    else setPicked((list) => [...list, { id: t.id, price: asInput(t.price) }]);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fail = !party ? "party" : !picked.length ? "items" : null;
    if (fail) return setLocalError(fail);
    setLocalError(null);
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} className="simple-operation-form rental-form">
      <input type="hidden" name="idempotency_key" value={key} />
      <PartyPicker
        label="Клиент"
        name="customer_id"
        parties={allCustomers}
        value={party}
        onChange={(id) => {
          setParty(id);
          if (id) setNewCustomer(null);
          if (id && localError === "party") setLocalError(null);
        }}
        shopCurrency={shopCurrency}
        error={error === "party" ? ERROR_TEXT.party : null}
        actions={(close, typed) => (
          <button
            type="button"
            className="party-picker-action"
            onClick={() => {
              close();
              setNewCustomer(typed);
            }}
          >
            + Новый клиент{typed ? ` «${typed}»` : ""}
          </button>
        )}
      />
      {newCustomer != null && (
        <NewCustomerInline
          key={newCustomer}
          shopCurrency={shopCurrency}
          customers={allCustomers}
          initialName={newCustomer}
          onClose={() => setNewCustomer(null)}
          onPickExisting={(id) => {
            setParty(id);
            setNewCustomer(null);
          }}
          onCreated={(c) => {
            setCreated((list) => [...list, c]);
            setParty(c.id);
            setNewCustomer(null);
          }}
        />
      )}

      <div className="rental-things">
        <span className="rental-things-label">Вещи</span>
        {picked.length > 0 && (
          <ul className="rental-picked">
            {picked.map((p, i) => (
              <li key={i}>
                <input type="hidden" name="item" value={`${p.id}:${p.price}`} />
                <span className="rental-picked-name">{label(p.id)}</span>
                <label className="rental-picked-price">
                  <span className="sr-only">Цена за сутки</span>
                  <input
                    inputMode="decimal"
                    value={p.price}
                    onChange={(e) => setPicked((list) => list.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                  />
                  <small className="muted">/ сутки</small>
                </label>
                <button
                  type="button"
                  className="icon-action"
                  aria-label={`Убрать: ${label(p.id)}`}
                  onClick={() => setPicked((list) => list.filter((_, j) => j !== i))}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {groups.length > 6 && (
          <input
            className="rental-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти вещь или размер…"
            aria-label="Найти вещь"
            autoComplete="off"
          />
        )}
        <ul className="rental-catalog">
          {shown.map((g) => (
            <li key={g.key}>
              <span className="rental-catalog-name">{g.name}</span>
              <span className="rental-sizes">
                {g.things.map((t) => {
                  const n = chosenCount(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={n ? "rental-size picked" : "rental-size"}
                      aria-pressed={n > 0}
                      onClick={() => toggle(t)}
                    >
                      {t.size ?? (n ? "Выбрано" : "Выбрать")}
                      {n > 1 && <b> ×{n}</b>}
                      <small>{t.price > 0 ? money(String(t.price), shopCurrency) : "без цены"}</small>
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
        {q && !shown.length && <p className="muted">Свободных вещей с таким названием нет.</p>}
        {!q && !showAll && groups.length > FIRST_GROUPS && (
          <button type="button" className="text-button" onClick={() => setShowAll(true)}>
            Показать все ({groups.length})
          </button>
        )}
        {error === "items" && (
          <p className="form-error" role="alert">
            {ERROR_TEXT.items}
          </p>
        )}
      </div>

      <div className="rental-field">
        <span className="rental-field-label">На сколько дней</span>
        <span className="method-pills rental-pills" role="group" aria-label="На сколько дней">
          {DAY_CHOICES.map((d) => (
            <button
              key={d}
              type="button"
              className={ownDays == null && days === d ? "active" : ""}
              aria-pressed={ownDays == null && days === d}
              onClick={() => {
                setDays(d);
                setOwnDays(null);
              }}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            className={ownDays != null ? "active" : ""}
            aria-pressed={ownDays != null}
            onClick={() => setOwnDays(ownDays ?? "")}
          >
            Другое
          </button>
        </span>
        {ownDays != null && (
          <input
            className="rental-days-input"
            inputMode="numeric"
            autoFocus
            placeholder="Сколько дней"
            aria-label="Сколько дней"
            value={ownDays}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 3);
              setOwnDays(v);
              const n = Number(v);
              if (n >= 1 && n <= MAX_DAYS) setDays(n);
            }}
          />
        )}
      </div>
      <input type="hidden" name="days" value={days} />

      <label>
        Сумма за {daysWord(days)}
        <input name="amount" inputMode="decimal" value={amountText ?? asInput(autoTotal)} onChange={(e) => setAmountText(e.target.value)} />
        {amountText != null && parse(amountText) !== autoTotal && (
          <button type="button" className="text-button" onClick={() => setAmountText(null)}>
            Вернуть по ценам: {money(autoTotal.toFixed(2), shopCurrency)}
          </button>
        )}
      </label>

      <div className="rental-field">
        <span className="rental-field-label">Залог</span>
        <span className="method-pills rental-pills" role="group" aria-label="Залог">
          {COLLATERAL_KINDS.map((k) => (
            <button key={k} type="button" className={collateral === k ? "active" : ""} aria-pressed={collateral === k} onClick={() => setCollateral(k)}>
              {k === "none" ? "Без" : COLLATERAL_LABEL[k]}
            </button>
          ))}
        </span>
        <input type="hidden" name="collateral_kind" value={collateral} />
        {collateral !== "none" && (
          <input
            name="collateral_note"
            maxLength={100}
            autoComplete="off"
            placeholder={collateral === "other" ? "Что оставили" : "Чей документ, например: Медина"}
            aria-label="Чей документ или что оставили"
          />
        )}
      </div>

      {depositOpen ? (
        <label>
          Залог деньгами
          <input name="deposit" inputMode="decimal" autoFocus placeholder="0" />
          <small className="muted">Попадёт в кассу строкой «Залоги» и вернётся из неё при возврате вещей.</small>
        </label>
      ) : (
        <button type="button" className="text-button note-toggle" onClick={() => setDepositOpen(true)}>
          + Залог деньгами
        </button>
      )}
      {noteOpen ? (
        <label>
          Комментарий
          <input name="note" maxLength={500} autoFocus autoComplete="off" placeholder="Например: возьмёт ещё галстук завтра" />
        </label>
      ) : (
        <button type="button" className="text-button note-toggle" onClick={() => setNoteOpen(true)}>
          + Комментарий
        </button>
      )}

      {error && error !== "party" && error !== "items" && (
        <p ref={errorRef} className="form-error" role="alert">
          {ERROR_TEXT[error] ?? ERROR_TEXT.save}
        </p>
      )}
      {/* Итог, оплата и «Выдать» прилипают к низу экрана — как в продаже. */}
      <div className="sale-bar">
        <div className="sale-bar-pay">
          {paid && <input type="hidden" name="paid" value="true" />}
          <span className="method-pills" role="group" aria-label="Оплата">
            <button type="button" className={paid ? "active" : ""} aria-pressed={paid} onClick={() => setPaid(true)}>
              Оплатил
            </button>
            <button type="button" className={paid ? "" : "active"} aria-pressed={!paid} onClick={() => setPaid(false)}>
              В долг
            </button>
          </span>
        </div>
        <div className="sale-bar-total">
          <span className="muted">
            {picked.length} шт. · {daysWord(days)}
          </span>
          <strong>{money(total.toFixed(2), shopCurrency)}</strong>
        </div>
        <Submit pending={saving}>Выдать</Submit>
      </div>
    </form>
  );
}
