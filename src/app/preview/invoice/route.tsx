import { NextRequest, NextResponse } from "next/server";
import { renderInvoicePdf, type InvoiceData } from "@/lib/pdf/invoice";
import { renderInvoiceImage } from "@/lib/pdf/invoice-image";

// Образец накладной без базы — проверить вид PDF и картинки. Как /preview:
// только локально с ONGOY_PREVIEW=1, в production — 404.
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.ONGOY_PREVIEW !== "1")
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rows = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get("rows")) || 5));
  const currency = request.nextUrl.searchParams.get("currency") === "USD" ? "USD" : "KGS";
  const names = ["Розетка 2-ая Horoz", "Автомат 16А", "Лампа LED 12W", "Кабель ВВГ 3×2,5", "Изолента синяя"];
  const lines = Array.from({ length: rows }, (_, i) => {
    const qty = [10, 5, 20, 25, 10][i % 5];
    const price = [85, 120, 45, 62, 25][i % 5];
    return { n: i + 1, name_raw: names[i % 5], qty: String(qty), unit: i % 5 === 3 ? "м" : "шт", price: String(price), sum: String(qty * price) };
  });
  const total = lines.reduce((s, l) => s + Number(l.sum), 0);
  const origin = new URL(request.url).origin;
  const data: InvoiceData = {
    shopName: "Склад №1 JLD Horoz Electric",
    kindLabel: "Товарная накладная",
    number: 15,
    occurredAt: "2026-10-03T06:00:00Z",
    total,
    currency,
    balanceNote: `Долг покупателя после этой накладной: 6 400 ${currency === "USD" ? "$" : "сом"}`,
    buyer: { name: "Айбек", phone: "+996555123456" },
    seller: { name: "Маликнур", phone: "0220934210" },
    lines,
    clientUrl: `${origin}/c/0123456789abcdef0123456789abcdef`,
  };
  if (request.nextUrl.searchParams.get("format") === "pdf") {
    const pdf = await renderInvoicePdf(origin, data);
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf" } });
  }
  return renderInvoiceImage(origin, data);
}
