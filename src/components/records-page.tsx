import Link from "next/link";
import { ownWord } from "@/lib/business";
import { deleteDraft } from "@/app/(workspace)/drafts/actions";
import { ConfirmButton } from "./confirm-button";
import { Icon } from "./icon";
import { plural } from "./dashboard";
import { getContext } from "@/lib/context";
import { draftData, type DraftKind } from "@/lib/drafts";
import { isCurrency } from "@/lib/currency";
import { money } from "@/lib/format";
import { memberLabels } from "@/lib/members";
import { pendingCorrections } from "@/lib/correction-pending";
import { bishkekDate } from "@/lib/day-summary";
import { JOURNAL_PAGE, journalData, type JournalRow, type JournalTotal } from "@/lib/journal";
import { journalHref, parseJournal, periodButtonLabel, type JournalFilters, type JournalSort } from "@/lib/journal-filters";
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
  tab?: string;
};

const shortDateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value));
const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Bishkek" });
const yearDayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bishkek" });
const yearFormat = new Intl.DateTimeFormat("ru-RU", { year: "numeric", timeZone: "Asia/Bishkek" });
const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" });

/**
 * Разделы «Продажи» и «Приход» (просьба пользователя 17.10.2026, вид — по
 * макету 28.10.2026): сверху «+ Продажа» / «+ Приход», вкладки «Продажи ·
 * Черновики · Отменённые» со счётчиками, отборы, полоса итога, таблица на
 * компьютере и карточки на телефоне. Метка оплаты — только «В долг» или
 * «Наличными»: оплата гасит долг клиента целиком, а не одну продажу.
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
  const tab = params.tab === "drafts" ? "drafts" : filters.status === "reversed" ? "reversed" : "records";
  // Вкладка «Продажи» — только действующие; отменённые — своей вкладкой.
  const listFilters: JournalFilters = filters.status === "all" ? { ...filters, status: "active" } : filters;
  const current = filters.page;
  const [journal, draftResult, members, unfinished] = await Promise.all([
    journalData(db, organizationId, kind, listFilters, today),
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
  // «Кто внёс» — колонкой, только когда в магазине больше одного человека.
  const showAuthor = members.size > 1;
  const authorOf = (row: Row) =>
    row.created_by ? (row.created_by === user.id ? "Я" : members.get(row.created_by)?.name) : undefined;
  // «28 октября»; прошлый год — с годом.
  const day = (value: string) => {
    const date = new Date(value);
    return (yearFormat.format(date) === today.slice(0, 4) ? dayFormat : yearDayFormat).format(date);
  };
  const payTag = (row: Row) =>
    row.reversed_at ? (
      <span className="pay-tag off">Отменена</span>
    ) : sale ? (
      row.paid_immediately ? (
        <span className="pay-tag cash">Наличными</span>
      ) : (
        <span className="pay-tag debt">В долг</span>
      )
    ) : null;
  const pageHref = (page: number) => journalHref(base, filters, { page });
  // Заголовок «Дата» / «Сумма» — нажали — сортировка по нему; ещё раз — обратно.
  const sortHref = (column: "date" | "sum") =>
    journalHref(base, filters, {
      sort: (filters.sort === `${column}_desc` ? `${column}_asc` : `${column}_desc`) as JournalSort,
    });
  const sortMark = (column: "date" | "sum") =>
    filters.sort === `${column}_desc` ? " ↓" : filters.sort === `${column}_asc` ? " ↑" : " ↕";
  const filtered = filters.period !== "month" || Boolean(filters.q) || !["all", "reversed"].includes(filters.status) || Boolean(filters.by);
  const people = isOwner && members.size > 1 ? [...members.entries()].map(([id, m]) => ({ id, label: id === user.id ? "Я" : m.name })) : [];
  // Excel — то, что на вкладке, с теми же отборами (только владелец, как и вся выгрузка).
  const query = journalHref("", listFilters, { page: 1 });
  const exportHref = isOwner ? `/journal/export?kind=${kind}${query ? `&${query.slice(1)}` : ""}` : null;
  // «Отменённые» — вкладка; у прихода других отборов вида нет.
  const statuses =
    sale && tab === "records"
      ? [
          { value: "all" as const, label: "Все продажи" },
          { value: "debt" as const, label: "В долг" },
          { value: "cash" as const, label: "Наличными" },
        ]
      : [];
  const countWord = (n: number) =>
    sale ? plural(n, "продажа", "продажи", "продаж") : plural(n, "приход", "прихода", "приходов");
  const totalMoney = (t: JournalTotal, field: "sum" | "debt" | "cash" = "sum") => money(t[field].toFixed(2), t.currency ?? shopCurrency);
  const shown = tab === "reversed" ? journal.reversedCount : journal.count;
  const first = (current - 1) * JOURNAL_PAGE + 1;

  const tabs = [
    {
      key: "records",
      label: sale ? "Продажи" : purchaseWord,
      count: journal.count,
      href: journalHref(base, filters, { status: filters.status === "reversed" ? "all" : filters.status }),
    },
    { key: "drafts", label: "Черновики", count: drafts.length, href: `${base}?tab=drafts` },
    { key: "reversed", label: "Отменённые", count: journal.reversedCount, href: journalHref(base, filters, { status: "reversed" }) },
  ];

  // «⋯» у записи: открыть, накладная (продажа по фото), отменить (владелец).
  const rowMenu = (row: Row) => (
    <details className="more-menu record-menu">
      <summary className="record-menu-toggle" aria-label={`Действия: ${partyName(row)}`}>
        <Icon name="more" />
      </summary>
      <div className="more-menu-list">
        <Link href={recordHref(row)}>Открыть</Link>
        {sale && row.document_id && <Link href={`/money/send/${row.id}`}>Накладная</Link>}
        {!row.reversed_at && isOwner && (
          <Link className="danger-link" href={`/money/reverse/${kind}/${row.id}`}>
            Отменить
          </Link>
        )}
      </div>
    </details>
  );

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
          отменена — напоминаем над вкладками и даём продолжить с теми же данными. */}
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

      <section className="panel record-panel">
        <nav className="tabs record-tabs" aria-label={sale ? "Продажи" : purchaseWord}>
          {tabs.map((t) => (
            <Link key={t.key} href={t.href} className={t.key === tab ? "selected" : ""} aria-current={t.key === tab ? "page" : undefined}>
              {t.label}
              <span className={t.key === "drafts" && t.count > 0 ? "record-tab-count warn" : "record-tab-count"}>
                {journal.partial && t.key !== "drafts" ? `${t.count}+` : t.count}
              </span>
            </Link>
          ))}
        </nav>

        {tab === "drafts" ? (
          drafts.length > 0 ? (
            <>
              <p className="muted">Не записаны - долг и склад не изменились.</p>
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
            </>
          ) : (
            <div className="empty">
              <h2>Черновиков нет</h2>
              <p>
                Начали {sale ? "продажу" : "приход"} и не записали - {sale ? "она" : "он"} появится здесь, и можно будет продолжить.
              </p>
            </div>
          )
        ) : (
          <>
            <JournalBar
              base={base}
              filters={filters}
              statuses={statuses}
              partyLabel={sale ? "Клиент" : "Поставщик"}
              people={people}
              exportHref={exportHref}
              periodLabel={periodButtonLabel(filters, today)}
            />

            {tab === "records" && drafts.length > 0 && (
              <Link className="record-drafts-line" href={`${base}?tab=drafts`}>
                <span>
                  {drafts.length} {plural(drafts.length, "черновик не записан", "черновика не записаны", "черновиков не записаны")} - долг и
                  склад от них не изменились
                </span>
                <strong>Открыть черновики →</strong>
              </Link>
            )}

            {/* Итог — по всем отобранным записям, не только по этой странице; отменённые не считаются. */}
            {tab === "records" && journal.count > 0 && (
              <div className="record-totals">
                <div>
                  {/* Телефон: число продаж и каждая валюта — своей строкой (globals.css). */}
                  <p className="record-totals-main">
                    <span className="record-totals-what">
                      <b className="record-totals-count">{journal.count}</b> {countWord(journal.count)}
                    </span>
                    <span className="record-totals-dot"> · </span>
                    {journal.partial && "не меньше "}
                    {journal.totals.map((t, i) => (
                      <span key={t.currency ?? "shop"} className="record-totals-sum">
                        {i > 0 && <span className="record-totals-and"> и </span>}
                        <strong>{totalMoney(t)}</strong>
                      </span>
                    ))}
                  </p>
                  {sale && journal.totals.some((t) => t.cash > 0) && (
                    <p className="record-totals-split">
                      {journal.totals
                        .filter((t) => t.cash > 0)
                        .map((t) => `в долг ${totalMoney(t, "debt")} · наличными ${totalMoney(t, "cash")}`)
                        .join("; ")}
                    </p>
                  )}
                </div>
                {journal.reversedCount > 0 && (
                  <span className="record-totals-note">
                    Отменённые ({journal.reversedCount})
                    <br />в итог не входят
                  </span>
                )}
              </div>
            )}
            {tab === "reversed" && journal.reversedCount > 0 && (
              <p className="muted record-reversed-note">Отменённые записи в итоги и долги не входят.</p>
            )}

            {rows.length ? (
              <>
                {/* Телефон: карточки вместо широкой таблицы. */}
                <ul className="record-cards">
                  {rows.map((row) => (
                    <li key={row.id} className={row.reversed_at ? "record-card reversed" : "record-card"}>
                      <div className="record-card-top">
                        <Link className="record-card-link" href={recordHref(row)}>
                          {partyName(row)}
                        </Link>
                        <strong className="record-card-sum">{money(row.total, currencyOf(row))}</strong>
                      </div>
                      <span className="record-card-meta">
                        {day(row.occurred_at)}, {timeFormat.format(new Date(row.occurred_at))}
                      </span>
                      {row.reversed_at && row.reversal_comment && <span className="record-card-meta">Причина: {row.reversal_comment}</span>}
                      <div className="record-card-bottom">
                        {payTag(row)}
                        {showAuthor && <span className="record-card-author">{authorOf(row) ?? "-"}</span>}
                        {rowMenu(row)}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="table-wrap op-table record-table">
                  <table>
                    <thead>
                      <tr>
                        <th aria-sort={filters.sort.startsWith("date") ? (filters.sort.endsWith("asc") ? "ascending" : "descending") : undefined}>
                          <Link className="journal-sort" href={sortHref("date")}>
                            Дата{sortMark("date")}
                          </Link>
                        </th>
                        <th>{sale ? "Клиент" : "Поставщик"}</th>
                        <th
                          className="record-sum"
                          aria-sort={filters.sort.startsWith("sum") ? (filters.sort.endsWith("asc") ? "ascending" : "descending") : undefined}
                        >
                          <Link className="journal-sort" href={sortHref("sum")}>
                            Сумма{sortMark("sum")}
                          </Link>
                        </th>
                        {(sale || tab === "reversed") && <th>{tab === "reversed" ? "Причина" : "Оплата"}</th>}
                        {showAuthor && <th>Кто внёс</th>}
                        <th>
                          <span className="sr-only">Действия</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        // Строка нажимается целиком: ссылка с даты растянута на всю строку.
                        <tr key={row.id} className="record-row">
                          <td>
                            <Link className="record-row-link" href={recordHref(row)}>
                              {day(row.occurred_at)}
                            </Link>
                            <small className="record-time">{timeFormat.format(new Date(row.occurred_at))}</small>
                          </td>
                          <td>{partyName(row)}</td>
                          <td className="record-sum">{money(row.total, currencyOf(row))}</td>
                          {tab === "reversed" ? <td className="muted">{row.reversal_comment ?? "-"}</td> : sale && <td>{payTag(row)}</td>}
                          {showAuthor && <td className="muted">{authorOf(row) ?? "-"}</td>}
                          <td className="record-actions">{rowMenu(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <nav className="record-pages" aria-label="Страницы">
                  <span className="muted">
                    Показано {first}–{first + rows.length - 1} из {shown}
                  </span>
                  {(current > 1 || hasMore) && (
                    <span className="record-pages-buttons">
                      {current > 1 && (
                        <Link className="button" href={pageHref(current - 1)}>
                          ← Назад
                        </Link>
                      )}
                      {hasMore && (
                        <Link className="button" href={pageHref(current + 1)}>
                          Дальше →
                        </Link>
                      )}
                    </span>
                  )}
                </nav>
              </>
            ) : (
              <div className="empty">
                {filtered ? (
                  <>
                    <h2>По этим отборам ничего нет</h2>
                    <p>
                      Попробуйте другой период или{" "}
                      <Link className="text-button" href={tab === "reversed" ? `${base}?status=reversed` : base}>
                        сбросьте отборы
                      </Link>
                      .
                    </p>
                  </>
                ) : tab === "reversed" ? (
                  <>
                    <h2>{sale ? "Отменённых продаж в этом месяце нет" : "Отменённого прихода в этом месяце нет"}</h2>
                    <p>Прошлые месяцы - кнопка периода выше.</p>
                  </>
                ) : (
                  <>
                    <h2>{sale ? "В этом месяце продаж пока нет" : "В этом месяце прихода пока нет"}</h2>
                    <p>Нажмите «+ {sale ? "Продажа" : purchaseWord}» - запись появится здесь. Прошлые - кнопка периода выше.</p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
