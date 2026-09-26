"use client";

import Link from "next/link";
import { useState } from "react";
import { commitOperation } from "@/app/(workspace)/money/actions";
import { Submit } from "./submit";

type Operation = "purchase" | "sale" | "payment";
type Party = { id: string; name: string };

export function OperationForm({
  kind,
  idempotencyKey,
  customers,
  suppliers,
  error,
}: {
  kind: Operation;
  idempotencyKey: string;
  customers: Party[];
  suppliers: Party[];
  error?: string;
}) {
  const hasCustomers = customers.length > 0;
  const [direction, setDirection] = useState<"incoming" | "outgoing">(
    hasCustomers ? "incoming" : "outgoing",
  );
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

  return (
    <form action={commitOperation} className="simple-operation-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
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
          defaultValue=""
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
          aria-label="Сумма в сомах"
        />
      </label>
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
          />
        </label>
      )}
      <label className="photo-field">
        Фото накладной{kind === "payment" ? " или чека" : ""}
        <input
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          required={kind !== "payment"}
        />
      </label>
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
  );
}
