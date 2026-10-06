import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { debtMoney, money, originalAmountText } from "@/lib/format";
import { partyCurrency } from "@/lib/currency";
import { invoiceMessage } from "@/lib/invoice-message";
import { SendInvoice } from "@/components/send-invoice";
import { UndoForm } from "@/components/undo-form";
import { ensureShareToken, waPhone } from "@/lib/share";

const UNDO_MS = 2 * 60 * 1000;

// После продажи (задача 8): картинка накладной, под ней первой — «Отправить
// клиенту» (телефон — файлом через «Поделиться», компьютер — «Скачать» и
// «Открыть WhatsApp»), ниже «Печать», «Ещё продажа», «Отменить — ошиблись».
// Картинка — когда накладная сверена (товары со склада или фото сверено);
// до этого клиенту уходит текст с долгом.
export default async function SendSalePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; duplicate?: string; undo?: string }>;
}) {
  const { id } = await params;
  const { done, duplicate, undo } = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, user, currency: shopCurrency } = await getContext();

  const saleResult = await db
    .from("sales")
    .select("id,customer_id,total,occurred_at,paid_immediately,reversed_at,is_opening,document_id,status,created_at,created_by,original_amount,original_currency,fx_rate")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const sale = saleResult.data;
  if (saleResult.error || !sale || sale.status !== "posted") notFound();

  const [customerResult, docResult, shopResult, share, itemsResult, linesResult] = await Promise.all([
    db
      .from("customer_balances")
      .select("id,name,phone,balance,currency")
      .eq("organization_id", organizationId)
      .eq("id", sale.customer_id)
      .maybeSingle(),
    sale.document_id
      ? db
          .from("documents")
          .select("status")
          .eq("organization_id", organizationId)
          .eq("id", sale.document_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    ensureShareToken(db, organizationId, sale.customer_id),
    db.from("sale_items").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("sale_id", sale.id),
    sale.document_id
      ? db
          .from("document_lines")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("document_id", sale.document_id)
      : Promise.resolve({ count: 0 }),
  ]);
  const customer = customerResult.data;
  if (!customer) notFound();

  const { token, revoked } = share;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const status = docResult.data?.status ?? null;
  const hasItems = (itemsResult.count ?? 0) > 0;
  const hasLines = hasItems || (linesResult.count ?? 0) > 0;
  const checked = (hasItems || status === "digitized") && hasLines && !sale.reversed_at && !sale.is_opening;
  const pending = status === "uploaded" || status === "processing";
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Bishkek",
  }).format(new Date(sale.occurred_at));
  const balance = Number(customer.balance ?? 0);
  const cur = partyCurrency(customer, shopCurrency);
  const message = (attached: boolean) =>
    invoiceMessage({
      customerName: customer.name,
      shopName: shopResult.data?.name ?? "",
      date,
      total: sale.original_amount != null ? money(sale.original_amount, sale.original_currency) : money(sale.total, cur),
      paidImmediately: sale.paid_immediately,
      balance,
      balanceText: money(customer.balance ?? 0, cur),
      advanceText: balance < 0 ? money(String(customer.balance).replace(/^-/, ""), cur) : "",
      invoiceUrl: !attached && checked && token ? `${origin}/c/${token}/invoice/${sale.id}` : null,
      invoiceAttached: attached,
      debtUrl: token ? `${origin}/c/${token}` : null,
    });
  const back = `/customers/${customer.id}`;
  const debtBefore = Math.round((balance - (sale.paid_immediately ? 0 : Number(sale.total))) * 100) / 100;
  const imageUrl = checked ? `/money/send/${sale.id}/image` : null;
  const canUndo = sale.created_by === user.id && Date.now() - Date.parse(sale.created_at) < UNDO_MS;
  const fileDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek" }).format(new Date(sale.occurred_at));

  return (
    <>
      {!done && (
        <Link className="back-link" href={back}>
          ← {customer.name}
        </Link>
      )}
      <section className={`panel record-result sale-done${sale.reversed_at ? " reversed" : ""}`}>
        <p className="record-result-title">
          {sale.reversed_at
            ? "Продажа отменена"
            : done
              ? `✓ ${sale.paid_immediately ? "Продажа за наличные записана" : "Продажа записана"}`
              : `Продажа от ${date}`}
        </p>
        <p className="record-result-main">
          <Link href={back}>{customer.name}</Link> ·{" "}
          <strong className="nowrap">{money(sale.total, cur)}</strong>
          {originalAmountText(sale) && <span className="muted"> ({originalAmountText(sale)})</span>}
        </p>
        {done && !sale.reversed_at && (
          <p className="muted">
            Долг клиента: {debtMoney(debtBefore.toFixed(2), cur)} → <strong>{debtMoney(balance.toFixed(2), cur)}</strong>
          </p>
        )}
        {duplicate && <p className="notice">Это фото уже приложено к другой записи — проверьте, не задвоилось ли.</p>}
        {undo === "expired" && <p className="form-error">Прошло больше 2 минут — отменить может владелец с причиной.</p>}
        {sale.reversed_at && <p className="form-error">Эта продажа отменена — отправлять её клиенту не нужно.</p>}
      </section>

      {!sale.reversed_at && (
        <section className="panel send-invoice-panel">
          {imageUrl ? (
            <a className="invoice-image-link" href={`/money/send/${sale.id}/pdf?print=1`} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="invoice-image" src={imageUrl} alt={`Накладная ${customer.name} на ${money(sale.total, cur)}`} />
            </a>
          ) : pending ? (
            <p className="notice">Читаем фото накладной — картинка появится через несколько секунд. Можно не ждать и отправить долг.</p>
          ) : status === "review" || status === "failed" ? (
            <p className="notice">
              Проверьте сумму накладной — после этого клиенту уйдёт картинка.{" "}
              {sale.document_id && (
                <Link className="text-button" href={`/documents/${sale.document_id}`}>
                  Проверить
                </Link>
              )}{" "}
              Сейчас можно отправить только долг.
            </p>
          ) : (
            <p className="notice">Фото накладной нет — клиент получит сумму и ссылку на долг.</p>
          )}
          <SendInvoice
            phone={waPhone(customer.phone)}
            text={message(false)}
            fileText={message(true)}
            imageUrl={imageUrl}
            // Латиница без пробелов: Chrome на Android отклоняет share() с
            // кириллицей, пробелами и «..» в имени файла.
            fileName={`nakladnaya-${fileDate}.png`}
            pending={pending}
          />
          {revoked && (
            <p className="muted">
              Ссылки нет ·{" "}
              <Link className="text-button" href={back}>
                Создать
              </Link>
            </p>
          )}
          {!customer.phone && <p className="muted">У клиента нет телефона — WhatsApp спросит, кому отправить.</p>}
          <details className="send-invoice-text">
            <summary>Текст сообщения</summary>
            <pre className="send-invoice-preview">{message(Boolean(imageUrl))}</pre>
          </details>
          <div className="record-result-actions send-secondary">
            {imageUrl && (
              <a className="button" href={`/money/send/${sale.id}/pdf?print=1`} target="_blank" rel="noreferrer">
                Печать
              </a>
            )}
            <Link className="button" href="/money/new?type=sale">
              Ещё продажа
            </Link>
            <Link className="button" href={back}>
              Открыть клиента
            </Link>
          </div>
          {canUndo && <UndoForm kind="sale" id={sale.id} />}
        </section>
      )}
    </>
  );
}
