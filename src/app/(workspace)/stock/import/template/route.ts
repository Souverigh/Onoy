import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { buildXlsx, type Cell } from "@/lib/xlsx";
import { CURRENCY_SIGN, isCurrency } from "@/lib/currency";

// Шаблон для импорта на склад. Если товары уже есть — это их выгрузка в том
// же виде: цены и остатки можно поправить в Excel и загрузить обратно.
export async function GET() {
  const { db, organizationId, currency } = await getContext();
  const { data } = await db
    .from("product_balances")
    .select("name,sku,unit,sale_price,purchase_price,purchase_currency,stock")
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
    CURRENCY_SIGN[isCurrency(p.purchase_currency) ? p.purchase_currency : currency],
    Number(p.stock),
  ]);
  if (!rows.length)
    rows.push(
      ["Кабель ВВГнг 3х2,5", "", "м", 85.5, 60, CURRENCY_SIGN[currency], 100],
      ["Розетка двойная", "R-2", "шт", 150, 1.2, CURRENCY_SIGN.USD, 40],
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
        { header: "Валюта закупки", width: 10 },
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
