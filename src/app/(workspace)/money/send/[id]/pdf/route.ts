import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { renderInvoicePdf, ITEMS_FOOTER } from "@/lib/pdf/invoice";
import { money, quantity } from "@/lib/format";
import { partyCurrency } from "@/lib/currency";

// PDF продажи товарами со склада (строки — sale_items). Продажа по фото —
// /documents/[id]/pdf.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await getContext();
  const [saleResult, itemsResult, shop] = await Promise.all([
    db
      .from("sales")
      .select("id,total,occurred_at,original_amount,original_currency,fx_rate,customers(name,currency)")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle(),
    db
      .from("sale_items")
      .select("n,name_snapshot,unit,qty,price,line_total")
      .eq("organization_id", organizationId)
      .eq("sale_id", id)
      .order("n"),
    db.from("organizations").select("name,phone").eq("id", organizationId).maybeSingle(),
  ]);
  const sale = saleResult.data as
    | {
        id: string;
        total: string;
        occurred_at: string;
        original_amount: string | null;
        original_currency: string | null;
        fx_rate: string | null;
        customers: { name: string; currency: string | null } | null;
      }
    | null;
  const items = itemsResult.data ?? [];
  if (!sale || !items.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const debtCurrency = partyCurrency(sale.customers, shopCurrency);

  const pdf = await renderInvoicePdf(new URL(request.url).origin, {
    shopName: shop.data?.name ?? "Магазин",
    shopPhone: shop.data?.phone ?? "",
    kindLabel: "Расходная накладная",
    partyName: sale.customers?.name ?? "—",
    date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Bishkek" }).format(new Date(sale.occurred_at)),
    total: Number(sale.original_amount ?? sale.total),
    currency: sale.original_currency ?? debtCurrency,
    debtNote:
      sale.original_amount != null
        ? `В долг: ${money(sale.total, debtCurrency)} по курсу ${Number(sale.fx_rate)}.`
        : null,
    lines: items.map((item, i) => ({
      n: item.n ?? i + 1,
      name_raw: item.name_snapshot,
      qty: quantity(item.qty),
      unit: item.unit ?? "шт",
      price: quantity(item.price),
      sum: quantity(item.line_total),
    })),
    digitized: true,
    footer: ITEMS_FOOTER,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="nakladnaya-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${id.slice(0, 8)}.pdf`)}`,
    },
  });
}
