import Link from "next/link";
import { money } from "@/lib/format";
import { ConfirmButton } from "./confirm-button";
import { deleteParty, mergeParty, setArchived, undoMerge } from "@/app/(workspace)/[kind]/actions";

type Other = { id: string; name: string };

/**
 * Удалить / в архив / объединить (ТЗ §15.2, аудит 15.1 п. 5). Без записей —
 * удалить насовсем; с записями — только в архив (история и ссылка остаются);
 * дубли — объединить (владелец), отмена в течение суток.
 */
export function PartyManage({
  kind,
  id,
  name,
  balance,
  currency,
  hasRecords,
  archived,
  mergedInto,
  isOwner,
  others,
  recentMerges,
}: {
  kind: "customers" | "suppliers";
  id: string;
  name: string;
  balance: number;
  currency: string;
  hasRecords: boolean;
  archived: boolean;
  mergedInto: Other | null;
  isOwner: boolean;
  others: Other[];
  recentMerges: { id: string; fromName: string }[];
}) {
  const who = kind === "customers" ? "клиента" : "поставщика";
  // Свёрнуто, пока не нужно: открываем сами, если есть что отменить или объединено.
  return (
    <details className="panel party-fold party-manage" open={Boolean(mergedInto) || recentMerges.length > 0}>
      <summary>
        <span>
          <strong>Управление</strong>
          <small className="muted">
            {hasRecords ? "Архив" : "Удаление"}
            {isOwner && others.length > 0 ? ", объединение дублей" : ""}
          </small>
        </span>
      </summary>
      {mergedInto && (
        <p className="notice">
          Объединён с <Link href={`/${kind}/${mergedInto.id}`}>{mergedInto.name}</Link> — все записи там.
        </p>
      )}
      {recentMerges.map((m) => (
        <form key={m.id} action={undoMerge} className="party-manage-row">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="merge" value={m.id} />
          <span>Сюда объединён «{m.fromName}».</span>
          <ConfirmButton className="button danger-outline" message={`Разъединить «${m.fromName}» и «${name}»?`}>
            Отменить объединение
          </ConfirmButton>
        </form>
      ))}
      {!mergedInto && !hasRecords && (
        <form action={deleteParty} className="party-manage-row">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <span className="muted">Записей нет — можно удалить насовсем.</span>
          <ConfirmButton className="button danger-outline" message={`Удалить ${who} «${name}» насовсем?`}>
            Удалить
          </ConfirmButton>
        </form>
      )}
      {!mergedInto && hasRecords && (
        <form action={setArchived} className="party-manage-row">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="archived" value={archived ? "false" : "true"} />
          <span className="muted">
            {archived
              ? "В архиве: нет в списках и формах, история и ссылка сохранены."
              : "Есть записи — удалить нельзя, можно убрать в архив: история и ссылка сохранятся."}
          </span>
          {archived ? (
            <button className="button" type="submit">
              Вернуть из архива
            </button>
          ) : (
            <ConfirmButton
              className="button danger-outline"
              message={
                balance !== 0
                  ? `У «${name}» ${balance > 0 ? "долг" : "аванс"} ${money(Math.abs(balance), currency)}. Всё равно убрать в архив?`
                  : `Убрать «${name}» в архив?`
              }
            >
              В архив
            </ConfirmButton>
          )}
        </form>
      )}
      {!mergedInto && isOwner && others.length > 0 && (
        <form action={mergeParty} className="party-manage-row">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <label>
            Дубль? Объединить с
            <select name="into" required defaultValue="">
              <option value="">Выберите…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <ConfirmButton
            className="button"
            message={`Все записи и ссылка «${name}» перейдут к выбранному, имя «${name}» станет его синонимом. Отменить можно в течение суток. Объединить?`}
          >
            Объединить
          </ConfirmButton>
        </form>
      )}
    </details>
  );
}
