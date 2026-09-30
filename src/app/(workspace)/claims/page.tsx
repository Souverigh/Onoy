import { requireOwner } from "@/lib/context";
import { money, originalAmountText } from "@/lib/format";
import { CURRENCIES, CURRENCY_SIGN, partyCurrency } from "@/lib/currency";
import { checkReceipt, receiptAmounts, receiptDiffers } from "@/lib/claim-receipt";
import { officialRates } from "@/lib/fx";
import { signedPhotoUrl } from "@/lib/storage";
import { confirmClaim, rejectClaim } from "./actions";
import Link from "next/link";
import { Submit } from "@/components/submit";
import { duplicateReason, firstPaymentHref } from "@/lib/duplicates";

type Claim = {
  id: string;
  customer_id: string | null;
  supplier_id: string | null;
  amount: string;
  claim_comment: string | null;
  document_id: string | null;
  occurred_at: string;
  bank_reference: string | null;
  duplicate_of: string | null;
  created_by: string | null;
  original_amount: string | null;
  original_currency: string | null;
  fx_rate: string | null;
};
type FirstPayment = {
  id: string;
  amount: string;
  occurred_at: string;
  status: string;
  reversed_at: string | null;
  bank_reference: string | null;
  document_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
};
type Party = { id: string; name: string; currency: string | null };

// «чек в сомах, а заявка в рублях».
const IN_CURRENCY: Record<string, string> = { KGS: "сомах", RUB: "рублях", USD: "долларах" };

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Bishkek",
});

