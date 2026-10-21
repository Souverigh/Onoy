import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { downloadHeaders, monthReportDoc, reportXlsx } from "@/lib/report-export";
import { renderReportPdf } from "@/lib/pdf/report";

// Отчёт за месяц или неделю — Excel или PDF (?format=xlsx|pdf&period=&offset=),
// тот же период, что на экране. Только владелец, как и сам отчёт.
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const format = search.get("format") === "pdf" ? "pdf" : "xlsx";
  const kind = search.get("period") === "week" ? "week" : "month";
  const offset = Math.min(0, Math.max(-120, parseInt(search.get("offset") ?? "0") || 0));
  const { db, organizationId, organizationName, currency } = await requireOwner();
  const doc = await monthReportDoc(db, organizationId, organizationName, currency, kind, offset, bishkekDate());
  const body = format === "pdf" ? new Uint8Array(await renderReportPdf(request.nextUrl.origin, doc)) : reportXlsx(doc);
  return new NextResponse(body, { headers: downloadHeaders(doc, format) });
}
