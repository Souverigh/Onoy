import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { journalData } from "@/lib/journal";
import { parseJournal, periodDays } from "@/lib/journal-filters";
import { memberLabels } from "@/lib/members";
import { buildXlsx } from "@/lib/xlsx";

// Журнал продаж или прихода в Excel — с теми же отборами, что на экране
// (?kind=sale|purchase&period=…&q=…). Только владелец, как и вся выгрузка.
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const kind = search.get("kind");
  if (kind !== "sale" && kind !== "purchase") return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await requireOwner();
  const sale = kind === "sale";
  const today = bishkekDate();
  const filters = parseJournal(Object.fromEntries(search.entries()), { allowBy: true });
  const [journal, members] = await Promise.all([
    journalData(db, organizationId, kind, filters, today, "all"),
    memberLabels(db, organizationId),
  ]);
  const xlsx = buildXlsx([
    {
      name: sale ? "Продажи" : "Приход",
      columns: [
        { header: "Дата", width: 18, kind: "date" },
        { header: sale ? "Клиент" : "Поставщик", width: 28 },
        { header: "Сумма", width: 14, kind: "money" },
        { header: "Валюта", width: 8 },
        ...(sale ? [{ header: "Оплата", width: 12 }] : []),
        { header: "Кто внёс", width: 18 },
        { header: "Статус", width: 12 },
        { header: "Причина отмены", width: 30 },
      ],
      rows: journal.rows.map((r) => [
        new Date(r.occurred_at),
        r.party?.name ?? "",
        Number(r.total),
        r.party?.currency ?? shopCurrency,
        ...(sale ? [r.paid_immediately ? "Наличными" : "В долг"] : []),
        r.created_by ? (members.get(r.created_by)?.name ?? "") : "",
        r.reversed_at ? "Отменена" : "Записана",
        r.reversal_comment ?? "",
      ]),
    },
  ]);
  const days = periodDays(filters, today);
  const span = days.from || days.to ? `${days.from ?? "…"}_${days.to ?? "…"}` : "all";
  const latin = `depter-${sale ? "sales" : "purchases"}-${span}.xlsx`;
  const name = `Depter ${sale ? "продажи" : "приход"} ${span}.xlsx`;
  return new NextResponse(xlsx, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Заголовки — только latin-1: кириллица через filename* (RFC 5987).
      "content-disposition": `attachment; filename="${latin}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
