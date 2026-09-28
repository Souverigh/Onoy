import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { invoiceMessage } from "@/lib/invoice-message";
import { SendInvoice } from "@/components/send-invoice";
import { RecordResult } from "@/components/record-result";
import { ensureShareToken, waPhone } from "@/lib/share";

// Отправка клиенту накладной и ссылки на долг (ТЗ §4 Б). PDF — только когда
// накладная сверена (документ «оцифрована»); до этого уходит текст с долгом.
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
  const { db, organizationId, user } = await getContext();

  const saleResult = await db
    .from("sales")
    .select("id,customer_id,total,occurred_at,paid_immediately,reversed_at,is_opening,document_id,status,created_at,created_by")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const sale = saleResult.data;
  if (saleResult.error || !sale || sale.status !== "posted") notFound();

  const [customerResult, docResult, shopResult, share] = await Promise.all([
    db
      .from("customer_balances")
      .select("id,name,phone,balance")
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
  ]);
  const customer = customerResult.data;
  if (!customer) notFound();

  const { token, revoked } = share;

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const status = docResult.data?.status ?? null;
  const checked = status === "digitized" && !sale.reversed_at && !sale.is_opening;
  const pending = status === "uploaded" || status === "processing";
  const date = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeZone: "Asia/Bishkek",
  }).format(new Date(sale.occurred_at));
  const balance = Number(customer.balance ?? 0);
  const message = (attached: boolean) =>
    invoiceMessage({
      customerName: customer.name,
      shopName: shopResult.data?.name ?? "",
      date,
      total: money(sale.total),
      paidImmediately: sale.paid_immediately,
      balance,
      balanceText: money(customer.balance ?? 0),
      advanceText: balance < 0 ? money(String(customer.balance).replace(/^-/, "")) : "",
      invoiceUrl: !attached && checked && token ? `${origin}/c/${token}/invoice/${sale.id}` : null,
      invoiceAttached: attached,
      debtUrl: token ? `${origin}/c/${token}` : null,
    });
  const text = message(false);
  const back = `/customers/${customer.id}`;

  const debtBefore = Math.round((balance - (sale.paid_immediately ? 0 : Number(sale.total))) * 100) / 100;
  return (
    <>
      {done && (
        <RecordResult
          title={sale.paid_immediately ? "Продажа за наличные записана" : "Продажа записана"}
          party={customer.name}
          partyHref={back}
          amount={String(sale.total)}
          debtLabel="Долг клиента"
          debtBefore={debtBefore}
          debtAfter={balance}
          kind="sale"
          id={sale.id}
          canUndo={sale.created_by === user.id && Date.now() - Date.parse(sale.created_at) < 2 * 60 * 1000}
          reversed={Boolean(sale.reversed_at)}
          notes={
            <>
              {duplicate && <p className="notice">Это фото уже приложено к другой записи — проверьте, не задвоилось ли.</p>}
              {undo === "expired" && <p className="form-error">Прошло больше 2 минут — отменить может владелец с причиной.</p>}
            </>
          }
        >
          <Link className="button" href="/money/new?type=sale">
            Ещё продажа
          </Link>
          <Link className="button" href={back}>
            Открыть клиента
          </Link>
        </RecordResult>
      )}
      <Link className="back-link" href={back}>
        ← {customer.name}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ПРОДАЖА</span>
          <h1>Отправить клиенту</h1>
          <p className="muted">
            {date} · {money(sale.total)}
            {sale.paid_immediately ? " · оплачено" : ""}
          </p>
        </div>
      </div>

      {sale.reversed_at ? (
        <p className="form-error" role="alert">
          Эта продажа отменена — отправлять её клиенту не нужно.
        </p>
      ) : (
        <section className="panel send-invoice-panel">
          {checked ? (
            <p className="notice success">Накладная сверена — клиент получит PDF и ссылку на долг.</p>
          ) : pending ? (
            <p className="notice">
              Накладная распознаётся — PDF появится через несколько секунд. Можно не ждать и
              отправить только долг.
            </p>
          ) : status === "review" || status === "failed" ? (
            <p className="notice">
              Итог накладной не сверен — PDF отправим после проверки.{" "}
              {sale.document_id && (
                <Link className="text-button" href={`/documents/${sale.document_id}`}>
                  Проверить накладную
                </Link>
              )}
              {" "}Сейчас можно отправить только долг.
            </p>
          ) : (
            <p className="notice">Фото накладной нет — клиент получит сумму и ссылку на долг.</p>
          )}
          {revoked && (
            <p className="muted">
              Ссылка клиента отозвана — сообщение уйдёт без ссылок. Новую ссылку можно создать в{" "}
              <Link className="text-button" href={back}>
                карточке клиента
              </Link>
              .
            </p>
          )}
          {!customer.phone && (
            <p className="muted">
              У клиента нет телефона — WhatsApp спросит, кому отправить.
            </p>
          )}
          <pre className="send-invoice-preview">{text}</pre>
          <SendInvoice
            phone={waPhone(customer.phone)}
            text={text}
            fileText={message(true)}
            pdfUrl={checked && sale.document_id ? `/documents/${sale.document_id}/pdf` : null}
            fileName={`Накладная ${date}.pdf`}
            pending={pending}
          />
        </section>
      )}
    </>
  );
}
