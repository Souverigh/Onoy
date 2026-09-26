import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { afterClosing, bishkekDate, computeDaySummary, dayClosure } from "@/lib/day-summary";
import { renderDayPdf } from "@/lib/pdf/day";

/** PDF «Итог дня»: у закрытого дня — снимок + «после закрытия», у открытого — цифры на сейчас. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("date") ?? "";
  const today = bishkekDate();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
  const { db, organizationId } = await getContext();
  const [closure, shop] = await Promise.all([
    dayClosure(db, organizationId, date),
    db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
  ]);
  const summary = closure?.snapshot ?? (await computeDaySummary(db, organizationId, date));
  const after = closure ? await afterClosing(db, organizationId, date, closure.closedAt) : null;
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  }).format(new Date(`${date}T12:00:00+06:00`));

  const pdf = await renderDayPdf(url.origin, {
    shopName: shop.data?.name ?? "Магазин",
    dateLabel,
    summary,
    closedAt: closure?.closedAt ?? null,
    after,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="itog-dnya-${date}.pdf"`,
    },
  });
}
