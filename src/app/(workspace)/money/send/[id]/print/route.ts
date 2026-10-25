import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { saleInvoiceData } from "@/lib/sale-invoice-data";

// «Печать» накладной продажи: отдельная страница с картинкой накладной на
// лист A4 (книжный) и окном печати сразу. Раньше открывался PDF, а Safari
// на iPhone показывает PDF без окна печати; печать через «Поделиться»
// клала накладную на альбомный лист.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId, currency: shopCurrency } = await getContext();
  const origin = new URL(request.url).origin;
  const invoice = await saleInvoiceData(db, organizationId, id, origin, shopCurrency);
  if (!invoice || !invoice.data.lines.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Накладная</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  html, body { margin: 0; background: #fff; font-family: system-ui, sans-serif; }
  .sheet { max-width: 800px; margin: 0 auto; padding: 16px; }
  .sheet img { display: block; width: 100%; height: auto; }
  .actions { display: flex; gap: 12px; justify-content: center; padding: 16px; }
  .actions a, .actions button { font: inherit; font-size: 16px; padding: 12px 18px; border-radius: 10px; border: 1px solid #c9d3cc; background: #fff; color: #1d2a2a; text-decoration: none; cursor: pointer; }
  .actions button { background: #24594a; border-color: #24594a; color: #fff; font-weight: 600; }
  @media print {
    .actions { display: none; }
    .sheet { max-width: none; padding: 0; }
  }
</style>
</head>
<body>
<div class="actions">
  <button type="button" onclick="window.print()">Печать</button>
  <a href="/money/send/${id}/pdf">Скачать PDF</a>
</div>
<div class="sheet"><img id="invoice" src="/money/send/${id}/image" alt="Накладная"></div>
<script>
  // Окно печати — когда картинка загрузилась, иначе на листе будет пусто.
  (function () {
    var img = document.getElementById("invoice");
    var go = function () { setTimeout(function () { window.print(); }, 300); };
    if (img.complete && img.naturalWidth) go(); else img.addEventListener("load", go, { once: true });
  })();
</script>
</body>
</html>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });
}
