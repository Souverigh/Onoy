import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money, originalAmountText, quantity } from "@/lib/format";
import { memberLabels } from "@/lib/members";

type Item = { id: string; name_snapshot: string; qty: string; price: string; line_total: string; unit: string | null; product_id: string };

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Bishkek" }).format(new Date(value));
const day = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek" }).format(new Date(value));

/**
 * Одна продажа или один приход из списка «Продажа» / «Товар от поставщика»
 * (просьба пользователя 17.10.2026): кто, когда, сколько и какие товары.
 */
export default async function RecordPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if ((kind !== "sale" && kind !== "purchase") || !/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const sale = kind === "sale";
  const { db, organizationId, isOwner, currency: shopCurrency } = await getContext();

  const recordResult = sale
    ? await db
        .from("sales")
        .select(
          "id,total,occurred_at,created_at,status,is_opening,paid_immediately,reversed_at,reversal_comment,document_id,created_by,original_amount,original_currency,fx_rate,party_id:customer_id,party:customers(name,currency)",
        )
        .eq("organization_id", organizationId)
        .eq("id", id)
        .maybeSingle()
    : await db
        .from("purchases")
        .select(
          "id,total,occurred_at,created_at,status,is_opening,reversed_at,reversal_comment,document_id,created_by,original_amount,original_currency,fx_rate,party_id:supplier_id,party:suppliers(name,currency)",
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
    paid_immediately?: boolean;
    reversed_at: string | null;
    reversal_comment: string | null;
    document_id: string | null;
    created_by: string | null;
    original_amount: string | null;
    original_currency: string | null;
    fx_rate: string | null;
    party_id: string;
    party: { name: string; currency: string | null } | null;
  } | null;
  if (recordResult.error || !record || record.status !== "posted") notFound();

  const [itemsResult, members] = await Promise.all([
    db
      .from(sale ? "sale_items" : "purchase_items")
      .select("id,name_snapshot,qty,price,line_total,unit,product_id")
      .eq("organization_id", organizationId)
      .eq(sale ? "sale_id" : "purchase_id", record.id)
      .order("n")
      .order("created_at"),
    memberLabels(db, organizationId),
  ]);
  const items = (itemsResult.data ?? []) as Item[];

  const debtCurrency = record.party?.currency ?? shopCurrency;
  // Строки — в валюте накладной: продажа в другой валюте — в валюте магазина
  // (долг пересчитан по курсу), иначе — в валюте долга.
  const lineCurrency = record.original_currency ?? debtCurrency;
  const partyName = record.party?.name ?? (sale ? "Клиент" : "Поставщик");
  const partyHref = `/${sale ? "customers" : "suppliers"}/${record.party_id}`;
  const author = record.created_by ? members.get(record.created_by)?.name : undefined;
  const original = originalAmountText(record);
  const title = record.is_opening ? "Долг из тетради" : sale ? "Продажа" : "Товар от поставщика";

  return (
    <>
      <Link className="back-link" href={sale ? "/sales" : "/purchases"}>
        ← {sale ? "Все продажи" : "Весь приход"}
      </Link>
      <div className="page-heading">
        <div>
          <h1>
            {title} · {money(record.total, debtCurrency)}
          </h1>
          <p className="muted">
            <Link href={partyHref}>{partyName}</Link> · {dateTime(record.occurred_at)}
          </p>
        </div>
        <div className="page-heading-actions">
          {sale && !record.reversed_at && !record.is_opening && (
            <Link className="button primary" href={`/money/send/${record.id}`}>
              Отправить клиенту
            </Link>
          )}
          {!record.reversed_at && isOwner && (
            <Link className="button" href={`/money/reverse/${kind}/${record.id}`}>
              Отменить
            </Link>
          )}
        </div>
      </div>
      {record.reversed_at && (
        <p className="notice" role="status">
          Запись отменена{record.reversal_comment ? `: ${record.reversal_comment}` : ""}. Долг{sale ? "" : " и склад"} уже
          пересчитаны, запись осталась в истории.
        </p>
      )}

      <section className="panel">
        <dl className="details record-details">
          <dt>{sale ? "Клиент" : "Поставщик"}</dt>
          <dd>
            <Link href={partyHref}>{partyName}</Link>
          </dd>
          <dt>Сумма</dt>
          <dd>
            {money(record.total, debtCurrency)}
            {original && <span className="muted"> ({original})</span>}
          </dd>
          {sale && (
            <>
              <dt>Оплата</dt>
              <dd>{record.paid_immediately ? "Наличными сразу" : "В долг"}</dd>
            </>
          )}
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
          {record.document_id && (
            <>
              <dt>Накладная</dt>
              <dd>
                <Link href={`/documents/${record.document_id}`}>Фото и строки накладной →</Link>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Товары</h2>
        </div>
        {items.length ? (
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
        ) : (
          <p className="muted">
            {record.document_id
              ? "Записано по фото накладной - строки смотрите в накладной."
              : record.is_opening
                ? "Долг перенесён из тетради одной суммой, без товаров."
                : "Записано одной суммой, без списка товаров."}
          </p>
        )}
      </section>
    </>
  );
}
