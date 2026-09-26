"use client";

import Link from "next/link";
import { useState } from "react";
import {
  commitOperation,
  prepareReceiptPayment,
  recognizeInvoicePhoto,
} from "@/app/(workspace)/money/actions";
import { Submit } from "./submit";
import { money } from "@/lib/format";

type Operation = "purchase" | "sale" | "payment";
type Party = { id: string; name: string };
type Suggestion = Party & { balance: string };
type Prefill = {
  documentId: string;
  amount?: string;
  bankRef?: string;
  suggestions: Suggestion[];
};
type InvoiceLine = { n: number; name_raw: string; qty: string; unit: string; price: string };
type InvoiceCheckResult = {
  total_computed: number;
  total_declared: number | null;
  counterparty: { name_raw: string } | null;
  lines: InvoiceLine[];
};
type CheckedPhoto = {
  documentId: string;
  result: InvoiceCheckResult | null;
};

const TOLERANCE = 1;

export function OperationForm({
  kind,
  idempotencyKey,
  customers,
  suppliers,
  error,
  prefill,
}: {
  kind: Operation;
  idempotencyKey: string;
  customers: Party[];
  suppliers: Party[];
  error?: string;
  prefill?: Prefill;
}) {
  const hasCustomers = customers.length > 0;
  const [direction, setDirection] = useState<"incoming" | "outgoing">(
    hasCustomers ? "incoming" : "outgoing",
  );
  const [selectedParty, setSelectedParty] = useState(
    prefill?.suggestions[0]?.id ?? "",
  );
  const [amountValue, setAmountValue] = useState(prefill?.amount ?? "");
  const [checkedPhoto, setCheckedPhoto] = useState<CheckedPhoto | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const parties = direction === "incoming" ? customers : suppliers;
  const confirmLabel =
    kind === "purchase"
      ? "Подтвердить приход"
      : kind === "sale"
        ? "Подтвердить продажу"
        : "Подтвердить оплату";
  const errorText =
    error === "retry"
      ? "Эта запись уже отправлялась. Обновите страницу и проверьте историю."
      : error === "duplicate"
        ? "Такой номер перевода уже учтён."
        : error === "photo"
          ? "Приложите фото накладной — без него запись не сохранится."
          : error === "invalid"
            ? "Проверьте сумму и выбранного контрагента."
            : error === "save"
              ? "Не удалось сохранить запись. Проверьте данные и попробуйте снова."
              : undefined;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setCheckedPhoto(null);
    setCheckNote(null);
    if (!file || (kind !== "purchase" && kind !== "sale")) return;
    setChecking(true);
    try {
      const fd = new FormData();
      fd.set("photo", file);
      const res = await recognizeInvoicePhoto(kind, fd);
      if (res.ok) {
        setCheckedPhoto({ documentId: res.documentId, result: res.result });
      } else if ("documentId" in res && res.documentId) {
        setCheckedPhoto({ documentId: res.documentId, result: null });
        setCheckNote("Не удалось быстро сверить сумму — сверим после сохранения.");
      }
      // no_provider/no_photo/upload_failed без documentId — просто продолжаем как обычно.
    } finally {
      setChecking(false);
    }
  }

  const checkMismatch =
    checkedPhoto?.result && amountValue
      ? Math.abs(checkedPhoto.result.total_computed - Number(amountValue.replace(",", "."))) >
        TOLERANCE
      : false;

  return (
    <>
      {kind === "payment" && !prefill && (
        <form action={prepareReceiptPayment} className="receipt-intake-form">
          <label className="photo-field">
            Есть фото или скриншот квитанции? Сумму и клиента подставим сами.
            <input name="photo" type="file" accept="image/*" capture="environment" />
          </label>
          <button className="button" type="submit">
            Распознать квитанцию
          </button>
        </form>
      )}
      <form action={commitOperation} className="simple-operation-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        {prefill && <input type="hidden" name="document_id" value={prefill.documentId} />}
        {checkedPhoto && <input type="hidden" name="document_id" value={checkedPhoto.documentId} />}
        {checkedPhoto?.result && (
          <input
            type="hidden"
            name="recognized_result"
            value={JSON.stringify(checkedPhoto.result)}
          />
        )}
        {errorText && (
          <p className="form-error" role="alert">
            {errorText}
          </p>
        )}
        {kind === "payment" && (
          <fieldset className="payment-direction">
            <legend>Кому передали деньги?</legend>
            <label>
              <input
                type="radio"
                name="direction"
                value="incoming"
                checked={direction === "incoming"}
                disabled={!hasCustomers}
                onChange={() => setDirection("incoming")}
              />
              Получили от клиента
            </label>
            <label>
              <input
                type="radio"
                name="direction"
                value="outgoing"
                checked={direction === "outgoing"}
                disabled={suppliers.length === 0}
                onChange={() => setDirection("outgoing")}
              />
              Заплатили поставщику
            </label>
          </fieldset>
        )}
        {prefill && prefill.suggestions.length > 0 && direction === "incoming" && (
          <div className="party-suggestions">
            <span className="muted">Похоже, это:</span>
            <div className="party-suggestions-list">
              {prefill.suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`party-suggestion${selectedParty === s.id ? " active" : ""}`}
                  onClick={() => setSelectedParty(s.id)}
                >
                  {s.name} · {money(s.balance)}
                </button>
              ))}
            </div>
          </div>
        )}
        <label>
          {kind === "purchase"
            ? "Поставщик"
            : kind === "sale"
              ? "Клиент"
              : direction === "incoming"
                ? "Клиент"
                : "Поставщик"}
          <select
            name={kind === "purchase" ? "supplier_id" : kind === "sale" ? "customer_id" : "party_id"}
            required
            value={selectedParty}
            onChange={(e) => setSelectedParty(e.target.value)}
          >
            <option value="">Выберите из списка</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name}
              </option>
            ))}
          </select>
        </label>
        <label className="amount-field">
          Сколько сом?
          <input
            name={kind === "payment" ? "amount" : "total"}
            inputMode="decimal"
            autoComplete="off"
            required
            pattern="[0-9]+([.,][0-9]{1,2})?"
            placeholder="0"
            value={amountValue}
            onChange={(e) => setAmountValue(e.target.value)}
            aria-label="Сумма в сомах"
          />
        </label>
        {(kind === "purchase" || kind === "sale") && (
          <div className="photo-check">
            {checking && <p className="muted">Проверяем фото…</p>}
            {checkNote && <p className="muted">{checkNote}</p>}
            {checkedPhoto?.result && (
              <p className={checkMismatch ? "photo-check-mismatch" : "photo-check-ok"}>
                По фото распознано: {money(checkedPhoto.result.total_computed)}
                {checkMismatch && amountValue ? " — отличается от введённой суммы" : " — совпадает"}
                {!amountValue && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setAmountValue(String(checkedPhoto.result!.total_computed))
                      }
                    >
                      Подставить
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {kind === "sale" && (
          <label className="cash-toggle">
            <input type="checkbox" name="paid_immediately" value="true" />
            Клиент оплатил наличными
          </label>
        )}
        {kind === "payment" && (
          <label>
            Номер перевода (если есть)
            <input
              name="bank_reference"
              maxLength={200}
              autoComplete="off"
              placeholder="Необязательно"
              defaultValue={prefill?.bankRef}
            />
          </label>
        )}
        {!prefill && (
          <label className="photo-field">
            Фото накладной{kind === "payment" ? " или чека" : ""}
            <input
              name="photo"
              type="file"
              accept="image/*"
              capture="environment"
              required={kind !== "payment"}
              onChange={handlePhotoChange}
            />
          </label>
        )}
        {prefill && (
          <p className="muted">Фото квитанции уже приложено — распознаём в фоне.</p>
        )}
        <p className="operation-hint">
          {kind === "purchase"
            ? "Сумма сразу добавится к долгу перед поставщиком. Фото — основание записи."
            : kind === "sale"
              ? "Сумма сразу добавится к долгу клиента. Если клиент заплатил — отметьте наличные."
              : "Оплата сразу уменьшит долг контрагента. Если платили переводом — приложите чек."}
        </p>
        <div className="simple-operation-actions">
          <Submit>{confirmLabel}</Submit>
          <Link className="text-button" href="/money">
            Отмена
          </Link>
        </div>
      </form>
    </>
  );
}
