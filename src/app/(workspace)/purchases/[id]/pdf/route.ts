import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { purchaseInvoiceData } from "@/lib/purchase-invoice-data";

// PDF приходной накладной (приход товарами без фото). ?download=1 — сохранить
// файлом, иначе открыть в браузере.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await getContext();
  const invoice = await purchaseInvoiceData(db, organizationId, id, shopCurrency);
  if (!invoice || !invoice.data.lines.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const pdf = await renderInvoicePdf(new URL(request.url).origin, invoice.data);
  const download = request.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // Заголовки HTTP — только latin-1: кириллица идёт через filename* (RFC 5987).
      "content-disposition": `${download ? "attachment" : "inline"}; filename="prihod-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`приход-${id.slice(0, 8)}.pdf`)}`,
    },
  });
}
