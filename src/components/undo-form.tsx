"use client";

import { useRef, useState } from "react";
import { undoRecent } from "@/app/(workspace)/money/actions";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * «Отменить — ошиблись» на экране результата. Приход со «Сразу оплатили» —
 * сначала «Отменить и оплату 10 $?» (по умолчанию — да, задача 6).
 */
export function UndoForm({
  kind,
  id,
  partPayment,
}: {
  kind: "sale" | "purchase" | "payment";
  id: string;
  /** «10 $» — оплата, внесённая вместе с приходом. */
  partPayment?: string | null;
}) {
  const form = useRef<HTMLFormElement>(null);
  const withPayment = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const submit = (alsoPayment: boolean) => {
    if (withPayment.current) withPayment.current.value = alsoPayment ? "1" : "0";
    setAsking(false);
    form.current?.requestSubmit();
  };
  return (
    <form ref={form} action={undoRecent} className="record-result-undo">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input ref={withPayment} type="hidden" name="with_payment" value="1" />
      <button
        type={partPayment ? "button" : "submit"}
        className="button danger-outline"
        onClick={partPayment ? () => setAsking(true) : undefined}
      >
        Отменить - ошиблись
      </button>
      <small className="muted">Можно в течение 2 минут, без причины. Форма откроется снова с тем же фото и суммой.</small>
      {partPayment && (
        <ConfirmDialog
          open={asking}
          title={`Отменить и оплату ${partPayment}?`}
          text="Оплату внесли вместе с этим товаром. Если отменить только товар, долг поставщику станет меньше, чем был."
          confirmLabel="Да, и оплату"
          cancelLabel="Нет, только товар"
          onConfirm={() => submit(true)}
          onCancel={() => submit(false)}
          onDismiss={() => setAsking(false)}
        />
      )}
    </form>
  );
}
