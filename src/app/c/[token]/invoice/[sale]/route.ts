import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { tokenInvoiceData } from "@/lib/token-invoice";

// PDF накладной для клиента по ссылке, без входа.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; sale: string }> },
) {
  const { token, sale } = await params;
  if (!/^[a-f0-9]{32}$/i.test(token) || !/^[a-f0-9-]{36}$/i.test(sale))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const origin = new URL(request.url).origin;
  const data = await tokenInvoiceData(createAnonClient(), token, sale, origin);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const pdf = await renderInvoicePdf(origin, data);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // inline — клиент открывает ссылку из WhatsApp и сразу видит накладную.
      "content-disposition": `inline; filename="nakladnaya-${sale.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${sale.slice(0, 8)}.pdf`)}`,
    },
  });
}
