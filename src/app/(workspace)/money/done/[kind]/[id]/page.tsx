import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money, originalAmountText } from "@/lib/format";
import { partyCurrency } from "@/lib/currency";
import { ensureShareToken, waPhone } from "@/lib/share";
import { paymentLabelWithSide, type PaymentKind } from "@/lib/entry-labels";
import { RecordResult } from "@/components/record-result";

const UNDO_MS = 2 * 60 * 1000;

// Экран результата для прихода и оплаты (ТЗ §15.2). Продажа — /money/send.
export default async function DonePage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ part?: string; duplicate?: string; undo?: string }>;
}) {
  const { kind, id } = await params;
  const { part, duplicate, undo } = await searchParams;
  if (!["purchase", "payment"].includes(kind) || !/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, organizationName, user, currency: shopCurrency } = await getContext();

  if (kind === "purchase") {
    const row = (
      await db
        .from("purchases")
        .select("id,supplier_id,total,created_at,created_by,reversed_at,original_amount,original_currency,fx_rate")
        .eq("organization_id", organizationId)
        .eq("id", id)
        .maybeSingle()
    ).data;
    if (!row) notFound();
    const supplier = (
      await db.from("supplier_balances").select("id,name,balance,currency").eq("organization_id", organizationId).eq("id", row.supplier_id).maybeSingle()
    ).data;
    if (!supplier) notFound();
    const paid = part && /^\d+(\.\d{1,2})?$/.test(part) ? Number(part) : 0;
    const after = Number(supplier.balance);
    return (
      <>
        <RecordResult
          title="Приход записан"
          party={supplier.name}
          partyHref={`/suppliers/${supplier.id}`}
          amount={String(row.total)}
          currency={partyCurrency(supplier, shopCurrency)}
          original={originalAmountText(row)}
          debtLabel="Мы должны поставщику"
          debtBefore={Math.round((after - Number(row.total) + paid) * 100) / 100}
          debtAfter={after}
          kind="purchase"
          id={row.id}
          canUndo={row.created_by === user.id && Date.now() - Date.parse(row.created_at) < UNDO_MS}
          reversed={Boolean(row.reversed_at)}
          notes={
            <>
              {paid > 0 && <p className="notice success">Сразу оплачено поставщику: {money(paid, partyCurrency(supplier, shopCurrency))}.</p>}
              {part === "failed" && (
                <p className="form-error">Оплату поставщику записать не удалось — внесите её через «Оплата».</p>
              )}
              {duplicate && <p className="notice">Это фото уже приложено к другой записи — проверьте, не задвоилось ли.</p>}
              {undo === "expired" && <p className="form-error">Прошло больше 2 минут — отменить может владелец с причиной.</p>}
            </>
          }
        >
          <Link className="button primary" href="/money/new?type=purchase">
            Ещё приход
          </Link>
          <Link className="button" href={`/suppliers/${supplier.id}`}>
            Открыть поставщика
          </Link>
        </RecordResult>
      </>
    );
  }

  const row = (
    await db
      .from("payments")
      .select("id,customer_id,supplier_id,direction,amount,kind,status,duplicate_of,bank_reference,created_at,created_by,reversed_at,original_amount,original_currency,fx_rate")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle()
  ).data;
  if (!row) notFound();
  const incoming = row.direction === "incoming";
  const partyId = (incoming ? row.customer_id : row.supplier_id) as string;
  const party = (
    await db
      .from(incoming ? "customer_balances" : "supplier_balances")
      .select("id,name,phone,balance,currency")
      .eq("organization_id", organizationId)
      .eq("id", partyId)
      .maybeSingle()
  ).data;
  if (!party) notFound();
  const after = Number(party.balance);
  const cur = partyCurrency(party, shopCurrency);
  const partyHref = `/${incoming ? "customers" : "suppliers"}/${party.id}`;
  // Номер перевода уже есть в другой оплате — записана «на проверке», долг не менялся.
  const firstPayment = row.status === "pending" && row.duplicate_of
    ? (
        await db
          .from("payments")
          .select("occurred_at,amount,customer_id,supplier_id")
          .eq("organization_id", organizationId)
          .eq("id", row.duplicate_of)
          .maybeSingle()
      ).data
    : null;
  const onReview = row.status === "pending";

  // Квитанция клиенту в WhatsApp (ТЗ §4 В.1: «клиенту по желанию уходит квитанция»).
  let receiptHref: string | null = null;
  if (incoming && !row.reversed_at && !onReview) {
    const { token } = await ensureShareToken(db, organizationId, party.id);
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
    const text = [
      `Магазин «${organizationName}»: получили вашу оплату ${originalAmountText(row)?.replace(/ по .*/, "") ?? money(row.amount, cur)}.`,
      after > 0 ? `Ваш долг: ${money(after, cur)}.` : after < 0 ? `Долга нет, аванс: ${money(-after, cur)}.` : "Долга нет.",
      token ? `Накладные и история: ${origin}/c/${token}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    receiptHref = `https://wa.me/${waPhone(party.phone)}?text=${encodeURIComponent(text)}`;
  }

  return (
    <RecordResult
      currency={cur}
      original={originalAmountText(row)}
      title={
        onReview
          ? "Оплата записана как дубликат — на проверке"
          : `${paymentLabelWithSide(row.kind as PaymentKind, row.direction as "incoming" | "outgoing")} — записано`
      }
      party={party.name}
      partyHref={partyHref}
      amount={String(row.amount)}
      debtLabel={incoming ? "Долг клиента" : "Мы должны поставщику"}
      debtBefore={onReview ? after : Math.round((after + Number(row.amount)) * 100) / 100}
      debtAfter={after}
      kind="payment"
      id={row.id}
      canUndo={!onReview && row.created_by === user.id && Date.now() - Date.parse(row.created_at) < UNDO_MS}
      reversed={Boolean(row.reversed_at)}
      notes={
        <>
          {onReview && (
            <p className="notice">
              Номер перевода {row.bank_reference} уже есть в оплате
              {firstPayment
                ? ` от ${new Intl.DateTimeFormat("ru-RU", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Asia/Bishkek",
                  }).format(new Date(firstPayment.occurred_at))} на ${money(firstPayment.amount, cur)}`
                : ""}
              . Долг не
              изменился — владелец подтвердит или отклонит эту оплату в «Заявках».
            </p>
          )}
          {duplicate && <p className="notice">Это фото уже приложено к другой записи — проверьте, не задвоилось ли.</p>}
          {undo === "expired" && <p className="form-error">Прошло больше 2 минут — отменить может владелец с причиной.</p>}
        </>
      }
    >
      {receiptHref && (
        <a className="button primary" href={receiptHref} target="_blank" rel="noreferrer">
          Отправить квитанцию клиенту
        </a>
      )}
      <Link className={receiptHref ? "button" : "button primary"} href="/money/new?type=payment">
        Ещё оплата
      </Link>
      <Link className="button" href={partyHref}>
        Открыть {incoming ? "клиента" : "поставщика"}
      </Link>
    </RecordResult>
  );
}
