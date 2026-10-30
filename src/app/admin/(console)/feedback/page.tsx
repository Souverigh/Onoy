import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { loadFeedback } from "@/lib/admin-data";
import { FEEDBACK_STATUSES, feedbackDue, isFeedbackStatus, type FeedbackRow } from "@/lib/admin-feedback";
import { agoText, whenText } from "@/lib/admin-people";
import { bishkekDate } from "@/lib/day-summary";
import { FeedbackContactButtons } from "@/components/admin-feedback-contact";

const PAGE = 25;

/** Заявки со страницы входа: статус, кто и как связаться, совпадение с аккаунтом Depter. */
export default async function AdminFeedback({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; page?: string }> }) {
  const { db } = await requirePlatformAdmin();
  const params = await searchParams;
  const all = await loadFeedback(db);
  const today = bishkekDate();
  const now = new Date();
  const filter = params.f === "contact" ? "contact" : isFeedbackStatus(params.f) ? params.f : null;
  const q = (params.q ?? "").trim().toLowerCase().slice(0, 100);
  const rows = all
    .filter((f) => (filter === "contact" ? feedbackDue(f, today) : !filter || f.status === filter))
    .filter((f) => !q || `${f.name} ${f.contact} ${f.message}`.toLowerCase().includes(q));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const href = (change: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ f: filter, q: params.q ?? null, page: null, ...change }))
      if (v !== null && v !== "") next.set(k, String(v));
    const s = next.toString();
    return s ? `/admin/feedback?${s}` : "/admin/feedback";
  };
  const statusOf = (f: FeedbackRow) => FEEDBACK_STATUSES.find((s) => s.key === f.status)!;

  return (
    <>
      <div className="adm-h1">
        <h1>Заявки</h1>
        <span className="muted">Сообщения со страницы входа - от тех, кто хочет подключиться или спрашивает.</span>
      </div>
      <nav className="adm-chips adm-chips-short" aria-label="Фильтр по статусу">
        <Link className={!filter ? "adm-chip on" : "adm-chip"} href={href({ f: null })}>
          <b>{all.length}</b>
          <span>Все</span>
        </Link>
        {FEEDBACK_STATUSES.map((s) => (
          <Link key={s.key} className={`adm-chip tone-${s.tone}${filter === s.key ? " on" : ""}`} href={href({ f: s.key })}>
            <b>{all.filter((f) => f.status === s.key).length}</b>
            <span>{s.chip}</span>
          </Link>
        ))}
        {filter === "contact" && (
          <Link className="adm-chip tone-warn on" href={href({ f: "contact" })}>
            <b>{rows.length}</b>
            <span>Пора ответить</span>
          </Link>
        )}
      </nav>
      <form className="adm-tools" action="/admin/feedback">
        {filter && <input type="hidden" name="f" value={filter} />}
        <input name="q" type="search" defaultValue={params.q ?? ""} placeholder="Поиск: имя, телефон, текст" maxLength={100} />
        <button className="button" type="submit">
          Найти
        </button>
        <span className="muted adm-count">
          {rows.length ? `Показаны ${(page - 1) * PAGE + 1}-${(page - 1) * PAGE + shown.length} из ${rows.length}` : "Заявок нет"}
        </span>
      </form>

      {rows.length > 0 && (
        <div className="adm-grid">
          <div className="table-wrap adm-table">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кто</th>
                  <th>Сообщение</th>
                  <th>Статус</th>
                  <th className="adm-act">Связаться</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const s = statusOf(f);
                  const ago = agoText(f.created_at, now);
                  return (
                    <tr key={f.id}>
                      <td>
                        <span className="adm-when">
                          {f.status === "new" && <span className="adm-new-dot" aria-label="новая" />}
                          {whenText(f.created_at, now)}
                        </span>
                        {ago && <small>{ago}</small>}
                      </td>
                      <td>
                        <Link className="adm-row-link" href={`/admin/feedback/${f.id}`}>
                          {f.name}
                        </Link>
                        <small>{f.contact}</small>
                        {f.match_name && <small className="adm-match">В Depter: {f.match_name}</small>}
                      </td>
                      <td>
                        <span className="adm-msg">{f.message}</span>
                      </td>
                      <td>
                        <span className={`adm-stage tone-${s.tone}`}>{s.label}</span>
                        {f.next_contact && f.status !== "done" && (
                          <small className="adm-flag">связаться {whenText(`${f.next_contact}T06:00:00Z`, now).split(",")[0]}</small>
                        )}
                      </td>
                      <td className="adm-act">
                        <FeedbackContactButtons f={f} short />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="adm-cards">
            {shown.map((f) => {
              const s = statusOf(f);
              return (
                <li key={f.id}>
                  <Link className="adm-row-link" href={`/admin/feedback/${f.id}`}>
                    {f.status === "new" && <span className="adm-new-dot" aria-label="новая" />}
                    {f.name}
                  </Link>
                  <span className={`adm-stage tone-${s.tone}`}>{s.label}</span>
                  <small>
                    {whenText(f.created_at, now)} · {f.contact}
                  </small>
                  <FeedbackContactButtons f={f} short />
                  <small className="adm-msg">{f.message}</small>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <nav className="adm-pager" aria-label="Страницы">
              <span>{PAGE} на странице</span>
              <div>
                {page > 1 && <Link href={href({ page: page - 1 })}>← Назад</Link>}
                {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                  <Link key={n} className={n === page ? "on" : undefined} href={href({ page: n })}>
                    {n}
                  </Link>
                ))}
                {page < pages && <Link href={href({ page: page + 1 })}>Дальше →</Link>}
              </div>
            </nav>
          )}
        </div>
      )}
    </>
  );
}

