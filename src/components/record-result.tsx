import Link from "next/link";
import { debtMoney, money } from "@/lib/format";
import { UndoForm } from "./undo-form";

/**
 * Экран результата после записи (ТЗ §15.2, аудит 15.1 п. 1): кто, сколько,
 * долг до → после и действия. «Отменить» — только автору и только первые
 * 2 минуты (undo_recent в базе проверяет то же самое).
 */
export function RecordResult({
  title,
  party,
  partyHref,
  amount,
  currency,
  original,
  debtBefore,
  debtAfter,
  debtLabel,
  kind,
  id,
  canUndo,
  reversed,
  children,
  notes,
  partPayment,
}: {
  title: string;
  party: string;
  partyHref: string;
  amount: string;
  /** Валюта долга контрагента. */
  currency: string;
  /** Запись в другой валюте: «87 800 сом по 87,8». */
  original?: string | null;
  debtBefore: number;
  debtAfter: number;
  /** «Долг клиента» / «Мы должны поставщику». */
  debtLabel: string;
  kind: "sale" | "purchase" | "payment";
  id: string;
  canUndo: boolean;
  reversed: boolean;
  children?: React.ReactNode;
  notes?: React.ReactNode;
  /** Приход: «10 $», внесённые сразу вместе с ним (отменяются вместе, задача 6). */
  partPayment?: string | null;
}) {
  // Без минуса (задача 5): после оплаты больше долга — «переплата 850 сом».
  const after =
    debtAfter < 0 && kind === "payment" && debtBefore >= 0
      ? `переплата ${money((-debtAfter).toFixed(2), currency)}`
      : debtMoney(debtAfter.toFixed(2), currency);
  return (
    <section className={`panel record-result${reversed ? " reversed" : ""}`}>
      <p className="record-result-title">{reversed ? "Запись отменена" : `✓ ${title}`}</p>
      <p className="record-result-main">
        <Link href={partyHref}>{party}</Link> · <strong className="nowrap">{money(amount, currency)}</strong>
        {original && <span className="muted"> ({original})</span>}
      </p>
      {!reversed && (
        <p className="muted">
          {debtLabel}: {debtMoney(debtBefore.toFixed(2), currency)} → <strong>{after}</strong>
        </p>
      )}
      {notes}
      {!reversed && <div className="record-result-actions">{children}</div>}
      {!reversed && canUndo && <UndoForm kind={kind} id={id} partPayment={partPayment} />}
    </section>
  );
}
