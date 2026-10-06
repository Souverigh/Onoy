"use client";

import { useEffect, useRef, useState } from "react";
import { commitAdjustment, customerBoughtLines, type BoughtLine } from "@/app/(workspace)/money/actions";
import { amountFromInput } from "@/lib/credit-limit";
import { money, quantity } from "@/lib/format";
import { partyCurrency, type Currency } from "@/lib/currency";
import { ConfirmDialog } from "./confirm-dialog";
import { InfoTip } from "./info-tip";
import { PartyPicker, type PickerParty } from "./party-picker";
import { Submit } from "./submit";

/** Выбранная к возврату строка: сколько вернул из купленного. */
type Picked = BoughtLine & { back: string };

const plain = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const dayMonth = (day: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(
    new Date(`${day}T12:00:00+06:00`),
  );
const qtyNumber = (value: string) => {
  const n = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Скидка или возврат товара (ТЗ §5). Больше долга нельзя — скидкой не
 * делается аванс (задача 3): «Скидка больше долга (1 650 сом). Записать 1 650?»
 * Возврат от клиента — из того, что он брал: сумма по цене покупки и
 * комментарий считаются сами; сумму можно ввести и вручную.
 */
export function AdjustmentForm({
  parties,
  initial,
  idempotencyKey,
  shopCurrency,
}: {
  /** id — «customers:…» или «suppliers:…». */
  parties: PickerParty[];
  initial: string;
  idempotencyKey: string;
  shopCurrency: Currency;
}) {
  const [party, setParty] = useState(initial);
  const [kind, setKind] = useState<"discount" | "return">("discount");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const [ask, setAsk] = useState<{ debt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Что клиент брал (загружается при выборе клиента и «Возврат товара»).
  const [bought, setBought] = useState<BoughtLine[] | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const selected = parties.find((p) => p.id === party);
  const currency = partyCurrency(selected, shopCurrency);
  const debt = selected?.balance != null ? Math.max(Number(selected.balance), 0) : null;
  const word = kind === "discount" ? "Скидка" : "Возврат";
  const customerId = party.startsWith("customers:") ? party.slice("customers:".length) : null;
  const byItems = kind === "return" && Boolean(customerId) && !manual;

  useEffect(() => {
    setBought(null);
    setPicked([]);
    setQuery("");
    if (kind !== "return" || !customerId) return;
    let live = true;
    customerBoughtLines(customerId)
      .then((lines) => live && setBought(lines))
      .catch((err) => {
        console.error("customerBoughtLines failed", err);
        if (live) setBought([]);
      });
    return () => {
      live = false;
    };
  }, [kind, customerId]);

  // Сумма и комментарий — из выбранных строк (комментарий, пока его не правили).
  const itemsTotal = round(picked.reduce((sum, p) => sum + qtyNumber(p.back) * p.price, 0));
  const itemsNote = picked
    .filter((p) => qtyNumber(p.back) > 0)
    .map((p) => `${quantity(String(qtyNumber(p.back)))} × ${p.name}`)
    .join(", ");
  const usingItems = byItems && picked.length > 0;
  const shownAmount = usingItems ? (itemsTotal ? String(itemsTotal).replace(".", ",") : "") : amount;
  const shownNote = usingItems && !noteTouched ? (itemsNote ? `Вернул: ${itemsNote}` : "") : note;

  const q = plain(query);
  const found = (bought ?? [])
    .filter((l) => !picked.some((p) => p.id === l.id))
    .filter((l) => !q || plain(l.name).includes(q))
    .slice(0, 6);

  function pick(line: BoughtLine) {
    setPicked((list) => [...list, { ...line, back: "1" }]);
    setQuery("");
    setError(null);
  }
  function setBack(id: string, back: string) {
    setPicked((list) => list.map((p) => (p.id === id ? { ...p, back } : p)));
    setError(null);
  }
  function step(p: Picked, delta: number) {
    const next = Math.min(p.qty, Math.max(0, Math.round((qtyNumber(p.back) + delta) * 1000) / 1000));
    setBack(p.id, next ? String(next).replace(".", ",") : "");
  }

  return (
    <form
      ref={form}
      action={commitAdjustment}
      className="simple-operation-form adjustment-form"
      noValidate
      onSubmit={(e) => {
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        if (!party) {
          e.preventDefault();
          setError("Выберите клиента или поставщика.");
          return;
        }
        if (usingItems && picked.some((p) => qtyNumber(p.back) > p.qty)) {
          e.preventDefault();
          setError("Нельзя вернуть больше, чем клиент брал.");
          return;
        }
        const value = amountFromInput(shownAmount);
        if (!(value > 0)) {
          e.preventDefault();
          setError(byItems ? "Выберите, что вернул клиент, или введите сумму вручную." : "Введите сумму больше нуля.");
          return;
        }
        if (debt != null && value - debt > 0.005) {
          e.preventDefault();
          if (debt <= 0) setError(`Долга нет — ${word.toLowerCase()} записать нельзя: скидкой не делается аванс.`);
          else setAsk({ debt });
          return;
        }
        setError(null);
      }}
    >
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="kind" value={kind} />
      <PartyPicker
        label="Клиент или поставщик"
        name="party"
        parties={parties}
        value={party}
        onChange={(id) => {
          setParty(id);
          setError(null);
        }}
        shopCurrency={shopCurrency}
      />
      <div className="method-row" role="group" aria-label="Что это">
        <span>Что это?</span>
        <span className="method-pills">
          <button
            type="button"
            className={kind === "discount" ? "active" : ""}
            aria-pressed={kind === "discount"}
            onClick={() => {
              setKind("discount");
              setError(null);
            }}
          >
            Скидка
          </button>
          <button
            type="button"
            className={kind === "return" ? "active" : ""}
            aria-pressed={kind === "return"}
            onClick={() => {
              setKind("return");
              setError(null);
            }}
          >
            Возврат товара
          </button>
        </span>
      </div>

      {byItems && (
        <div className="return-items">
          <label className="return-search">
            <span className="label-with-tip">
              Что вернул?
              <InfoTip>
                Только товары, которые клиент брал за последние 90 дней, — по цене, по которой он купил. Сумма и
                комментарий посчитаются сами.
              </InfoTip>
            </span>
            <input
              type="search"
              autoComplete="off"
              placeholder="Название товара…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (found[0]) pick(found[0]);
                }
              }}
            />
          </label>
          {bought === null ? (
            <p className="muted">Ищем, что брал клиент…</p>
          ) : bought.length === 0 ? (
            <p className="muted">За 90 дней покупок с товарами нет — введите сумму вручную.</p>
          ) : (
            found.length > 0 && (
              <ul className="return-found">
                {found.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => pick(l)}>
                      <span>{l.name}</span>
                      <small className="muted">
                        брал {quantity(String(l.qty))} {l.unit} × {money(l.price, currency)} · {dayMonth(l.date)}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          {picked.length > 0 && (
            <ul className="return-picked">
              {picked.map((p) => (
                <li key={p.id}>
                  <span className="return-picked-name">
                    {p.name}
                    <small className="muted">
                      × {money(p.price, currency)} · брал {quantity(String(p.qty))} {p.unit}
                    </small>
                  </span>
                  <span className="qty-stepper">
                    <button type="button" aria-label="Меньше" onClick={() => step(p, -1)}>
                      −
                    </button>
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`Сколько вернул: ${p.name}`}
                      value={p.back}
                      aria-invalid={qtyNumber(p.back) > p.qty || undefined}
                      onChange={(e) => setBack(p.id, e.target.value)}
                    />
                    <button type="button" aria-label="Больше" onClick={() => step(p, 1)}>
                      +
                    </button>
                  </span>
                  <strong>{money(round(qtyNumber(p.back) * p.price), currency)}</strong>
                  <button
                    type="button"
                    className="return-remove"
                    aria-label={`Убрать ${p.name}`}
                    onClick={() => setPicked((list) => list.filter((x) => x.id !== p.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setManual(true);
              setError(null);
            }}
          >
            Ввести сумму вручную
          </button>
        </div>
      )}
      {kind === "return" && customerId && manual && (
        <button type="button" className="text-button return-back" onClick={() => setManual(false)}>
          ← Выбрать из того, что брал клиент
        </button>
      )}

      <label className="amount-field">
        <span className="label-with-tip">
          {usingItems ? "Итого возврат" : "Сколько?"}
          <InfoTip>
            В валюте долга.
            {debt != null && <> Долг сейчас: {money(debt.toFixed(2), currency)} — больше записать нельзя.</>}
          </InfoTip>
        </span>
        <input
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          readOnly={usingItems}
          value={shownAmount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
        />
      </label>
      <label>
        <span className="label-with-tip">
          Комментарий
          <InfoTip>Обязательно: за что скидка или что вернули.</InfoTip>
        </span>
        <input
          name="note"
          required
          maxLength={500}
          placeholder="Например: вернул 2 автомата 16А"
          value={shownNote}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteTouched(true);
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Submit>Записать</Submit>
      <ConfirmDialog
        open={ask !== null}
        title={`${word} больше долга (${money((ask?.debt ?? 0).toFixed(2), currency)}). Записать ${money((ask?.debt ?? 0).toFixed(2), currency).replace(/\s\S+$/, "")}?`}
        text="Скидкой или возвратом нельзя сделать аванс — запишем ровно на долг."
        confirmLabel="Да, записать"
        cancelLabel="Нет, исправить"
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          const value = ask?.debt ?? 0;
          setAsk(null);
          // Сумма ровно на долг — уже не по строкам: вводим её как ручную.
          if (usingItems) {
            setNote(shownNote);
            setNoteTouched(true);
            setManual(true);
          }
          setAmount(String(value));
          confirmed.current = true;
          // Поле обновится при следующей отрисовке — отправляем после неё.
          setTimeout(() => form.current?.requestSubmit(), 0);
        }}
      />
    </form>
  );
}
