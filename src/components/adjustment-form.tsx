"use client";

import { useRef, useState } from "react";
import { commitAdjustment } from "@/app/(workspace)/money/actions";
import { amountFromInput } from "@/lib/credit-limit";
import { money } from "@/lib/format";
import { partyCurrency, type Currency } from "@/lib/currency";
import { ConfirmDialog } from "./confirm-dialog";
import { PartyPicker, type PickerParty } from "./party-picker";
import { Submit } from "./submit";

/**
 * Скидка или возврат товара (ТЗ §5). Больше долга нельзя — скидкой не
 * делается аванс (задача 3): «Скидка больше долга (1 650 сом). Записать 1 650?»
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
  const [ask, setAsk] = useState<{ debt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const selected = parties.find((p) => p.id === party);
  const currency = partyCurrency(selected, shopCurrency);
  const debt = selected?.balance != null ? Math.max(Number(selected.balance), 0) : null;
  const word = kind === "discount" ? "Скидка" : "Возврат";

  return (
    <form
      ref={form}
      action={commitAdjustment}
      className="simple-operation-form"
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
        const value = amountFromInput(amount);
        if (!(value > 0)) {
          e.preventDefault();
          setError("Введите сумму больше нуля.");
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
      <fieldset className="adjustment-kind">
        <legend>Что это</legend>
        <label>
          <input type="radio" name="kind" value="discount" checked={kind === "discount"} onChange={() => setKind("discount")} /> Скидка
        </label>
        <label>
          <input type="radio" name="kind" value="return" checked={kind === "return"} onChange={() => setKind("return")} /> Возврат товара
        </label>
      </fieldset>
      <label className="amount-field">
        Сколько (в валюте долга)?
        <input
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
        />
        {debt != null && <small className="muted">Долг сейчас: {money(debt.toFixed(2), currency)} — больше записать нельзя.</small>}
      </label>
      <label>
        Комментарий (обязательно)
        <input name="note" required maxLength={500} placeholder="Например: вернул 2 автомата 16А" />
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
          setAmount(String(value));
          confirmed.current = true;
          // Поле обновится при следующей отрисовке — отправляем после неё.
          setTimeout(() => form.current?.requestSubmit(), 0);
        }}
      />
    </form>
  );
}
