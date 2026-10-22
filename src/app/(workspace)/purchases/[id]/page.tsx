import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { money, originalAmountText, quantity } from "@/lib/format";
import { memberLabels } from "@/lib/members";
import { waPhone } from "@/lib/share";
import { SendInvoice } from "@/components/send-invoice";
import { ConfirmButton } from "@/components/confirm-button";
import { correctPurchase, restoreAsDraft } from "@/app/(workspace)/drafts/actions";

const FIX_ERROR: Record<string, string> = {
  fix: "Не удалось исправить приход - он остался как был. Обновите страницу и попробуйте снова.",
  fix_owner: "Исправить приход через 2 минуты после записи может только владелец.",
  restore:
    "Не удалось открыть приход черновиком - возможно, какой-то товар удалён со склада. Обновите страницу и попробуйте снова.",
};

type Item = { id: string; name_snapshot: string; qty: string; price: string; line_total: string; unit: string | null; product_id: string };

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Bishkek" }).format(new Date(value));
const day = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek" }).format(new Date(value));

/**
 * Приход товарами без фото (просьба пользователя 17.10.2026): у него не было
 * своей страницы. Приход по фото открывается на странице документа.
 */
export default async function PurchasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, organizationName, isOwner, user, currency: shopCurrency } = await getContext();

  const recordResult = await db
    .from("purchases")
    .select(
      "id,total,occurred_at,created_at,status,is_opening,reversed_at,reversal_comment,document_id,created_by,original_amount,original_currency,fx_rate,note,supplier_id,suppliers(name,phone,currency)",
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const record = recordResult.data as unknown as {
    id: string;
    total: string;
    occurred_at: string;
    created_at: string;
    status: string;
    is_opening: boolean;
    reversed_at: string | null;
    reversal_comment: string | null;
    document_id: string | null;
    created_by: string | null;
    original_amount: string | null;
    original_currency: string | null;
    fx_rate: string | null;
    note: string | null;
    supplier_id: string;
    suppliers: { name: string; phone: string | null; currency: string | null } | null;
  } | null;
  if (recordResult.error || !record || record.status !== "posted") notFound();
  if (record.document_id) redirect(`/documents/${record.document_id}`);

  const [itemsResult, members] = await Promise.all([
    db
      .from("purchase_items")
      .select("id,name_snapshot,qty,price,line_total,unit,product_id")
      .eq("organization_id", organizationId)
      .eq("purchase_id", record.id)
      .order("n")
      .order("created_at"),
    memberLabels(db, organizationId),
  ]);
  const items = (itemsResult.data ?? []) as Item[];

  const debtCurrency = record.suppliers?.currency ?? shopCurrency;
  // Строки — в валюте поставщика (purchase_items_party_currency.sql).
  const lineCurrency = record.original_currency ?? debtCurrency;
  const supplierName = record.suppliers?.name ?? "Поставщик";
  const supplierHref = `/suppliers/${record.supplier_id}`;
  const author = record.created_by ? members.get(record.created_by)?.name : undefined;
  const original = originalAmountText(record);
  const canCorrect =
    !record.reversed_at &&
    !record.is_opening &&
    items.length > 0 &&
    (isOwner || (record.created_by === user.id && Date.now() - Date.parse(record.created_at) < 2 * 60 * 1000));
  const hasInvoice = !record.is_opening && !record.reversed_at && items.length > 0;
  const canRestore = Boolean(record.reversed_at) && !record.is_opening && items.length > 0;
  const pdfUrl = `/purchases/${record.id}/pdf`;
  const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek" }).format(
    new Date(record.occurred_at),
  );
  const sendText = `Приходная накладная от ${shortDate}: ${money(record.original_amount ?? record.total, lineCurrency)}. ${organizationName}`;

  return (
    <>
      <Link className="back-link" href="/purchases">
        ← Весь приход
      </Link>
      <div className="page-heading">
        <div>
          <h1>
            {record.is_opening ? "Долг из тетради" : "Товар от поставщика"} · {money(record.total, debtCurrency)}
          </h1>
          <p className="muted">
            <Link href={supplierHref}>{supplierName}</Link> · {dateTime(record.occurred_at)}
          </p>
        </div>
        <div className="page-heading-actions">
          {/* «Исправить»: приход отменяется, те же товары открываются черновиком. */}
          {canCorrect && (
            <form action={correctPurchase}>
              <input type="hidden" name="id" value={record.id} />
              <input type="hidden" name="back" value={`/purchases/${record.id}`} />
              <ConfirmButton
                className="button primary"
                danger={false}
                message="Исправить приход?"
                text="Этот приход отменится (в истории он останется), долг поставщику и склад вернутся. Откроется форма с тем же поставщиком, товарами, ценами и датой - исправьте и запишите заново."
                confirmLabel="Исправить"
                cancelLabel="Не надо"
              >
                Исправить приход
              </ConfirmButton>
            </form>
          )}
          {!record.reversed_at && isOwner && (
            <Link className="button" href={`/money/reverse/purchase/${record.id}`}>
              Отменить
            </Link>
          )}
          {/* Отменённый приход — обратно черновиком; сам он остаётся отменённым. */}
          {canRestore && (
            <form action={restoreAsDraft}>
              <input type="hidden" name="id" value={record.id} />
              <input type="hidden" name="kind" value="purchase" />
              <button className="button primary">Открыть как черновик</button>
            </form>
          )}
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {FIX_ERROR[error] ?? FIX_ERROR.fix}
        </p>
      )}
      {record.reversed_at && (
        <p className="notice" role="status">
          Запись отменена{record.reversal_comment ? `: ${record.reversal_comment}` : ""}. Долг и склад уже пересчитаны,
          запись осталась в истории.
        </p>
      )}

      <section className="panel">
        <dl className="details record-details">
          <dt>Поставщик</dt>
          <dd>
            <Link href={supplierHref}>{supplierName}</Link>
          </dd>
          <dt>Сумма</dt>
          <dd>
            {money(record.total, debtCurrency)}
            {original && <span className="muted"> ({original})</span>}
          </dd>
          <dt>Дата</dt>
          <dd>{dateTime(record.occurred_at)}</dd>
          <dt>Кто внёс</dt>
          <dd>
            {author ?? "-"}
            {/* Записано задним числом — когда внесли на самом деле. */}
            {day(record.created_at) !== day(record.occurred_at) && (
              <span className="muted"> · внесено {dateTime(record.created_at)}</span>
            )}
          </dd>
          {record.note && (
            <>
              <dt>Комментарий</dt>
              <dd>{record.note}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="panel record-send">
        <div className="section-title">
          <h2>Накладная</h2>
        </div>
        {hasInvoice ? (
          <SendInvoice
            phone={waPhone(record.suppliers?.phone)}
            text={sendText}
            fileText={sendText}
            imageUrl={pdfUrl}
            // Латиница без пробелов: Chrome на Android отклоняет share() с кириллицей.
            fileName={`prihod-${day(record.occurred_at)}.pdf`}
            pending={false}
            fileType="application/pdf"
            to="поставщику"
          />
        ) : (
          <p className="muted">
            {record.reversed_at
              ? "Запись отменена - накладную не отправляем."
              : record.is_opening
                ? "Долг из тетради - накладной нет."
                : "Приход записан одной суммой, без товаров - PDF не из чего собрать."}
          </p>
        )}
        <div className="simple-operation-actions record-send-actions">
          {hasInvoice && (
            <a className="button" href={pdfUrl} target="_blank" rel="noreferrer">
              Открыть PDF
            </a>
          )}
          <Link className="button" href={supplierHref}>
            Открыть поставщика и все записи
          </Link>
        </div>
      </section>

      {items.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <h2>Товары</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      {isOwner ? <Link href={`/stock/${item.product_id}`}>{item.name_snapshot}</Link> : item.name_snapshot}
                    </td>
                    <td>
                      {quantity(item.qty)} {item.unit ?? ""}
                    </td>
                    <td>{money(item.price, lineCurrency)}</td>
                    <td>{money(item.line_total, lineCurrency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <strong>Итого</strong>
                  </td>
                  <td>
                    <strong>{money(items.reduce((s, it) => s + Number(it.line_total), 0).toFixed(2), lineCurrency)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
