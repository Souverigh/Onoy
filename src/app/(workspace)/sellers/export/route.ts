import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { period } from "@/lib/periods";
import { downloadHeaders, reportXlsx, sellersReportDoc } from "@/lib/report-export";
import { renderReportPdf } from "@/lib/pdf/report";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Продажи продавцов — Excel или PDF (?format=&id=&offset=&date=), как на
// экране. Продавец скачивает только свои продажи, владелец — любые.
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const format = search.get("format") === "pdf" ? "pdf" : "xlsx";
  const { db, organizationId, organizationName, user, isOwner, currency } = await getContext();
  const today = bishkekDate();
  const rawDate = search.get("date") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : null;
  const offset = Math.min(0, Math.max(-120, parseInt(search.get("offset") ?? "0") || 0));
  const p = period("month", today, offset);
  const rawId = search.get("id") ?? "";
  const sellerId = isOwner ? (uuidPattern.test(rawId) ? rawId : null) : user.id;
  const doc = await sellersReportDoc(db, organizationId, organizationName, currency, {
    sellerId,
    ownName: !isOwner,
    start: day ?? p.start,
    end: day ?? p.through,
  });
  const body = format === "pdf" ? new Uint8Array(await renderReportPdf(request.nextUrl.origin, doc)) : reportXlsx(doc);
  return new NextResponse(body, { headers: downloadHeaders(doc, format) });
}
