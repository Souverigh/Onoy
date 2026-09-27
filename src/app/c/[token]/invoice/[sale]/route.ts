import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";
import { renderInvoicePdf, type InvoiceLine } from "@/lib/pdf/invoice";

type Invoice = {
  shop_name: string;
  shop_phone: string | null;
  customer_name: string;
  total: string;
  occurred_at: string;
  lines: InvoiceLine[];
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

  const pdf = await renderInvoicePdf(new URL(request.url).origin, {
    shopName: invoice.shop_name ?? "Магазин",
    shopPhone: invoice.shop_phone ?? "",
    kindLabel: "Расходная накладная",
    partyName: invoice.customer_name,
    date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Bishkek" }).format(
      new Date(invoice.occurred_at),
    ),
    total: Number(invoice.total),
    lines: invoice.lines,
    digitized: true,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // inline — клиент открывает ссылку из WhatsApp и сразу видит накладную.
      "content-disposition": `inline; filename="nakladnaya-${sale.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${sale.slice(0, 8)}.pdf`)}`,
    },
  });
}
