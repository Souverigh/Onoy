import Link from "next/link";
import { money } from "@/lib/format";
import { undoRecent } from "@/app/(workspace)/money/actions";

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
  debtBefore,
  debtAfter,
  debtLabel,
  kind,
  id,
  canUndo,
  reversed,
  children,
  notes,
}: {
  title: string;
  party: string;
  partyHref: string;
  amount: string;
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
}) {
  return (
    <section className={`panel record-result${reversed ? " reversed" : ""}`}>
      <p className="record-result-title">{reversed ? "Запись отменена" : `✓ ${title}`}</p>
      <p className="record-result-main">
        <Link href={partyHref}>{party}</Link> · <strong className="nowrap">{money(amount)}</strong>
      </p>
      {!reversed && (
        <p className="muted">
          {debtLabel}: {money(debtBefore)} → <strong>{money(debtAfter)}</strong>
        </p>
      )}
      {notes}
      {!reversed && <div className="record-result-actions">{children}</div>}
      {!reversed && canUndo && (
        <form action={undoRecent} className="record-result-undo">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="button danger-outline">
            Отменить — ошиблись
          </button>
          <small className="muted">Можно в течение 2 минут, без причины.</small>
        </form>
      )}
    </section>
  );
}
