import Link from "next/link";
import { getContext } from "@/lib/context";
import { CHANGELOG, newsFor } from "@/lib/changelog";

const day = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00+06:00`));

/** «Что нового»: все обновления по дням — для этого человека (роль, модули). */
export default async function NewsPage() {
  const { isOwner, modules } = await getContext();
  const entries = newsFor(CHANGELOG, isOwner, modules);
  const days = [...new Set(entries.map((e) => e.date))];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Что нового</h1>
          <p className="muted">Что появилось в Depter и где это найти.</p>
        </div>
        {isOwner && (
          <div className="page-heading-actions">
            <Link className="button" href="/features">
              Что умеет Depter
            </Link>
          </div>
        )}
      </div>
      {days.map((date) => (
        <section key={date} className="panel news-day">
          <h2 className="news-date">{day(date)}</h2>
          <ul className="news-list">
            {entries
              .filter((e) => e.date === date)
              .map((e) => (
                <li key={e.n}>
                  <strong>{e.title}</strong>
                  <p>{e.text}</p>
                  {e.link && (
                    <Link className="text-button" href={e.link.href}>
                      {e.link.label} →
                    </Link>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}
