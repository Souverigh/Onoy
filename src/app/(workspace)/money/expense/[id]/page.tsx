import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { documentPages, signedPhotoUrl } from "@/lib/storage";
import { memberLabels } from "@/lib/members";
import { expenseCategoryLabel, type ExpensePhoto } from "@/lib/expenses";
import { DocumentPhotos } from "@/components/document-photos";
import { Submit } from "@/components/submit";
import { reverseExpense, undoRecent } from "../../actions";

const UNDO_MS = 2 * 60 * 1000;

// Расход: экран результата сразу после записи (?done=1) и карточка расхода.
export default async function ExpenseDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; undo?: string; error?: string; reversed?: string; cancel?: string }>;
}) {
  const { id } = await params;
  const { done, undo, error, reversed, cancel } = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, user, isOwner } = await getContext();
  const row = (
    await db
      .from("expenses")
      .select("id,spent_on,amount,currency,category,note,photos,document_id,created_at,created_by,reversed_at,reversed_by,reversal_comment")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle()
  ).data;
  if (!row) notFound();
  // Фото — страницы документа; у расходов до миграции 30 — список файлов в самой записи.
  const photos: ExpensePhoto[] = row.document_id
    ? (await documentPages(db, organizationId, row.document_id)).map((p) => ({ path: p.storage_path, mime: p.mime_type }))
    : ((row.photos ?? []) as ExpensePhoto[]);
  const [pages, members] = await Promise.all([
    Promise.all(photos.map(async (p) => ({ url: await signedPhotoUrl(db, p.path), mimeType: p.mime }))),
    memberLabels(db, organizationId),
  ]);
  const author = row.created_by ? members.get(row.created_by)?.name : null;
  const canUndo = row.created_by === user.id && Date.now() - Date.parse(row.created_at) < UNDO_MS;
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${row.spent_on}T12:00:00+06:00`),
  );
  const isReversed = Boolean(row.reversed_at);

  return (
    <>
      <Link className="back-link" href={isOwner ? "/money/expenses" : "/"}>
        ← {isOwner ? "Все расходы" : "На главную"}
      </Link>
      {reversed && <p className="notice success">Расход отменён.</p>}
      {error === "reversal" && <p className="form-error">Не удалось отменить расход. Обновите страницу и попробуйте снова.</p>}
      {error === "comment" && <p className="form-error">Напишите, почему отменяете.</p>}
      {undo === "expired" && <p className="form-error">Прошло больше 2 минут - отменить может владелец с причиной.</p>}
      <section className={`panel record-result${isReversed ? " reversed" : ""}`}>
        <p className="record-result-title">
          {isReversed ? "Расход отменён" : done ? "✓ Расход записан" : "Расход"}
        </p>
        <p className="record-result-main">
          {expenseCategoryLabel(row.category)} · <strong className="nowrap">{money(row.amount, row.currency)}</strong>
        </p>
        {row.note && <p>{row.note}</p>}
        <p className="muted">
          {day}
          {author ? ` · внёс: ${author}` : ""}
        </p>
        {isReversed && row.reversal_comment && <p className="muted">Причина отмены: {row.reversal_comment}</p>}
        {!isReversed && (
          <div className="record-result-actions">
            <Link className="button primary" href="/money/expense">
              Ещё расход
            </Link>
            <Link className="button" href="/">
              На главную
            </Link>
          </div>
        )}
        {!isReversed && canUndo && (
          <form action={undoRecent} className="record-result-undo">
            <input type="hidden" name="kind" value="expense" />
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" className="button danger-outline">
              Отменить - ошиблись
            </button>
            <small className="muted">Можно в течение 2 минут, без причины.</small>
          </form>
        )}
      </section>

      {pages.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <h2>Фото чека</h2>
            {row.document_id && (
              <Link className="text-button" href={`/documents/${row.document_id}`}>
                Документ и распознавание →
              </Link>
            )}
          </div>
          <DocumentPhotos pages={pages} />
        </section>
      )}

      {isOwner && !isReversed && !canUndo && (
        <section className="panel">
          {cancel ? (
            <form action={reverseExpense} className="simple-operation-form">
              <input type="hidden" name="id" value={row.id} />
              <label>
                Почему отменяем?
                <textarea name="comment" required maxLength={500} rows={3} placeholder="Например: ошиблись суммой" />
              </label>
              <div className="simple-operation-actions">
                <Submit>Да, отменить расход</Submit>
                <Link className="text-button" href={`/money/expense/${row.id}`}>
                  Не отменять
                </Link>
              </div>
            </form>
          ) : (
            <Link className="button danger-outline" href={`/money/expense/${row.id}?cancel=1`}>
              Отменить расход
            </Link>
          )}
        </section>
      )}
    </>
  );
}
