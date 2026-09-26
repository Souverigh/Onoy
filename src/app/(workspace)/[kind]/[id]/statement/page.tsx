import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

function bishkekToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function monthStart() {
  const today = bishkekToday();
  return `${today.slice(0, 7)}-01`;
}
function toIso(date: string) {
  return new Date(`${date}T00:00:00+06:00`).toISOString();
}

type Entry = { kind: "sale" | "purchase" | "payment"; amount: number; occurred_at: string; reversed: boolean };

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
  const partyTable = kind === "customers" ? "customers" : "suppliers";
  const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
  const docTable = kind === "customers" ? "sales" : "purchases";

  const { from: rawFrom, to: rawTo } = await searchParams;
  const from = rawFrom && /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) ? rawFrom : monthStart();
  const to = rawTo && /^\d{4}-\d{2}-\d{2}$/.test(rawTo) ? rawTo : bishkekToday();
  const fromIso = toIso(from);
  const toIsoEnd = new Date(new Date(toIso(to)).getTime() + 86400000).toISOString();

  const [party, shop] = await Promise.all([
    db.from(partyTable).select("id,name,phone").eq("organization_id", organizationId).eq("id", id).maybeSingle(),
    db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
  ]);
  if (party.error || !party.data) notFound();

  const paymentDirection = kind === "customers" ? "incoming" : "outgoing";
  const [docsBefore, paymentsBefore, docsInPeriod, paymentsInPeriod] = await Promise.all([
    db.from(docTable).select("total,reversed_at").eq("organization_id", organizationId).eq(partyColumn, id).eq("status", "posted").lt("occurred_at", fromIso),
    db.from("payments").select("amount,reversed_at").eq("organization_id", organizationId).eq(partyColumn, id).eq("direction", paymentDirection).eq("status", "confirmed").lt("occurred_at", fromIso),
    db.from(docTable).select("id,total,occurred_at,reversed_at").eq("organization_id", organizationId).eq(partyColumn, id).eq("status", "posted").gte("occurred_at", fromIso).lt("occurred_at", toIsoEnd).order("occurred_at"),
    db.from("payments").select("id,amount,occurred_at,reversed_at,status").eq("organization_id", organizationId).eq(partyColumn, id).eq("direction", paymentDirection).neq("status", "rejected").gte("occurred_at", fromIso).lt("occurred_at", toIsoEnd).order("occurred_at"),
  ]);

  const sum = (rows: { amount?: string; total?: string; reversed_at: string | null }[]) =>
    rows.filter((r) => !r.reversed_at).reduce((s, r) => s + Number(r.amount ?? r.total ?? 0), 0);
  const opening = sum(docsBefore.data ?? []) - sum(paymentsBefore.data ?? []);

  const entries: Entry[] = [
    ...(docsInPeriod.data ?? []).map((d) => ({
      kind: (kind === "customers" ? "sale" : "purchase") as Entry["kind"],
      amount: Number(d.total),
      occurred_at: d.occurred_at,
      reversed: Boolean(d.reversed_at),
    })),
    ...(paymentsInPeriod.data ?? [])
      .filter((p) => p.status !== "pending")
      .map((p) => ({
        kind: "payment" as const,
        amount: -Number(p.amount),
        occurred_at: p.occurred_at,
        reversed: Boolean(p.reversed_at),
      })),
  ].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const closing = entries.reduce((s, e) => s + (e.reversed ? 0 : e.amount), opening);

  return (
    <>
      <Link className="back-link no-print" href={`/${kind}/${id}`}>
        ← {party.data.name}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">АКТ СВЕРКИ</span>
          <h1>{shop.data?.name ?? "Магазин"} — {party.data.name}</h1>
          <p className="muted">
            Период: {from} — {to}
          </p>
        </div>
        <PrintButton />
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
          <span>Сальдо на начало периода</span>
          <strong>{money(opening)}</strong>
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
                    {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Bishkek" }).format(
                      new Date(entry.occurred_at),
                    )}
                  </td>
                  <td>
                    {entry.kind === "sale" ? "Продажа" : entry.kind === "purchase" ? "Приход" : "Оплата"}
                    {entry.reversed && <span className="tag reversed-tag">сторно</span>}
                  </td>
                  <td>{money(entry.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="statement-row">
          <span>Сальдо на конец периода</span>
          <strong>{money(closing)}</strong>
        </div>
      </section>
    </>
  );
}
