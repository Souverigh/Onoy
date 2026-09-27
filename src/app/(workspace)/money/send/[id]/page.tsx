import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { invoiceMessage } from "@/lib/invoice-message";
import { SendInvoice } from "@/components/send-invoice";

// Отправка клиенту накладной и ссылки на долг (ТЗ §4 Б). PDF — только когда
// накладная сверена (документ «оцифрована»); до этого уходит текст с долгом.
export default async function SendSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId } = await getContext();

  const saleResult = await db
    .from("sales")
    .select("id,customer_id,total,occurred_at,paid_immediately,reversed_at,is_opening,document_id,status")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const sale = saleResult.data;
  if (saleResult.error || !sale || sale.status !== "posted") notFound();

  const [customerResult, docResult, shopResult, linksResult] = await Promise.all([
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
    db
      .from("share_links")
      .select("token,revoked_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", sale.customer_id)
      .order("created_at", { ascending: false }),
  ]);
  const customer = customerResult.data;
  if (!customer) notFound();

  // Ссылки у клиента ещё не было — создаём (так же, как кнопкой в карточке).
  // Если магазин ссылку отзывал — сам не создаём, отправляем без неё.
  const links = linksResult.data ?? [];
  let token = links.find((l) => !l.revoked_at)?.token ?? null;
  const revoked = !token && links.length > 0;
  if (!token && !revoked) {
    const created = await db.rpc("create_share_link", {
      p_org: organizationId,
      p_customer: customer.id,
    });
    token = typeof created.data === "string" ? created.data : null;
  }

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

  return (
    <>
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
            phone={(customer.phone ?? "").replace(/[^0-9]/g, "")}
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
