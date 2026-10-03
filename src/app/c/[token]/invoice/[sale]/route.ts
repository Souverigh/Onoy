import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";
import { renderInvoicePdf, ITEMS_FOOTER, type InvoiceLine } from "@/lib/pdf/invoice";
import { balanceNote, parseSaleInvoiceInfo } from "@/lib/sale-invoice";

type Invoice = {
  shop_name: string;
  shop_phone: string | null;
  customer_name: string;
  total: string;
  currency?: string;
  /** Валюта долга клиента (для строки «Долг после накладной»). */
  debt_currency?: string;
  occurred_at: string;
  lines: InvoiceLine[];
  /** Продажа товарами со склада — накладная из приложения, не по фото. */
  items?: boolean;
};

// PDF накладной для клиента по ссылке, без входа. Что можно отдать, решает
// get_invoice_by_token: только сверенная продажа этого клиента.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; sale: string }> },
) {
  const { token, sale } = await params;
  if (!/^[a-f0-9]{32}$/i.test(token) || !/^[a-f0-9-]{36}$/i.test(sale))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data, error } = await createAnonClient().rpc("get_invoice_by_token", {
    p_token: token,
    p_sale: sale,
  });
  if (error || !data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const invoice = data as Invoice;

  const info = parseSaleInvoiceInfo(invoice);
  const origin = new URL(request.url).origin;
  const debtCurrency = invoice.debt_currency ?? invoice.currency ?? "KGS";
  const pdf = await renderInvoicePdf(origin, {
    shopName: invoice.shop_name ?? "Магазин",
    kindLabel: "Товарная накладная",
    number: info.number,
    occurredAt: invoice.occurred_at,
    total: Number(invoice.total),
    currency: invoice.currency ?? "KGS",
    balanceNote: balanceNote(info.debtAfter, debtCurrency),
    buyer: { name: invoice.customer_name, phone: info.customerPhone },
    seller: { name: info.sellerName ?? invoice.shop_name ?? "", phone: invoice.shop_phone },
    lines: invoice.lines,
    digitized: true,
    clientUrl: `${origin}/c/${token}`,
    footer: invoice.items ? ITEMS_FOOTER : undefined,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // inline — клиент открывает ссылку из WhatsApp и сразу видит накладную.
      "content-disposition": `inline; filename="nakladnaya-${sale.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${sale.slice(0, 8)}.pdf`)}`,
    },
  });
}
