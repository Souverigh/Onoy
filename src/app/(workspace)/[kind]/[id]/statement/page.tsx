import Link from "next/link";
import { DateField } from "@/components/date-picker";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { DownloadMenu } from "@/components/download-menu";
import {
  bishkekToday,
  getStatementData,
  statementDay,
  statementEntryLabel,
  statementRows,
} from "@/lib/statement-data";

const pad = (n: number) => String(n).padStart(2, "0");
/** Первое число месяца со сдвигом: "2026-10-21", -1 → "2026-09-01". */
function monthFirst(today: string, shift: number) {
  const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + shift, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}
/** Последнее число месяца: "2026-09-01" → "2026-09-30". */
function monthLast(first: string) {
  const d = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 0));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const rowDay = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek" }).format(
    new Date(iso),
  );

/**
 * Акт сверки (переделан 21.10.2026): шапка документа с «Скачать» и «Печать»,
 * период — быстрыми кнопками или своими датами (выбрал — сразу показано),
 * итоги плитками, таблица «+ / − / остаток» как в бухгалтерском акте.
 */
export default async function Statement({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { kind, id } = await params;
  if (kind !== "customers" && kind !== "suppliers") notFound();
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId } = await getContext();
  const { from: rawFrom, to: rawTo } = await searchParams;
  const statement = await getStatementData(db, organizationId, kind, id, rawFrom, rawTo);
  if (!statement) notFound();
  const { partyName, shopName, from, to, opening, closing, entries, currency } = statement;
  const { rows, plus, minus } = statementRows({ opening, entries });
  const customers = kind === "customers";
  const base = `/${kind}/${id}/statement`;

  const today = bishkekToday();
  const lastMonth = monthFirst(today, -1);
  const presets = [
    { label: "Этот месяц", from: monthFirst(today, 0), to: today },
    { label: "Прошлый месяц", from: lastMonth, to: monthLast(lastMonth) },
    { label: "3 месяца", from: monthFirst(today, -2), to: today },
    { label: "С начала года", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const query = `from=${from}&to=${to}`;
  const plusLabel = customers ? "Продано в долг" : "Товар от поставщика";
  const minusLabel = customers ? "Оплатил, скидки, возвраты" : "Оплачено поставщику";

  return (
    <>
      <Link className="back-link no-print" href={`/${kind}/${id}`}>
        ← {partyName}
      </Link>

      <div className="page-heading statement-heading">
        <div>
          <span className="eyebrow">АКТ СВЕРКИ</span>
          <h1>{partyName}</h1>
          <p className="muted">
            {shopName} · {statementDay(from)} – {statementDay(to)}
          </p>
        </div>
        <div className="statement-actions no-print">
          <DownloadMenu href={`${base}/export?${query}`} pdfHref={`${base}/pdf?${query}`} />
          <PrintButton />
        </div>
      </div>

      {/* Период: быстрые кнопки или свои даты — выбрал день, акт сразу пересчитан. */}
      <div className="statement-period no-print">
        <nav className="statement-presets" aria-label="Период">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={`${base}?from=${p.from}&to=${p.to}`}
              className={p.from === from && p.to === to ? "active" : ""}
              aria-current={p.from === from && p.to === to ? "true" : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <form className="statement-range" action={base}>
          <DateField name="from" label="С" defaultValue={from} emptyLabel="Начало" maxDaysBack={3650} clearable={false} autoSubmit />
          <span className="statement-range-dash" aria-hidden="true">
            –
          </span>
          <DateField name="to" label="По" defaultValue={to} emptyLabel="Сегодня" maxDaysBack={3650} clearable={false} autoSubmit />
        </form>
      </div>

      <section className="statement-tiles" aria-label="Итоги акта">
        <article className="panel statement-tile">
          <span>Долг на {statementDay(from)}</span>
          <strong>{money(opening.toFixed(2), currency)}</strong>
        </article>
        <article className="panel statement-tile">
          <span>{plusLabel}</span>
          <strong className="statement-plus">+ {money(plus.toFixed(2), currency)}</strong>
        </article>
        <article className="panel statement-tile">
          <span>{minusLabel}</span>
          <strong className="statement-minus">− {money(minus.toFixed(2), currency)}</strong>
        </article>
        <article className="panel statement-tile statement-tile-total">
          <span>Долг на {statementDay(to)}</span>
          <strong>{money(closing.toFixed(2), currency)}</strong>
        </article>
      </section>

      <section className="panel statement-panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="statement-table">
              <thead>
                <tr>
                  <th className="wide-only">Дата</th>
                  <th>Операция</th>
                  <th className="num wide-only">Долг вырос</th>
                  <th className="num wide-only">Уменьшился</th>
                  <th className="num narrow-only">Сумма</th>
                  <th className="num">Остаток</th>
                </tr>
              </thead>
              <tbody>
                <tr className="statement-edge">
                  <td className="wide-only">{statementDay(from)}</td>
                  <td>
                    Долг на начало
                    <small className="narrow-only statement-date">{statementDay(from)}</small>
                  </td>
                  <td className="wide-only" />
                  <td className="wide-only" />
                  <td className="narrow-only" />
                  <td className="num">{money(opening.toFixed(2), currency)}</td>
                </tr>
                {rows.map((row, i) => (
                  <tr key={i} className={row.reversed ? "reversed-row" : ""}>
                    <td className="nowrap wide-only">{rowDay(row.occurred_at)}</td>
                    <td>
                      {statementEntryLabel(row)}
                      {row.reversed && <span className="tag reversed-tag">отменена</span>}
                      {/* Телефон: дата — под названием, отдельной колонки нет. */}
                      <small className="narrow-only statement-date">{rowDay(row.occurred_at)}</small>
                    </td>
                    <td className="num statement-plus wide-only">{row.plus ? money(row.plus.toFixed(2), currency) : ""}</td>
                    <td className="num statement-minus wide-only">{row.minus ? money(row.minus.toFixed(2), currency) : ""}</td>
                    {/* Телефон: одна сумма со знаком — «+ 25 000» или «− 50 000». */}
                    <td className={`num narrow-only ${row.plus ? "statement-plus" : "statement-minus"}`}>
                      {row.plus ? "+ " : "− "}
                      {money((row.plus || row.minus).toFixed(2), currency)}
                    </td>
                    <td className="num">{row.reversed ? "" : money(row.balance.toFixed(2), currency)}</td>
                  </tr>
                ))}
                <tr className="statement-edge">
                  <td className="wide-only">{statementDay(to)}</td>
                  <td>
                    Долг на конец
                    <small className="narrow-only statement-date">{statementDay(to)}</small>
                  </td>
                  <td className="num statement-plus wide-only">{money(plus.toFixed(2), currency)}</td>
                  <td className="num statement-minus wide-only">{money(minus.toFixed(2), currency)}</td>
                  <td className="narrow-only" />
                  <td className="num">{money(closing.toFixed(2), currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="statement-empty muted">
            За {statementDay(from)} – {statementDay(to)} операций не было - долг не менялся:{" "}
            <strong>{money(closing.toFixed(2), currency)}</strong>. Выберите другой период выше.
          </p>
        )}
      </section>
    </>
  );
}
