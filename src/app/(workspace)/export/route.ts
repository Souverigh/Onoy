import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { EXPORT_TABLES, exportSheets, isExportTable, type ExportTable } from "@/lib/export-data";
import { buildXlsx } from "@/lib/xlsx";

// Выгрузка в Excel: ?table=customers|…, без параметра — вся база, каждая
// таблица на своём листе. Только данные своего магазина (RLS + organization_id).
export async function GET(request: NextRequest) {
  const table = request.nextUrl.searchParams.get("table") ?? "all";
  if (table !== "all" && !isExportTable(table))
    return NextResponse.json({ error: "invalid_table" }, { status: 400 });
  const tables: ExportTable[] = table === "all" ? (Object.keys(EXPORT_TABLES) as ExportTable[]) : [table];
  const { db, organizationId } = await requireOwner();
  const xlsx = buildXlsx(await exportSheets(db, organizationId, tables));
  const day = bishkekDate();
  const latin = `depter-${table}-${day}.xlsx`;
  const name = `Depter ${table === "all" ? "вся база" : EXPORT_TABLES[table as ExportTable]} ${day}.xlsx`;
  return new NextResponse(xlsx, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Заголовки — только latin-1: кириллица через filename* (RFC 5987).
      "content-disposition": `attachment; filename="${latin}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
