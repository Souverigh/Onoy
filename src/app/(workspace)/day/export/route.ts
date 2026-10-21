import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/context";
import { bishkekDate, computeDaySummary, dayClosure } from "@/lib/day-summary";
import { dayReportDoc, downloadHeaders, reportXlsx } from "@/lib/report-export";

// Итог дня в Excel (?date=). PDF дня — отдельно, /day/pdf. Закрытый день —
// из снимка закрытия, открытый — цифры на сейчас (как на экране и в PDF).
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("date") ?? "";
  const today = bishkekDate();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
  const { db, organizationId, organizationName } = await requireOwner();
  const closure = await dayClosure(db, organizationId, date);
  const summary = closure?.snapshot ?? (await computeDaySummary(db, organizationId, date));
  const doc = dayReportDoc(organizationName, summary, Boolean(closure));
  return new NextResponse(reportXlsx(doc), { headers: downloadHeaders(doc, "xlsx") });
}
