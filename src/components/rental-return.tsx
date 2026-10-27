"use client";

import { useState } from "react";
import { returnRental } from "@/app/(workspace)/rentals/actions";
import { Submit } from "./submit";
import { money } from "@/lib/format";
import { daysWord } from "@/lib/rentals";
import type { Currency } from "@/lib/currency";

/**
 * «Вернул» в выдаче: опоздал — одна строка «Доплата за 2 дня: 2 800 сом»
 * с «Взять / Не брать» и «Оплатил / В долг» (сумму можно поправить); залог
 * деньгами — вернуть из кассы (по умолчанию да); документ — напоминание.
 */
export function RentalReturn({
  id,
  count,
  lateDays,
  suggested,
  deposit,
  collateral,
  currency,
}: {
  id: string;
  /** Сколько вещей ещё на руках. */
  count: number;
  lateDays: number;
  /** Доплата по цене за сутки; 0 — не опоздал. */
  suggested: number;
  /** Залог деньгами, если ещё в кассе. */
  deposit: string | null;
  /** «Паспорт · Медина». */
  collateral: string | null;
  currency: Currency;
}) {
  const [takeExtra, setTakeExtra] = useState(true);
  const [paid, setPaid] = useState(true);
  const [edit, setEdit] = useState(false);
  const [extra, setExtra] = useState(String(suggested).replace(".", ","));
  const [depositBack, setDepositBack] = useState(true);
  return (
    <form action={returnRental} id="return" className="panel simple-operation-form rental-return">
      <input type="hidden" name="id" value={id} />
      <h2>Вернули {count > 1 ? `все ${count} вещи` : "вещь"}</h2>
      {suggested > 0 && (
        <div className="rental-extra">
          <p>
            Опоздал на {daysWord(lateDays)}. Доплата:{" "}
            {edit ? (
              <input
                className="rental-extra-input"
                inputMode="decimal"
                autoFocus
                aria-label="Сумма доплаты"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            ) : (
              <button type="button" className="text-button" onClick={() => setEdit(true)} title="Изменить сумму">
                <strong>{money(String(suggested), currency)}</strong> ✎
              </button>
            )}
          </p>
          <span className="method-pills rental-pills" role="group" aria-label="Доплата">
            <button type="button" className={takeExtra && paid ? "active" : ""} aria-pressed={takeExtra && paid} onClick={() => (setTakeExtra(true), setPaid(true))}>
              Оплатил
            </button>
            <button type="button" className={takeExtra && !paid ? "active" : ""} aria-pressed={takeExtra && !paid} onClick={() => (setTakeExtra(true), setPaid(false))}>
              В долг
            </button>
            <button type="button" className={takeExtra ? "" : "active"} aria-pressed={!takeExtra} onClick={() => setTakeExtra(false)}>
              Не брать
            </button>
          </span>
          {takeExtra && (
            <>
              <input type="hidden" name="take_extra" value="1" />
              <input type="hidden" name="extra" value={extra} />
              <input type="hidden" name="extra_paid" value={paid ? "true" : "false"} />
            </>
          )}
        </div>
      )}
      {deposit && (
        <label className="cash-toggle">
          <input type="checkbox" checked={depositBack} onChange={(e) => setDepositBack(e.target.checked)} />
          Вернуть залог {deposit} из кассы
        </label>
      )}
      {deposit && depositBack && <input type="hidden" name="deposit_back" value="1" />}
      {collateral && <p className="muted">Не забудьте отдать: {collateral}.</p>}
      <div className="simple-operation-actions">
        <Submit>Вернул{count > 1 ? " всё" : ""}</Submit>
      </div>
    </form>
  );
}
