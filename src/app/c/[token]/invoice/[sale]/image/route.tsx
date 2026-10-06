import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";
import { renderInvoiceImage } from "@/lib/pdf/invoice-image";
import { tokenInvoiceData } from "@/lib/token-invoice";

// Накладная картинкой на странице клиента (задача 21).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; sale: string }> },
) {
  const { token, sale } = await params;
  if (!/^[a-f0-9]{32}$/i.test(token) || !/^[a-f0-9-]{36}$/i.test(sale))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const origin = new URL(request.url).origin;
  const data = await tokenInvoiceData(createAnonClient(), token, sale, origin);
  if (!data || !data.lines.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return renderInvoiceImage(origin, data);
}
