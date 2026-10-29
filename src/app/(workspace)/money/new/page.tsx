import { randomUUID } from "node:crypto";
import { word } from "@/lib/business";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ModeTabs, type SaleMode } from "@/components/mode-tabs";
import { OperationForm } from "@/components/operation-form";
import { SaleItemsForm } from "@/components/sale-items-form";
import type { StockProduct } from "@/lib/match";
import type { QuickProduct } from "../../stock/actions";
import { getContext } from "@/lib/context";
import { memberLabels } from "@/lib/members";
import { partPaymentOf } from "@/lib/part-payment";
import type { Maker } from "@/components/maker-field";
import { officialRates } from "@/lib/fx";
import { isCurrency } from "@/lib/currency";
import { documentPages, signedPhotoUrl } from "@/lib/storage";
import { draftData, type Draft } from "@/lib/drafts";
import type { InvoiceLine, InvoiceResult } from "@/lib/adre/types";
import { NEW_PRODUCT, type StockChoices } from "@/lib/match";
import { loadVariants } from "@/lib/model-data";

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
    draft?: string;
    fixed?: string;
    restored?: string;
    /** Продажа по заказу из каталога: «1» или «missing» — часть товаров убрали со склада. */
    order?: string;
    fix?: string;
    replace?: string;
    day?: string;
    from?: string;
    paid?: string;
    part?: string;
  }>;
}) {
  const params = await searchParams;
  if (!["purchase", "sale", "payment"].includes(params.type ?? ""))
    notFound();
  const kind = params.type as Operation;
  const { db, organizationId, currency: shopCurrency, isOwner, modules, business } = await getContext();
  // «Склад» выключен — без вкладки «Товары со склада»; начатый черновик товарами всё же открываем.
  const stockOn = modules.includes("stock");
  // «Клиент принёс деньги» / «Я заплатил поставщику» (задача 17).
  const fixedDirection =
    kind === "payment" && (params.direction === "incoming" || params.direction === "outgoing")
      ? params.direction
      : undefined;
  // Продажа и приход: по фото накладной (по умолчанию, задача 10), товарами
  // со склада или только суммой; открываем вид, где продавец был в прошлый раз.
  const itemsKind = kind === "sale" || kind === "purchase";
  const remembered = (await cookies()).get(`mode_${kind}`)?.value;
  // Черновик (только ручной ввод товаров): свой, того же вида — RLS и фильтр.
  const draftParam = itemsKind && params.draft && /^[a-f0-9-]{36}$/i.test(params.draft) ? params.draft : undefined;
  const draftResult = draftParam
    ? await db
        .from("record_drafts")
        .select("id,kind,data,updated_at")
        .eq("organization_id", organizationId)
        .eq("kind", kind)
        .eq("id", draftParam)
        .maybeSingle()
    : null;
  const draft: Draft | undefined = draftResult?.data
    ? { id: draftResult.data.id, kind: kind as Draft["kind"], data: draftData(draftResult.data.data), updated_at: draftResult.data.updated_at }
    : undefined;
  const wantedMode: SaleMode =
    draftParam || (stockOn && params.mode === "items")
      ? "items"
      : params.mode === "photo" || params.mode === "amount"
        ? params.mode
        : stockOn && remembered === "items"
          ? "items"
          : remembered === "amount"
            ? "amount"
            : "photo";
  const productsRequest =
    itemsKind && !params.documentId && wantedMode === "items"
      ? db
          .from("product_balances")
          .select("id,name,sku,unit,sale_price,purchase_price,purchase_currency,stock,aliases,sold_count")
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .order("name")
          .range(0, 4999)
      : Promise.resolve({ data: [] as QuickProduct[], error: null });
  // Продажа по фото: строки накладной сверяем со складом (просьба пользователя
  // 15.10.2026); цена продажи — для строк фото без цены. Без цен закупки —
  // продавцу они не нужны. Приход по фото: склад — для «+ Добавить строку»
  // поиском, с ценой закупки (22.10.2026).
  const stockRequest =
    // Фото из другой формы («Исправить») — всегда по фото, какой бы вид ни запомнили.
    itemsKind && (wantedMode === "photo" || params.documentId)
      ? db
          .from("product_balances")
          .select(
            kind === "purchase"
              ? "id,name,sku,unit,sale_price,purchase_price,purchase_currency,stock,aliases,sold_count"
              : "id,name,sku,unit,sale_price,stock,aliases,sold_count",
          )
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .order("name")
          .range(0, 4999)
      : Promise.resolve({ data: [] as StockProduct[], error: null });
  // Размеры одной модели — одной строкой в поиске товара (миграция 20261029100000).
  const variantsRequest =
    itemsKind && !params.documentId && wantedMode === "items"
      ? loadVariants(db, organizationId)
      : Promise.resolve({ variants: {}, models: {} });
  const [customerResult, supplierResult, rates, productResult, stockResult, variantData] = await Promise.all([
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
    stockRequest,
    variantsRequest,
  ]);
  const products = (productResult.data ?? []) as QuickProduct[];
  // Склад не загрузился — продажа всё равно пишется, просто без списания по выбору.
  // Приход: без склада выбор по строкам не показываем — база найдёт товары сама.
  const stockProducts = stockResult.error ? undefined : ((stockResult.data ?? []) as StockProduct[]);
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
  // «Исправить продажу» по фото: строки накладной (с правками) и выбор товаров
  // склада — из отменённой продажи; сумма и дата пришли в адресе.
  // «Исправить продажу/приход» по фото: всё — из отменённой записи, фото не
  // читается заново. Строки (с правками продавца) и выбор товаров склада —
  // её; номер, дата и итог с бумаги — из её сохранённого распознавания.
  let correction: { result: InvoiceResult; choices: StockChoices } | undefined;
  if (itemsKind && params.fix === "1" && existingDocument && params.from && /^[a-f0-9-]{36}$/i.test(params.from)) {
    const old = await db
      .from(kind === "sale" ? "sales" : "purchases")
      .select("document_id,line_products")
      .eq("organization_id", organizationId)
      .eq("id", params.from)
      .maybeSingle();
    const oldRow = old.data as { document_id: string | null; line_products?: unknown } | null;
    if (oldRow?.document_id) {
      const [oldLines, oldExtraction] = await Promise.all([
        db
          .from("document_lines")
          .select("n,name_raw,qty,unit,price,product_id")
          .eq("organization_id", organizationId)
          .eq("document_id", oldRow.document_id)
          .order("n"),
        db
          .from("document_extractions")
          .select("payload")
          .eq("organization_id", organizationId)
          .eq("document_id", oldRow.document_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const lines: InvoiceLine[] = (oldLines.data ?? []).map((l) => ({
        n: Number(l.n),
        name_raw: String(l.name_raw ?? ""),
        qty: String(Number(l.qty)),
        unit: String(l.unit ?? "шт"),
        price: String(Number(l.price)),
        sum: String(Math.round(Number(l.qty) * Number(l.price) * 100) / 100),
        confidence: 1,
      }));
      const saved = (oldExtraction.data?.payload as { extracted?: Partial<InvoiceResult> } | null)?.extracted ?? {};
      const result: InvoiceResult = {
        ...saved,
        date: saved.date ?? null,
        number: saved.number ?? null,
        total_declared: saved.total_declared ?? null,
        currency: isCurrency(saved.currency) ? saved.currency : (isCurrency(params.currency) ? params.currency : shopCurrency),
        warnings: [],
        lines,
        total_computed: Math.round(lines.reduce((t, l) => t + Number(l.sum), 0) * 100) / 100,
        seller_edited: true,
      };
      const choices: StockChoices = {};
      for (const c of Array.isArray(oldRow.line_products) ? (oldRow.line_products as { n?: unknown; product?: unknown; new?: unknown }[]) : [])
        if (typeof c?.n === "number")
          choices[c.n] = typeof c.product === "string" ? c.product : c.new === true ? NEW_PRODUCT : null;
      // Строка уже легла на товар (в том числе заведённый «Новым товаром») —
      // исправление берёт его, а не заводит второй такой же.
      for (const l of oldLines.data ?? [])
        if (typeof l.product_id === "string" && (choices[Number(l.n)] === NEW_PRODUCT || !(Number(l.n) in choices)))
          choices[Number(l.n)] = l.product_id;
      correction = { result, choices };
    }
  }
  // «Исправить» / «Открыть заново»: запись останется за продавцом отменённой,
  // а не за тем, кто её сейчас записывает (просьба пользователя 22.10.2026).
  const fromId =
    itemsKind && draft?.data.from
      ? draft.data.from
      : itemsKind && params.fix === "1" && existingDocument && params.from && /^[a-f0-9-]{36}$/i.test(params.from)
        ? params.from
        : undefined;
  let maker: Maker | undefined;
  let movesData: { product_id: string; qty_delta: string }[] = [];
  if (fromId) {
    const [old, members, moves] = await Promise.all([
      db
        .from(kind === "sale" ? "sales" : "purchases")
        .select(
          kind === "sale"
            ? "maker_id,total,reversed_at,paid_immediately,party_id:customer_id,created_at,created_by"
            : "maker_id,total,reversed_at,party_id:supplier_id,supplier_id,created_at,created_by",
        )
        .eq("organization_id", organizationId)
        .eq("id", fromId)
        .maybeSingle(),
      memberLabels(db, organizationId),
      // Движения склада заменяемой записи — для остатков «как после замены».
      db
        .from("inventory_movements")
        .select("product_id,qty_delta")
        .eq("organization_id", organizationId)
        .eq(kind === "sale" ? "sale_id" : "purchase_id", fromId),
    ]);
    movesData = (moves.data ?? []) as { product_id: string; qty_delta: string }[];
    const row = old.data as unknown as {
      maker_id: string | null;
      total: string;
      reversed_at: string | null;
      paid_immediately?: boolean;
      party_id: string;
      supplier_id?: string;
      created_at: string;
      created_by: string | null;
    } | null;
    if (row) {
      // Старая ещё действует (исправление) — при записи она отменится: сколько
      // её доля в долге, чтобы «Долг станет …» в форме был после замены.
      let replaces: Maker["replaces"];
      if (!row.reversed_at) {
        let debt = kind === "sale" ? (row.paid_immediately ? 0 : Number(row.total)) : Number(row.total);
        if (kind === "purchase" && row.supplier_id) {
          const part = await partPaymentOf(db, organizationId, {
            supplier_id: row.supplier_id,
            created_at: row.created_at,
            created_by: row.created_by,
          });
          if (part) debt -= Number(part.amount);
        }
        replaces = { party: row.party_id, debt };
      }
      maker = {
        from: fromId,
        defaultId: row.maker_id,
        options: [...members].map(([id, m]) => ({ id, name: m.name })),
        canChange: isOwner,
        replaces,
      };
    }
  }
  // Исправление: старая запись действует, пока новую не записали.
  const replacing = Boolean(maker?.replaces);
  // Её товар ещё списан со склада (продажа) или принят (приход) — в форме
  // показываем остаток как после замены, без ложного «уйдёт в минус».
  const stockShift = new Map<string, number>();
  if (maker?.replaces)
    for (const m of movesData) stockShift.set(m.product_id, (stockShift.get(m.product_id) ?? 0) + Number(m.qty_delta));
  const afterReplace = <T extends { id: string; stock: string }>(list: T[]): T[] =>
    stockShift.size
      ? list.map((p) =>
          stockShift.has(p.id)
            ? { ...p, stock: String(Math.round((Number(p.stock) - stockShift.get(p.id)!) * 1000) / 1000) }
            : p,
        )
      : list;
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
      ? word(business, "purchase")
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
          {fixedDirection && (
            <p className="muted">
              {fixedDirection === "outgoing" ? "Запишите уже сделанную оплату" : "Запишите деньги, которые клиент уже отдал"}
            </p>
          )}
        </div>
      </div>
      {itemsKind && !params.documentId && needsParty && (
        <ModeTabs
          kind={kind as "sale" | "purchase"}
          selected={saleMode}
          party={initialParty}
          stock={stockOn}
        />
      )}
      {replacing && (params.fixed === "1" || params.replace === "1") && (
        <p className="notice" role="status">
          {kind === "sale" ? "Исправляете продажу." : "Исправляете приход."} Пока не нажали «Записать», прошлая запись
          действует как была. При записи она заменится этой (в истории останется отменённой)
          {kind === "purchase" && params.part && /^\d+(\.\d{1,2})?$/.test(params.part)
            ? `, оплата поставщику ${params.part}, внесённая с ней, тоже отменится - внесите её заново через «Я заплатил поставщику»`
            : ""}
          . Передумали - просто уйдите, ничего не изменится.
        </p>
      )}
      {!replacing && params.fixed === "1" && draft && (
        <p className="notice success" role="status">
          {kind === "sale"
            ? "Прошлая продажа отменена - долг и склад вернулись, в истории она осталась."
            : "Прошлый приход отменён - долг поставщику и склад вернулись, в истории он остался."}{" "}
          Исправьте товары и запишите заново. Пока не записали - это черновик.
          {kind === "purchase" && params.part && /^\d+(\.\d{1,2})?$/.test(params.part) && (
            <> Оплата поставщику {params.part} тоже отменена - после записи внесите её через «Я заплатил поставщику».</>
          )}
        </p>
      )}
      {params.restored === "1" && (draft || existingDocument) && (
        <p className="notice success" role="status">
          {kind === "sale" ? "Отменённая продажа открыта снова" : "Отменённый приход открыт снова"} - те же{" "}
          {kind === "sale" ? "клиент" : "поставщик"}, {existingDocument ? "фото, строки" : "товары"}, цены и дата. Проверьте и
          запишите: появится новая запись, отменённая останется в истории.
        </p>
      )}
      {params.order && kind === "sale" && draft && (
        <p className="notice success" role="status">
          Продажа по заказу из каталога: товары, количество и цены - из заказа.
          {params.order === "missing" && " Часть товаров уже убрали со склада - их в списке нет."}{" "}
          {draft.data.party ? "Проверьте" : "Выберите клиента, проверьте"} товары и запишите - заказ станет «Продан».
        </p>
      )}
      {draftParam && !draft && (
        <p className="notice" role="status">
          Этого черновика уже нет - его записали или удалили. Ниже - новая пустая форма.
        </p>
      )}
      {(params.undone || params.redo) && (
        <p className="notice success" role="status">
          {params.undone ? "Прошлая запись отменена." : "Запись отменена."}{" "}
          {params.fix === "1"
            ? `${kind === "purchase" ? "Поставщик" : "Клиент"}, строки, сумма, дата и фото - из прошлой записи: исправьте, что нужно, и подтвердите.`
            : `${kind === "purchase" || (kind === "payment" && params.direction === "outgoing") ? "Поставщик" : "Клиент"}, сумма и фото - как были: исправьте, что нужно, и подтвердите.`}
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
        <section className="panel simple-operation-panel wide-operation-panel">
          <SaleItemsForm
            // Другой черновик — другая форма; перерисовка той же страницы (после
            // «+ Новый клиент», «+ Новый товар») введённое не сбрасывает.
            key={draft?.id ?? "new"}
            kind={kind === "purchase" ? "purchase" : "sale"}
            customers={kind === "purchase" ? suppliers : customers}
            products={afterReplace(products)}
            variants={variantData.variants}
            models={variantData.models}
            shopCurrency={shopCurrency}
            rates={rates}
            idempotencyKey={randomUUID()}
            initialParty={initialParty}
            draft={draft}
            maker={maker}
          />
        </section>
      ) : (
        <section
          className={`panel simple-operation-panel${kind === "payment" && prefill ? "" : " wide-operation-panel"}`}
        >
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
            stockProducts={itemsKind && stockProducts ? afterReplace(stockProducts) : undefined}
            fixedDirection={fixedDirection}
            initialAmount={
              !prefill && params.amount && /^\d{1,14}(\.\d{1,2})?$/.test(params.amount)
                ? String(Number(params.amount)).replace(".", ",")
                : undefined
            }
            initialCurrency={!prefill && isCurrency(params.currency) ? params.currency : undefined}
            // «Исправить продажу» по фото: дата прошлой продажи, строки накладной — сразу на виду.
            initialDate={itemsKind && params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : undefined}
            correcting={params.fix === "1"}
            correction={correction}
            maker={maker}
            // Вкладка «Фото» / «Сумма»; с фото из другой формы — без вкладок.
            source={itemsKind && !params.documentId ? (saleMode === "amount" ? "amount" : "photo") : undefined}
            initialPaidNow={
              kind === "purchase" && params.fix === "1" && params.paid && /^\d{1,14}(\.\d{1,2})?$/.test(params.paid)
                ? params.paid.replace(".", ",")
                : undefined
            }
          />
        </section>
      )}
    </>
  );
}
