import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { signedPhotoUrl } from "@/lib/storage";
import { confirmClaim, rejectClaim } from "./actions";
import { Submit } from "@/components/submit";

type Claim = {
  id: string;
  customer_id: string;
  amount: string;
  claim_comment: string | null;
  document_id: string | null;
  occurred_at: string;
};

export default async function Claims({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { db, organizationId } = await getContext();
  const { error, done } = await searchParams;
  const { data, error: loadError } = await db
    .from("payments")
    .select("id,customer_id,amount,claim_comment,document_id,occurred_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("occurred_at", { ascending: false });
  if (loadError) throw new Error("Не удалось загрузить заявки");
  const claims = (data ?? []) as Claim[];
  const customerIds = [...new Set(claims.map((c) => c.customer_id))];
  const [customerLookup, documentLookup] = await Promise.all([
    customerIds.length
      ? db.from("customers").select("id,name,phone").eq("organization_id", organizationId).in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; phone: string }[] }),
    db
      .from("documents")
      .select("id,storage_path")
      .eq("organization_id", organizationId)
      .in("id", claims.map((c) => c.document_id).filter(Boolean) as string[]),
  ]);
  const customers = new Map(
    (customerLookup.data ?? []).map((c) => [c.id, c]),
  );
  const documents = new Map(
    (documentLookup.data ?? []).map((d) => [d.id, d.storage_path]),
  );
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
            Клиент нажал «Я оплатил» на своей странице. Долг снизится только после
            вашего подтверждения.
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
            const customer = customers.get(claim.customer_id);
            return (
              <section className="panel claim-card" key={claim.id}>
                <div className="section-title">
                  <h2>{customer?.name ?? "Клиент"}</h2>
                  <strong>{money(claim.amount)}</strong>
                </div>
                {claim.claim_comment && (
                  <p className="muted">«{claim.claim_comment}»</p>
                )}
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
                <div className="claim-actions">
                  <form action={confirmClaim} className="claim-confirm-form">
                    <input type="hidden" name="id" value={claim.id} />
                    <label>
                      Сумма
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
          <p>Здесь появятся заявки «Я оплатил» со страницы клиента.</p>
        </div>
      )}
    </>
  );
}
