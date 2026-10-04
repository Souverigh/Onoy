import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { renderInvoicePdf, ITEMS_FOOTER } from "@/lib/pdf/invoice";
import { money } from "@/lib/format";
import { partyCurrency } from "@/lib/currency";
import { shopPromoUrl } from "@/lib/promo";
import { activeShareToken, balanceNote, saleInvoiceInfo } from "@/lib/sale-invoice";

// PDF продажи товарами со склада (строки — sale_items). Продажа по фото —
// /documents/[id]/pdf.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await getContext();
  const [saleResult, itemsResult, shop] = await Promise.all([
    db
      .from("sales")
      .select("id,customer_id,total,occurred_at,original_amount,original_currency,fx_rate,customers(name,currency)")
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
        customer_id: string;
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

  const origin = new URL(request.url).origin;
  const [info, token, promoUrl] = await Promise.all([
    saleInvoiceInfo(db, organizationId, sale.id),
    activeShareToken(db, organizationId, sale.customer_id),
    shopPromoUrl(db, origin, organizationId),
  ]);
  const pdf = await renderInvoicePdf(origin, {
    shopName: shop.data?.name ?? "Магазин",
    kindLabel: "Товарная накладная",
    number: info.number,
    occurredAt: sale.occurred_at,
    total: Number(sale.original_amount ?? sale.total),
    currency: sale.original_currency ?? debtCurrency,
    debtNote:
      sale.original_amount != null
        ? `В долг: ${money(sale.total, debtCurrency)} по курсу ${Number(sale.fx_rate)}.`
        : null,
    balanceNote: balanceNote(info.debtAfter, debtCurrency),
    buyer: { name: sale.customers?.name ?? "—", phone: info.customerPhone },
    seller: { name: info.sellerName ?? shop.data?.name ?? "", phone: shop.data?.phone },
    lines: items.map((item, i) => ({
      n: item.n ?? i + 1,
      name_raw: item.name_snapshot,
      qty: item.qty,
      unit: item.unit ?? "шт",
      price: item.price,
      sum: item.line_total,
    })),
    digitized: true,
    clientUrl: token ? `${origin}/c/${token}` : null,
    promoUrl,
    footer: ITEMS_FOOTER,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="nakladnaya-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${id.slice(0, 8)}.pdf`)}`,
    },
  });
}
