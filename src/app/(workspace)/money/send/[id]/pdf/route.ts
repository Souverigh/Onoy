import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { saleInvoiceData } from "@/lib/sale-invoice-data";

// PDF накладной продажи — товарами со склада или по фото (строки распознанной
// накладной). ?print=1 — открыть в браузере для печати, а не скачать.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await getContext();
  const origin = new URL(request.url).origin;
  const invoice = await saleInvoiceData(db, organizationId, id, origin, shopCurrency);
  if (!invoice || !invoice.data.lines.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const pdf = await renderInvoicePdf(origin, invoice.data);
  const inline = request.nextUrl.searchParams.get("print") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="nakladnaya-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${id.slice(0, 8)}.pdf`)}`,
    },
  });
}
