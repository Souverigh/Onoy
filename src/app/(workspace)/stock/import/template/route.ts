import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { buildXlsx, type Cell } from "@/lib/xlsx";

// Шаблон для импорта на склад. Если товары уже есть — это их выгрузка в том
// же виде: цены и остатки можно поправить в Excel и загрузить обратно.
export async function GET() {
  const { db, organizationId } = await getContext();
  const { data } = await db
    .from("product_balances")
    .select("name,sku,unit,sale_price,purchase_price,stock")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("name")
    .range(0, 4999);
  const rows: Cell[][] = (data ?? []).map((p) => [
    p.name,
    p.sku,
    p.unit,
    Number(p.sale_price),
    Number(p.purchase_price),
    Number(p.stock),
  ]);
  if (!rows.length)
    rows.push(
      ["Кабель ВВГнг 3х2,5", "", "м", 85.5, 60, 100],
      ["Цемент М400 50 кг", "C-400", "мешок", 560, 480, 40],
    );
  const xlsx = buildXlsx([
    {
      name: "Склад",
      columns: [
        { header: "Наименование", width: 40 },
        { header: "Код", width: 14 },
        { header: "Ед. изм.", width: 10 },
        { header: "Цена продажи", width: 14, kind: "number" },
        { header: "Цена закупки", width: 14, kind: "number" },
        { header: "Остаток", width: 12, kind: "number" },
      ],
      rows,
    },
  ]);
  return new NextResponse(xlsx, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="sklad.xlsx"; filename*=UTF-8''${encodeURIComponent("Склад.xlsx")}`,
    },
  });
}
