import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { money } from "@/lib/format";
import { activeShareToken, balanceNote, saleInvoiceInfo } from "@/lib/sale-invoice";
import { saleInvoiceData } from "@/lib/sale-invoice-data";

const kindLabel: Record<string, string> = {
  purchase: "Приходная накладная",
  sale: "Товарная накладная",
  payment: "Оплата",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id))
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await getContext();

  const doc = await db
    .from("documents")
    .select("id,kind,status,created_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (doc.error || !doc.data)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  let partyName = "-";
  let partyPhone = "";
  let saleId: string | null = null;
  let customerId: string | null = null;
  let total = 0;
  let date = doc.data.created_at;
  // Валюта накладной: исходная, если записана в другой валюте, иначе — долга.
  let currency: string | null = null;
  let debtNote: string | null = null;
  let debtCurrency: string | null = null;
  const applyCurrency = (
    row: { total: string | number; original_amount: string | null; original_currency: string | null; fx_rate: string | null },
    partyCurrency: string | null,
  ) => {
    debtCurrency = partyCurrency;
    if (row.original_amount != null && row.original_currency) {
      total = Number(row.original_amount);
      currency = row.original_currency;
      debtNote = `В долг: ${money(row.total, partyCurrency ?? shopCurrency)} по курсу ${Number(row.fx_rate)}.`;
    } else currency = partyCurrency;
  };
  if (doc.data.kind === "purchase") {
    const row = await db
      .from("purchases")
      .select("total,occurred_at,supplier_id,original_amount,original_currency,fx_rate")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    if (row.data) {
      total = Number(row.data.total);
      date = row.data.occurred_at;
      const supplier = await db
        .from("suppliers")
        .select("name,phone,currency")
        .eq("organization_id", organizationId)
        .eq("id", row.data.supplier_id)
        .maybeSingle();
      partyName = supplier.data?.name ?? partyName;
      partyPhone = supplier.data?.phone ?? "";
      applyCurrency(row.data, supplier.data?.currency ?? null);
    }
  } else if (doc.data.kind === "sale") {
    const row = await db
      .from("sales")
      .select("id,total,occurred_at,customer_id,original_amount,original_currency,fx_rate")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    if (row.data) {
      total = Number(row.data.total);
      date = row.data.occurred_at;
      const customer = await db
        .from("customers")
        .select("name,currency")
        .eq("organization_id", organizationId)
        .eq("id", row.data.customer_id)
        .maybeSingle();
      partyName = customer.data?.name ?? partyName;
      saleId = row.data.id;
      customerId = row.data.customer_id;
      applyCurrency(row.data, customer.data?.currency ?? null);
    }
  }

  const origin = new URL(request.url).origin;
  // Продажа — та же накладная, что на экране «Отправить клиенту».
  if (saleId) {
    const invoice = await saleInvoiceData(db, organizationId, saleId, origin, shopCurrency);
    if (invoice) {
      const pdf = await renderInvoicePdf(origin, invoice.data);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="nakladnaya-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${id.slice(0, 8)}.pdf`)}`,
        },
      });
    }
  }
  const [shop, linesResult, info, token] = await Promise.all([
    db.from("organizations").select("name,phone").eq("id", organizationId).maybeSingle(),
    db
      .from("document_lines")
      .select("n,name_raw,qty,unit,price,sum")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .order("n"),
    saleId ? saleInvoiceInfo(db, organizationId, saleId) : null,
    customerId ? activeShareToken(db, organizationId, customerId) : null,
  ]);

  const isSale = doc.data.kind === "sale";
  const shopParty = { name: shop.data?.name ?? "Магазин", phone: shop.data?.phone };
  const pdf = await renderInvoicePdf(origin, {
    shopName: shopParty.name,
    kindLabel: kindLabel[doc.data.kind ?? ""] ?? "Документ",
    number: info?.paperNumber ?? info?.number,
    occurredAt: date,
    total,
    currency: currency ?? shopCurrency,
    debtNote,
    balanceNote: info ? balanceNote(info.debtAfter, debtCurrency ?? shopCurrency) : null,
    // Продажа: покупатель — клиент; приход: покупатель — магазин.
    buyer: isSale ? { name: partyName, phone: info?.customerPhone } : shopParty,
    seller: isSale ? { name: info?.sellerName ?? shopParty.name, phone: shopParty.phone } : { name: partyName, phone: partyPhone },
    clientUrl: token ? `${origin}/c/${token}` : null,
    lines: (linesResult.data ?? []) as {
      n: number;
      name_raw: string;
      qty: string;
      unit: string;
      price: string;
      sum: string;
    }[],
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // Заголовки HTTP — только latin-1: кириллица идёт через filename* (RFC 5987).
      "content-disposition": `attachment; filename="nakladnaya-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(`накладная-${id.slice(0, 8)}.pdf`)}`,
    },
  });
}
