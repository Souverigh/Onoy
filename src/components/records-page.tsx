import Link from "next/link";
import { ownWord } from "@/lib/business";
import { deleteDraft } from "@/app/(workspace)/drafts/actions";
import { ConfirmButton } from "./confirm-button";
import { getContext } from "@/lib/context";
import { draftData, type DraftKind } from "@/lib/drafts";
import { isCurrency } from "@/lib/currency";
import { money } from "@/lib/format";
import { memberLabels } from "@/lib/members";
import { pendingCorrections } from "@/lib/correction-pending";
import { bishkekDate } from "@/lib/day-summary";
import { journalData, type JournalRow, type JournalTotal } from "@/lib/journal";
import { journalHref, parseJournal, periodDays, periodText, type JournalSort } from "@/lib/journal-filters";
import { JournalBar } from "./journal-bar";

type Row = JournalRow;
type JournalParams = {
  page?: string;
  deleted?: string;
  error?: string;
  period?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  by?: string;
  sort?: string;
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
 * «+ Продажа» / «+ Приход», под ней свои черновики, ниже — журнал записей
 * как в 1С: период, отборы, сортировка, итоги, выгрузка в Excel.
 */
export async function RecordsPage({
  kind,
  searchParams,
}: {
  kind: DraftKind;
  searchParams: Promise<JournalParams>;
}) {
  const params = await searchParams;
  const { db, organizationId, isOwner, user, currency: shopCurrency, business } = await getContext();
  // Своё слово вида бизнеса («Закупка продуктов» у кафе) вместо «Приход».
  const purchaseWord = ownWord(business, "purchase") ?? "Приход";
  const sale = kind === "sale";
  const base = sale ? "/sales" : "/purchases";
  const today = bishkekDate();
  const filters = parseJournal(params, { allowBy: isOwner });
  const current = filters.page;
  const [journal, draftResult, members, unfinished] = await Promise.all([
    journalData(db, organizationId, kind, filters, today),
    db
      .from("record_drafts")
      .select("id,data,updated_at")
      .eq("organization_id", organizationId)
      .eq("kind", kind)
      .order("updated_at", { ascending: false })
      .limit(50),
    memberLabels(db, organizationId),
    pendingCorrections(db, organizationId, kind),
  ]);
  // Черновики не загрузились (например, миграция ещё не применена) — список записей всё равно виден.
  if (draftResult.error) console.error("RecordsPage: drafts failed", { message: draftResult.error.message });
  const { rows, hasMore } = journal;
  const drafts = (draftResult.data ?? []).map((d) => ({ id: d.id as string, updated_at: d.updated_at as string, data: draftData(d.data) }));

  const newHref = `/money/new?type=${kind}`;
  const currencyOf = (row: Row) => row.party?.currency ?? shopCurrency;
  const partyName = (row: Row) => row.party?.name ?? (sale ? "Клиент" : "Поставщик");
  // Запись открывается там, где она уже есть: по фото — документ, продажа —
  // её накладная, приход без фото — /purchases/<id>.
  const recordHref = (row: Row) =>
    row.document_id ? `/documents/${row.document_id}` : sale ? `/money/send/${row.id}` : `/purchases/${row.id}`;
  const authorOf = (row: Row) => (row.created_by ? members.get(row.created_by)?.name : undefined);
  const payment = (row: Row) => (sale ? (row.paid_immediately ? "Наличными" : "В долг") : null);
  const pageHref = (page: number) => journalHref(base, filters, { page });
  // Заголовок «Дата» / «Сумма» — нажали — сортировка по нему; ещё раз — обратно.
  const sortHref = (column: "date" | "sum") =>
    journalHref(base, filters, {
      sort: (filters.sort === `${column}_desc` ? `${column}_asc` : `${column}_desc`) as JournalSort,
    });
  const sortMark = (column: "date" | "sum") =>
    filters.sort === `${column}_desc` ? " ↓" : filters.sort === `${column}_asc` ? " ↑" : "";
  const days = periodDays(filters, today);
  const filtered = filters.period !== "month" || Boolean(filters.q) || filters.status !== "all" || Boolean(filters.by);
  const people = isOwner && members.size > 1 ? [...members.entries()].map(([id, m]) => ({ id, label: id === user.id ? "Я" : m.name })) : [];
  // Excel — с теми же отборами (только владелец, как и вся выгрузка).
  const query = journalHref("", filters, { page: 1 });
  const exportHref = isOwner ? `/journal/export?kind=${kind}${query ? `&${query.slice(1)}` : ""}` : null;
  const statuses = sale
    ? [
        { value: "all" as const, label: "Все продажи" },
        { value: "debt" as const, label: "В долг" },
        { value: "cash" as const, label: "Наличными" },
        { value: "reversed" as const, label: "Отменённые" },
      ]
    : [
        { value: "all" as const, label: "Весь приход" },
        { value: "active" as const, label: "Действующий" },
        { value: "reversed" as const, label: "Отменённый" },
      ];
  const one = journal.totals.length === 1 ? journal.totals[0] : null;
  const totalMoney = (t: JournalTotal, field: "sum" | "debt" | "cash" = "sum") => money(t[field].toFixed(2), t.currency ?? shopCurrency);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{sale ? "Продажи" : purchaseWord}</h1>
          <p className="muted">
            {sale ? "Все продажи клиентам: в долг и за наличные." : "Товар от поставщиков: что и когда пришло."}
          </p>
        </div>
        <div className="page-heading-actions">
          <Link className="button primary" href={newHref}>
            + {sale ? "Продажа" : purchaseWord}
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

      {/* «Исправить» по фото нажали, а заново не записали: старая запись уже
          отменена — напоминаем и даём продолжить с теми же данными. */}
      {unfinished.length > 0 && (
        <section className="panel drafts-panel">
          <div className="section-title">
            <h2>Не записанные исправления</h2>
          </div>
          <p className="form-error" role="status">
            {sale ? "Эти продажи отменены для исправления, но заново не записаны" : "Этот приход отменён для исправления, но заново не записан"} - в
            долгах {sale ? "их" : "его"} сейчас нет. Нажмите «Продолжить» и запишите.
          </p>
          <ul className="draft-list">
            {unfinished.map((u) => (
              <li key={u.id} className="draft-row">
                <Link className="draft-main" href={u.href}>
                  <strong>{u.partyName}</strong>
                  <span className="muted">
                    {money(u.amount, isCurrency(u.currency) ? u.currency : shopCurrency)} · отменена {shortDateTime(u.reversedAt)}
                  </span>
                </Link>
                <div className="draft-actions">
                  <Link className="button primary" href={u.href}>
                    Продолжить
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
                        text="Введённые товары пропадут. Записи, долги и склад от удаления не изменятся; если это исправление - прошлая запись останется отменённой."
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

      <JournalBar
        base={base}
        filters={filters}
        statuses={statuses}
        partyLabel={sale ? "Клиент" : "Поставщик"}
        people={people}
        exportHref={exportHref}
      />

      <section className="panel operation-history">
        <div className="section-title">
          <h2>
            {sale ? "Продажи" : "Приход"} {periodText(days)}
          </h2>
        </div>
        {/* Итоги — по всем отобранным записям, не только по этой странице; отменённые не считаются. */}
        {(journal.count > 0 || journal.reversedCount > 0) && (
          <div className="journal-totals">
            {journal.totals.map((t) => (
              <div key={t.currency ?? "shop"} className="journal-total">
                <span className="muted">
                  {t.count} {sale ? (t.count === 1 ? "продажа" : t.count < 5 ? "продажи" : "продаж") : t.count === 1 ? "приход" : "прихода"}
                </span>
                <strong>
                  {journal.partial ? "не меньше " : ""}
                  {totalMoney(t)}
                </strong>
                {sale && t.cash > 0 && (
                  <span className="muted">
                    в долг {totalMoney(t, "debt")} · наличными {totalMoney(t, "cash")}
                  </span>
                )}
              </div>
            ))}
            {journal.reversedCount > 0 && filters.status !== "reversed" && (
              <span className="muted journal-reversed">
                Отменено: {journal.reversedCount} - в итог не входят.
              </span>
            )}
          </div>
        )}
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
                    <th aria-sort={filters.sort.startsWith("date") ? (filters.sort.endsWith("asc") ? "ascending" : "descending") : undefined}>
                      <Link className="journal-sort" href={sortHref("date")}>
                        Дата{sortMark("date")}
                      </Link>
                    </th>
                    <th>{sale ? "Клиент" : "Поставщик"}</th>
                    <th aria-sort={filters.sort.startsWith("sum") ? (filters.sort.endsWith("asc") ? "ascending" : "descending") : undefined}>
                      <Link className="journal-sort" href={sortHref("sum")}>
                        Сумма{sortMark("sum")}
                      </Link>
                    </th>
                    {sale && <th>Оплата</th>}
                    <th>Кто внёс</th>
                    <th>
                      <span className="sr-only">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    // Строка нажимается целиком: ссылка с даты растянута на всю строку.
                    <tr key={row.id} className={row.reversed_at ? "record-row reversed-row" : "record-row"}>
                      <td>
                        <Link className="record-row-link" href={recordHref(row)}>
                          {dateTime(row.occurred_at)}
                        </Link>
                      </td>
                      <td>
                        {partyName(row)}
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
                          <Link className="text-button record-row-action" href={`/money/reverse/${kind}/${row.id}`}>
                            Отменить
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {one && (
                  <tfoot>
                    <tr className="journal-total-row">
                      <td colSpan={2}>Итого за период{hasMore || current > 1 ? " (все страницы)" : ""}</td>
                      <td>{totalMoney(one)}</td>
                      <td colSpan={sale ? 3 : 2} />
                    </tr>
                  </tfoot>
                )}
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
            {filtered ? (
              <>
                <h2>По этим отборам ничего нет</h2>
                <p>
                  Попробуйте другой период или{" "}
                  <Link className="text-button" href={base}>
                    сбросьте отборы
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <h2>{sale ? "В этом месяце продаж пока нет" : "В этом месяце прихода пока нет"}</h2>
                <p>
                  Нажмите «+ {sale ? "Продажа" : "Приход"}» - запись появится здесь. Прошлые - кнопка «Всё время» выше.
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
