import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { getStatementData, statementEntryLabel } from "@/lib/statement-data";

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

  return (
    <>
      <Link className="back-link no-print" href={`/${kind}/${id}`}>
        ← {partyName}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">АКТ СВЕРКИ</span>
          <h1>
            {shopName} - {partyName}
          </h1>
          <p className="muted">
            Период: {from} - {to}
          </p>
        </div>
        <div className="simple-operation-actions no-print">
          <a className="button" href={`/${kind}/${id}/statement/pdf?from=${from}&to=${to}`}>
            Скачать PDF
          </a>
          <PrintButton />
        </div>
      </div>
      <form className="statement-period no-print" action={`/${kind}/${id}/statement`}>
        <label>
          С
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label>
          По
          <input type="date" name="to" defaultValue={to} />
        </label>
        <button className="button" type="submit">
          Показать
        </button>
      </form>
      <section className="panel statement-panel">
        <div className="statement-row">
          <span>Долг на начало</span>
          <strong>{money(opening, currency)}</strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Операция</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={i} className={entry.reversed ? "reversed-row" : ""}>
                  <td>
                    {new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeZone: "Asia/Bishkek" }).format(
                      new Date(entry.occurred_at),
                    )}
                  </td>
                  <td>
                    {statementEntryLabel(entry)}
                    {entry.reversed && <span className="tag reversed-tag">отменена</span>}
                  </td>
                  <td>{money(entry.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="statement-row">
          <span>Долг на конец</span>
          <strong>{money(closing, currency)}</strong>
        </div>
      </section>
    </>
  );
}
