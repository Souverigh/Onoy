import Link from "next/link";
import { deleteDraft } from "@/app/(workspace)/drafts/actions";
import { ConfirmButton } from "./confirm-button";
import { getContext } from "@/lib/context";
import { draftData, type DraftKind } from "@/lib/drafts";
import { isCurrency } from "@/lib/currency";
import { money } from "@/lib/format";
import { memberLabels } from "@/lib/members";

const PAGE = 50;

type Row = {
  id: string;
  total: string;
  occurred_at: string;
  reversed_at: string | null;
  reversal_comment: string | null;
  document_id: string | null;
  paid_immediately?: boolean;
  created_by: string | null;
  party_id: string;
  party: { name: string; currency: string | null } | null;
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bishkek" }).format(new Date(value));
const shortDateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value));

/**
 * Разделы «Продажи» и «Приход» (просьба пользователя 17.10.2026): сверху
 * «+ Продажа» / «+ Приход», под ней свои черновики, ниже — таблица записей.
 */
export async function RecordsPage({
  kind,
  searchParams,
}: {
  kind: DraftKind;
  searchParams: Promise<{ page?: string; deleted?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { db, organizationId, isOwner, currency: shopCurrency } = await getContext();
  const sale = kind === "sale";
  const base = sale ? "/sales" : "/purchases";
  const current = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));
  const from = (current - 1) * PAGE;
  const records = sale
    ? db
        .from("sales")
        .select(
          "id,total,occurred_at,reversed_at,reversal_comment,document_id,paid_immediately,created_by,party_id:customer_id,party:customers(name,currency)",
        )
    : db
        .from("purchases")
        .select("id,total,occurred_at,reversed_at,reversal_comment,document_id,created_by,party_id:supplier_id,party:suppliers(name,currency)");
  const [recordResult, draftResult, members] = await Promise.all([
    records
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .eq("is_opening", false)
      .order("occurred_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE),
    db
      .from("record_drafts")
      .select("id,data,updated_at")
      .eq("organization_id", organizationId)
      .eq("kind", kind)
      .order("updated_at", { ascending: false })
      .limit(50),
    memberLabels(db, organizationId),
  ]);
  if (recordResult.error) throw new Error(sale ? "Не удалось загрузить продажи" : "Не удалось загрузить приход");
  // Черновики не загрузились (например, миграция ещё не применена) — список записей всё равно виден.
  if (draftResult.error) console.error("RecordsPage: drafts failed", { message: draftResult.error.message });
  const all = (recordResult.data ?? []) as unknown as Row[];
  const rows = all.slice(0, PAGE);
  const hasMore = all.length > PAGE;
  const drafts = (draftResult.data ?? []).map((d) => ({ id: d.id as string, updated_at: d.updated_at as string, data: draftData(d.data) }));

  const newHref = `/money/new?type=${kind}`;
  const currencyOf = (row: Row) => row.party?.currency ?? shopCurrency;
  const partyName = (row: Row) => row.party?.name ?? (sale ? "Клиент" : "Поставщик");
  const recordHref = (row: Row) =>
    row.document_id ? `/documents/${row.document_id}` : sale ? `/money/send/${row.id}` : `/suppliers/${row.party_id}`;
  const authorOf = (row: Row) => (row.created_by ? members.get(row.created_by)?.name : undefined);
  const payment = (row: Row) => (sale ? (row.paid_immediately ? "Наличными" : "В долг") : null);
  const pageHref = (page: number) => (page > 1 ? `${base}?page=${page}` : base);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{sale ? "Продажи" : "Приход"}</h1>
          <p className="muted">
            {sale ? "Все продажи клиентам: в долг и за наличные." : "Товар от поставщиков: что и когда пришло."}
          </p>
        </div>
        <div className="page-heading-actions">
          <Link className="button primary" href={newHref}>
            + {sale ? "Продажа" : "Приход"}
          </Link>
        </div>
      </div>
      {params.deleted === "1" && (
        <p className="notice success" role="status">
          Черновик удалён.
        </p>
      )}
      {params.error === "draft" && (
        <p className="form-error" role="alert">
          Не удалось удалить черновик. Обновите страницу и попробуйте снова.
        </p>
      )}

      {drafts.length > 0 && (
        <section className="panel drafts-panel">
          <div className="section-title">
            <h2>Черновики</h2>
            <span className="muted">Не записаны - долг и склад не изменились</span>
          </div>
          <ul className="draft-list">
            {drafts.map((d) => {
              const count = d.data.lines.length;
              const currency = isCurrency(d.data.currency) ? d.data.currency : shopCurrency;
              return (
                <li key={d.id} className="draft-row">
                  <Link className="draft-main" href={`${newHref}&mode=items&draft=${d.id}`}>
                    <strong>{d.data.partyName || (sale ? "Клиент не выбран" : "Поставщик не выбран")}</strong>
                    <span className="muted">
                      {count ? `${count} ${count === 1 ? "товар" : count < 5 ? "товара" : "товаров"}` : "Без товаров"}
                      {Number(d.data.total) > 0 && ` · ${money(d.data.total, currency)}`}
                      {` · изменён ${shortDateTime(d.updated_at)}`}
                    </span>
                  </Link>
                  <div className="draft-actions">
                    <Link className="button" href={`${newHref}&mode=items&draft=${d.id}`}>
                      Продолжить
                    </Link>
                    <form action={deleteDraft}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <ConfirmButton
                        className="text-button"
                        message="Удалить черновик?"
                        text="Введённые товары пропадут. Записи, долги и склад не изменятся."
                        confirmLabel="Удалить"
                        cancelLabel="Оставить"
                      >
                        Удалить
                      </ConfirmButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="panel operation-history">
        <div className="section-title">
          <h2>{sale ? "Записанные продажи" : "Записанный приход"}</h2>
        </div>
        {rows.length ? (
          <>
            {/* Телефон: список вместо широкой таблицы. */}
            <ul className="op-list-mobile">
              {rows.map((row) => (
                <li key={row.id} className={row.reversed_at ? "op-list-item reversed" : "op-list-item"}>
                  <Link className="op-list-main" href={recordHref(row)}>
                    <strong>{partyName(row)}</strong>
                    {payment(row) && ` · ${payment(row)}`}
                  </Link>
                  <strong className="op-list-amount">{money(row.total, currencyOf(row))}</strong>
                  <span className="op-list-meta muted">
                    {shortDateTime(row.occurred_at)}
                    {authorOf(row) && ` · ${authorOf(row)}`}
                    {row.reversed_at && <span className="tag reversed-tag">отменена</span>}
                  </span>
                  {!row.reversed_at && isOwner && (
                    <Link className="op-list-action" href={`/money/reverse/${kind}/${row.id}`}>
                      Отменить
                    </Link>
                  )}
                  {row.reversed_at && row.reversal_comment && (
                    <span className="op-list-note muted">Причина: {row.reversal_comment}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="table-wrap op-table">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>{sale ? "Клиент" : "Поставщик"}</th>
                    <th>Сумма</th>
                    {sale && <th>Оплата</th>}
                    <th>Кто внёс</th>
                    <th>
                      <span className="sr-only">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={row.reversed_at ? "reversed-row" : ""}>
                      <td>{dateTime(row.occurred_at)}</td>
                      <td>
                        <Link className="entry-link" href={recordHref(row)}>
                          {partyName(row)}
                        </Link>
                        {row.reversed_at && <span className="tag reversed-tag">отменена</span>}
                      </td>
                      <td>{money(row.total, currencyOf(row))}</td>
                      {sale && <td>{payment(row)}</td>}
                      <td className="muted">{authorOf(row) ?? "-"}</td>
                      <td>
                        {row.reversed_at ? (
                          <span className="muted" title={row.reversal_comment ?? undefined}>
                            {row.reversal_comment}
                          </span>
                        ) : isOwner ? (
                          <Link className="text-button" href={`/money/reverse/${kind}/${row.id}`}>
                            Отменить
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(current > 1 || hasMore) && (
              <nav className="pagination" aria-label="Страницы">
                {current > 1 ? <Link href={pageHref(current - 1)}>← Назад</Link> : <span />}
                <span className="muted">Страница {current}</span>
                {hasMore ? <Link href={pageHref(current + 1)}>Дальше →</Link> : <span />}
              </nav>
            )}
          </>
        ) : (
          <div className="empty">
            <h2>{sale ? "Продаж пока нет" : "Прихода пока нет"}</h2>
            <p>
              Нажмите «+ {sale ? "Продажа" : "Приход"}» - запись появится здесь.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