export default async function Claims({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { db, organizationId, currency: shopCurrency } = await requireOwner();
  const { error, done } = await searchParams;
  const { data, error: loadError } = await db
    .from("payments")
    .select("id,customer_id,supplier_id,amount,claim_comment,document_id,occurred_at,bank_reference,duplicate_of,created_by,original_amount,original_currency,fx_rate")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("occurred_at", { ascending: false });
  if (loadError) throw new Error("Не удалось загрузить заявки");
  const claims = (data ?? []) as Claim[];
  const customerIds = [...new Set(claims.map((c) => c.customer_id).filter(Boolean) as string[])];
  const supplierIds = [...new Set(claims.map((c) => c.supplier_id).filter(Boolean) as string[])];
  const firstIds = [...new Set(claims.map((c) => c.duplicate_of).filter(Boolean) as string[])];
  const none = Promise.resolve({ data: [] as Party[] });
  const [customerLookup, supplierLookup, firstLookup, documentLookup] = await Promise.all([
    customerIds.length
      ? db.from("customers").select("id,name,currency").eq("organization_id", organizationId).in("id", customerIds)
      : none,
    supplierIds.length
      ? db.from("suppliers").select("id,name,currency").eq("organization_id", organizationId).in("id", supplierIds)
      : none,
    firstIds.length
      ? db
          .from("payments")
          .select("id,amount,occurred_at,status,reversed_at,bank_reference,document_id,customer_id,supplier_id")
          .eq("organization_id", organizationId)
          .in("id", firstIds)
      : Promise.resolve({ data: [] as FirstPayment[] }),
    db
      .from("documents")
      .select("id,storage_path")
      .eq("organization_id", organizationId)
      .in("id", claims.map((c) => c.document_id).filter(Boolean) as string[]),
  ]);
  const parties = new Map<string, Party>(
    [...(customerLookup.data ?? []), ...(supplierLookup.data ?? [])].map((c) => [c.id, c]),
  );
  const firstPayments = new Map(((firstLookup.data ?? []) as FirstPayment[]).map((p) => [p.id, p]));
  const documents = new Map(
    (documentLookup.data ?? []).map((d) => [d.id, d.storage_path]),
  );
  // Что распознано на чеке заявки — сверить сумму с заявкой в валюте долга.
  const receipts = await receiptAmounts(db, organizationId, claims.map((c) => c.document_id).filter(Boolean) as string[]);
  // Официальный курс нужен, только если чек в другой валюте, а клиент её не указал.
  const needRates = claims.some((c) => {
    const r = c.document_id ? receipts.get(c.document_id) : undefined;
    const debt = partyCurrency(parties.get((c.customer_id ?? c.supplier_id) as string), shopCurrency);
    return r && r.currency !== debt && c.original_currency !== r.currency;
  });
  const rates = needRates ? await officialRates([...CURRENCIES]) : {};
  const photoUrls = new Map<string, string>();
  for (const claim of claims) {
    if (!claim.document_id) continue;
    const path = documents.get(claim.document_id);
    if (!path) continue;
    const url = await signedPhotoUrl(db, path);
    if (url) photoUrls.set(claim.id, url);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ОЖИДАЮТ ПОДТВЕРЖДЕНИЯ</span>
          <h1>Заявки на оплату</h1>
          <p className="muted">
            Клиент нажал «Я оплатил» на своей странице, или оплату записали с номером
            перевода, который уже есть в другой оплате (дубликат). Долг изменится только
            после вашего подтверждения.
          </p>
        </div>
      </div>
      {done === "confirmed" && (
        <p className="notice success" role="status">
          Заявка подтверждена, долг пересчитан.
        </p>
      )}
      {done === "rejected" && (
        <p className="notice success" role="status">
          Заявка отклонена.
        </p>
      )}
      {error === "invalid" && (
        <p className="form-error" role="alert">
          Не удалось обработать заявку. Проверьте сумму и попробуйте снова.
        </p>
      )}
      {claims.length ? (
        <div className="claims-list">
          {claims.map((claim) => {
            const partyId = claim.customer_id ?? claim.supplier_id;
            const party = partyId ? parties.get(partyId) : undefined;
            const currency = partyCurrency(party, shopCurrency);
            const first = claim.duplicate_of ? firstPayments.get(claim.duplicate_of) : undefined;
            const firstHref = first ? firstPaymentHref(first) : null;
            const original = originalAmountText(claim);
            const receipt = claim.document_id ? receipts.get(claim.document_id) : undefined;
            const check = receipt ? checkReceipt(claim, currency, receipt, rates) : null;
            const differs = check ? receiptDiffers(check) : false;
            return (
              <section className="panel claim-card" key={claim.id}>
                <div className="section-title">
                  <h2>
                    {party?.name ?? (claim.customer_id ? "Клиент" : "Поставщик")}
                    {claim.supplier_id && <span className="muted"> · оплата поставщику</span>}
                  </h2>
                  <strong>{money(claim.amount, currency)}</strong>
                </div>
                {claim.duplicate_of && (
                  <div className="duplicate-warning">
                    <strong>Дубликат{claim.created_by ? "" : " от клиента"}</strong>
                    <p>
                      {duplicateReason(claim, first)} уже есть в оплате
                      {first ? ` от ${dateTime.format(new Date(first.occurred_at))} на ${money(first.amount, currency)}` : ""}
                      {first?.reversed_at ? " (она отменена)" : first?.status === "rejected" ? " (она отклонена)" : ""}.
                      Подтвердите, только если это действительно вторая оплата.
                    </p>
                    {firstHref && (
                      <Link className="duplicate-link" href={firstHref}>
                        Первая запись →
                      </Link>
                    )}
                  </div>
                )}
                {original && (
                  <p className="muted">
                    Клиент указал {original} → {money(claim.amount, currency)}
                  </p>
                )}
                {check && (
                  <p className={differs ? "photo-check-mismatch" : "photo-check-ok"}>
                    По чеку: {money(check.receipt.amount, check.receipt.currency)}
                    {check.inDebt != null && check.receipt.currency !== currency && <> ≈ {money(check.inDebt, currency)}</>}
                    {check.diff == null
                      ? ` — чек в ${IN_CURRENCY[check.receipt.currency]}, курс сейчас недоступен. Проверьте сумму перед подтверждением.`
                      : !differs
                        ? " — совпадает с заявкой."
                        : ` — клиент указал ${money(claim.amount, currency)}, по чеку на ${money(Math.abs(check.diff), currency)} ${check.diff > 0 ? "больше" : "меньше"}.`}
                  </p>
                )}
                {claim.claim_comment && (
                  <p className="muted">«{claim.claim_comment}»</p>
                )}
                <div className="claim-links">
                {photoUrls.has(claim.id) && (
                  <a
                    className="claim-photo-link"
                    href={photoUrls.get(claim.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть фото квитанции
                  </a>
                )}
                {partyId && (
                  <a className="claim-photo-link" href={`/${claim.customer_id ? "customers" : "suppliers"}/${partyId}`}>
                    История {claim.customer_id ? "клиента" : "поставщика"}
                  </a>
                )}
                </div>
                <div className="claim-actions">
                  <form action={confirmClaim} className="claim-confirm-form">
                    <input type="hidden" name="id" value={claim.id} />
                    <label>
                      Сумма, {CURRENCY_SIGN[currency]}
                      <input
                        name="amount"
                        inputMode="decimal"
                        defaultValue={claim.amount}
                        required
                        pattern="[0-9 ]+([.,][0-9]{1,2})?"
                      />
                    </label>
                    <Submit>Подтвердить</Submit>
                  </form>
                  {check && differs && check.inDebt != null && check.inDebt > 0 && (
                    <form action={confirmClaim} className="claim-confirm-form">
                      <input type="hidden" name="id" value={claim.id} />
                      <input type="hidden" name="amount" value={check.inDebt.toFixed(2)} />
                      <Submit>Подтвердить по чеку: {money(check.inDebt, currency)}</Submit>
                    </form>
                  )}
                  <form action={rejectClaim} className="claim-reject-form">
                    <input type="hidden" name="id" value={claim.id} />
                    <input
                      name="comment"
                      placeholder="Почему отклоняете?"
                      required
                      maxLength={500}
                    />
                    <button className="button" type="submit">
                      Отклонить
                    </button>
                  </form>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <h2>Заявок нет</h2>
          <p>Здесь появятся заявки «Я оплатил» со страницы клиента и оплаты-дубликаты.</p>
        </div>
      )}
    </>
  );
}
