import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { renderInvoiceImage } from "@/lib/pdf/invoice-image";
import { saleInvoiceData } from "@/lib/sale-invoice-data";

// Картинка накладной продажи (задача 8): на экране после записи и файлом в
// WhatsApp. ?download=1 — сохранить файлом.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await getContext();
  const origin = new URL(request.url).origin;
  const invoice = await saleInvoiceData(db, organizationId, id, origin, shopCurrency);
  if (!invoice || !invoice.data.lines.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const image = await renderInvoiceImage(origin, invoice.data);
  if (request.nextUrl.searchParams.get("download") === "1")
    image.headers.set("content-disposition", `attachment; filename="nakladnaya-${id.slice(0, 8)}.png"`);
  return image;
}
