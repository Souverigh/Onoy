import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";

// Переход по рекламному QR с накладной: записываем магазин и ведём на сайт.
// Сбой записи не мешает переходу.
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (/^[a-f0-9]{10}$/.test(ref)) {
    try {
      await createAnonClient().rpc("track_promo_click", { p_ref: ref });
    } catch {}
  }
  return NextResponse.redirect(new URL("/", request.url));
}
