import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { getStatementData, statementDay, statementEntryLabel, statementRows } from "@/lib/statement-data";
import { downloadHeaders, reportXlsx, type ReportDoc } from "@/lib/report-export";
import type { Currency } from "@/lib/currency";

// Акт сверки в Excel (?from=&to=) — те же строки и остаток, что на экране и в PDF.
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "customers" && kind !== "suppliers") return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId } = await getContext();
  const search = request.nextUrl.searchParams;
  const s = await getStatementData(db, organizationId, kind, id, search.get("from") ?? undefined, search.get("to") ?? undefined);
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { rows, plus, minus } = statementRows(s);
  const currency = s.currency as Currency;
  const customers = kind === "customers";
  const doc: ReportDoc = {
    shopName: s.shopName,
    title: `Акт сверки ${s.partyName}`,
    periodText: `${statementDay(s.from)} – ${statementDay(s.to)}`,
    currency,
    summary: [
      { label: `Долг на ${statementDay(s.from)}`, value: s.opening, money: true },
      { label: customers ? "Продано в долг" : "Товар от поставщика", value: plus, money: true },
      { label: customers ? "Оплатил, скидки, возвраты" : "Оплачено поставщику", value: minus, money: true },
      { label: `Долг на ${statementDay(s.to)}`, value: s.closing, money: true },
    ],
    tables: [
      {
        title: "Операции",
        columns: [
          { header: "Дата", width: 17, kind: "date" },
          { header: "Операция", width: 26 },
          { header: "Долг вырос", width: 16, kind: "money" },
          { header: "Уменьшился", width: 16, kind: "money" },
          { header: "Остаток", width: 16, kind: "money" },
          { header: "Отменена", width: 10 },
        ],
        rows: rows.map((r) => [
          new Date(r.occurred_at),
          statementEntryLabel(r),
          r.plus || null,
          r.minus || null,
          r.reversed ? null : r.balance,
          r.reversed ? "да" : "",
        ]),
      },
    ],
    fileBase: `akt-sverki-${s.from}_${s.to}`,
  };
  return new NextResponse(reportXlsx(doc), { headers: downloadHeaders(doc, "xlsx") });
}
