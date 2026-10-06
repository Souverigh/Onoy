import { randomUUID } from "node:crypto";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ModeTabs } from "@/components/mode-tabs";
import { OperationForm } from "@/components/operation-form";
import { SaleItemsForm } from "@/components/sale-items-form";
import type { QuickProduct } from "../../stock/actions";
import { getContext } from "@/lib/context";
import { officialRates } from "@/lib/fx";
import { isCurrency } from "@/lib/currency";
import { documentPages, signedPhotoUrl } from "@/lib/storage";

type Operation = "purchase" | "sale" | "payment";
type Party = { id: string; name: string; currency: string | null };

export default async function NewOperation({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    error?: string;
    documentId?: string;
    amount?: string;
    bankRef?: string;
    date?: string;
    currency?: string;
    suggest?: string;
    party?: string;
    undone?: string;
    mode?: string;
    direction?: string;
    redo?: string;
  }>;
}) {
  const params = await searchParams;
  if (!["purchase", "sale", "payment"].includes(params.type ?? ""))
    notFound();
  const kind = params.type as Operation;
  const { db, organizationId, currency: shopCurrency } = await getContext();
  // «Клиент принёс деньги» / «Я заплатил поставщику» (задача 17).
  const fixedDirection =
    kind === "payment" && (params.direction === "incoming" || params.direction === "outgoing")
      ? params.direction
      : undefined;
  // Продажа и приход: по фото накладной (по умолчанию, задача 10) или
  // товарами со склада; открываем вид, где продавец был в прошлый раз.
  const itemsKind = kind === "sale" || kind === "purchase";
  const remembered = (await cookies()).get(`mode_${kind}`)?.value;
  const wantedMode = params.mode === "items" || params.mode === "photo" ? params.mode : remembered === "items" ? "items" : "photo";
  const productsRequest =
    itemsKind && !params.documentId && wantedMode === "items"
      ? db
          .from("product_balances")
          .select("id,name,sku,unit,sale_price,purchase_price,stock,aliases,sold_count")
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .order("name")
          .range(0, 4999)
      : Promise.resolve({ data: [] as QuickProduct[], error: null });
  const [customerResult, supplierResult, rates, productResult] = await Promise.all([
    db
      .from("customer_balances")
      .select("id,name,phone,aliases,balance,credit_limit,currency")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .is("merged_into_id", null)
      .order("name")
      .range(0, 4999),
    db
      .from("supplier_balances")
      .select("id,name,phone,aliases,balance,currency")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .is("merged_into_id", null)
      .order("name")
      .range(0, 999),
    // Курс НБКР / ЦБ РФ — для суммы в другой валюте, чем долг (кеш на час).
    officialRates(["KGS", "USD", "RUB"]),
    productsRequest,
  ]);
  const products = (productResult.data ?? []) as QuickProduct[];
  // Фото из другой формы — всегда по фото.
  const saleMode = !itemsKind || params.documentId ? "photo" : wantedMode;
  if (customerResult.error || supplierResult.error)
    throw new Error("Не удалось подготовить форму операции");

  type Customer = Party & { balance: string; credit_limit: string | null };
  const customers = (customerResult.data ?? []) as Customer[];
  const suppliers = (supplierResult.data ?? []) as Party[];
  const suggestedIds = params.suggest ? params.suggest.split(",").filter(Boolean) : [];
  const suggestions = suggestedIds
    .map((id) => customers.find((c) => c.id === id))
    .filter((c): c is Customer => Boolean(c));
  const prefill =
    kind === "payment" && params.documentId && /^[a-f0-9-]{36}$/i.test(params.documentId)
      ? {
          documentId: params.documentId,
          amount: params.amount,
          bankRef: params.bankRef,
          date: params.date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(params.date) ? params.date : undefined,
          currency: isCurrency(params.currency) ? params.currency : undefined,
          suggestions,
        }
      : undefined;
  // Накладная, переведённая из другой формы («Записать как приход»): фото уже
  // загружено — показываем его, заново выбирать не нужно.
  let existingDocument: { documentId: string; pages: { url: string | null; mimeType: string }[] } | undefined;
  if (kind !== "payment" && params.documentId && /^[a-f0-9-]{36}$/i.test(params.documentId)) {
    const doc = await db
      .from("documents")
      .select("id,kind")
      .eq("organization_id", organizationId)
      .eq("id", params.documentId)
      .maybeSingle();
    if (doc.data?.kind === kind) {
      const pages = await documentPages(db, organizationId, doc.data.id);
      existingDocument = {
        documentId: doc.data.id,
        pages: await Promise.all(
          pages.map(async (page) => ({
            url: await signedPhotoUrl(db, page.storage_path),
            mimeType: page.mime_type,
          })),
        ),
      };
    }
  }
  // Из карточки клиента/поставщика: берём, только если он из подходящего списка.
  const initialParty = [...(kind === "purchase" ? [] : customers), ...(kind === "sale" ? [] : suppliers)].some(
    (p) => p.id === params.party,
  )
    ? params.party
    : undefined;
  const needsParty =
    kind === "purchase"
      ? suppliers.length > 0
      : kind === "sale"
        ? customers.length > 0
        : customers.length > 0 || suppliers.length > 0;
  const title =
    kind === "purchase"
      ? "Товар от поставщика"
      : kind === "sale"
        ? "Продажа"
        : fixedDirection === "incoming"
          ? "Клиент принёс деньги"
          : fixedDirection === "outgoing"
            ? "Я заплатил поставщику"
            : "Оплата";
  const target =
    kind === "purchase"
      ? { href: "/suppliers/new", label: "Добавить поставщика" }
      : kind === "sale"
        ? { href: "/customers/new", label: "Добавить клиента" }
        : { href: "/customers/new", label: "Добавить клиента" };

  return (
    <>
      <div className="page-heading operation-page-heading">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      {itemsKind && !params.documentId && needsParty && (
        <ModeTabs
          kind={kind as "sale" | "purchase"}
          selected={saleMode}
          party={initialParty}
        />
      )}
      {(params.undone || params.redo) && (
        <p className="notice success" role="status">
          {params.undone ? "Прошлая запись отменена." : "Запись отменена."} Клиент, сумма и фото — как были: исправьте,
          что нужно, и подтвердите.
        </p>
      )}
      {!needsParty ? (
        <section className="panel empty">
          <h2>Кого добавить?</h2>
          <p>
            {kind === "purchase"
              ? "Чтобы записать товар от поставщика, сначала добавьте поставщика."
              : kind === "sale"
                ? "Чтобы записать продажу, сначала добавьте клиента."
                : "Сначала добавьте клиента или поставщика."}
          </p>
          <div className="simple-operation-actions">
            <Link className="button primary" href={target.href}>
              {target.label}
            </Link>
            {kind === "payment" && (
              <Link className="button" href="/suppliers/new">
                Добавить поставщика
              </Link>
            )}
            <Link className="text-button" href="/money">
              Назад
            </Link>
          </div>
        </section>
      ) : saleMode === "items" ? (
        <section className="panel simple-operation-panel">
          <SaleItemsForm
            kind={kind === "purchase" ? "purchase" : "sale"}
            customers={kind === "purchase" ? suppliers : customers}
            products={products}
            shopCurrency={shopCurrency}
            rates={rates}
            idempotencyKey={randomUUID()}
            initialParty={initialParty}
          />
        </section>
      ) : (
        <section className="panel simple-operation-panel">
          <OperationForm
            kind={kind}
            idempotencyKey={randomUUID()}
            partPaymentKey={randomUUID()}
            customers={customers}
            suppliers={suppliers}
            error={params.error}
            prefill={prefill}
            existingDocument={existingDocument}
            initialParty={initialParty}
            shopCurrency={shopCurrency}
            rates={rates}
            fixedDirection={fixedDirection}
            initialAmount={
              !prefill && params.amount && /^\d{1,14}(\.\d{1,2})?$/.test(params.amount)
                ? String(Number(params.amount)).replace(".", ",")
                : undefined
            }
            initialCurrency={!prefill && isCurrency(params.currency) ? params.currency : undefined}
          />
        </section>
      )}
    </>
  );
}
