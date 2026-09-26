import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { renderInvoicePdf } from "@/lib/pdf/invoice";

const kindLabel: Record<string, string> = {
  purchase: "Приходная накладная",
  sale: "Расходная накладная",
  payment: "Оплата",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id))
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId } = await getContext();

  const doc = await db
    .from("documents")
    .select("id,kind,status,created_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (doc.error || !doc.data)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  let partyName = "—";
  let total = 0;
  let date = doc.data.created_at;
  if (doc.data.kind === "purchase") {
    const row = await db
      .from("purchases")
      .select("total,occurred_at,supplier_id")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    if (row.data) {
      total = Number(row.data.total);
      date = row.data.occurred_at;
      const supplier = await db
        .from("suppliers")
        .select("name")
        .eq("organization_id", organizationId)
        .eq("id", row.data.supplier_id)
        .maybeSingle();
      partyName = supplier.data?.name ?? partyName;
    }
  } else if (doc.data.kind === "sale") {
    const row = await db
      .from("sales")
      .select("total,occurred_at,customer_id")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    if (row.data) {
      total = Number(row.data.total);
      date = row.data.occurred_at;
      const customer = await db
        .from("customers")
        .select("name")
        .eq("organization_id", organizationId)
        .eq("id", row.data.customer_id)
        .maybeSingle();
      partyName = customer.data?.name ?? partyName;
    }
  }

  const [shop, linesResult] = await Promise.all([
    db.from("organizations").select("name,phone").eq("id", organizationId).maybeSingle(),
    db
      .from("document_lines")
      .select("n,name_raw,qty,unit,price,sum")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .order("n"),
  ]);

  const origin = new URL(request.url).origin;
  const pdf = await renderInvoicePdf(origin, {
    shopName: shop.data?.name ?? "Магазин",
    shopPhone: shop.data?.phone ?? "",
    kindLabel: kindLabel[doc.data.kind ?? ""] ?? "Документ",
    partyName,
    date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Bishkek" }).format(
      new Date(date),
    ),
    total,
    lines: (linesResult.data ?? []) as {
      n: number;
      name_raw: string;
      qty: string;
      unit: string;
      price: string;
      sum: string;
    }[],
    digitized: doc.data.status === "digitized",
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // Заголовки HTTP — только latin-1: кириллица идёт через filename* (RFC 5987).
      "content-disposition": `attachment; filename="nakladnaya-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${id.slice(0, 8)}.pdf`)}`,
    },
  });
}
