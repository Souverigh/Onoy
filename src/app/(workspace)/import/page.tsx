import Link from "next/link";
import { getContext } from "@/lib/context";
import { NotebookImport, type ImportParty } from "@/components/notebook-import";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: rawKind } = await searchParams;
  const kind = rawKind === "suppliers" ? "suppliers" : "customers";
  const { db, organizationId } = await getContext();
  const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
  const [parties, invoiceOpenings, paymentOpenings] = await Promise.all([
    db
      .from(kind === "customers" ? "customer_balances" : "supplier_balances")
      .select("id,name,aliases,balance")
      .eq("organization_id", organizationId)
      .order("name")
      .range(0, 1999),
    db
      .from(kind === "customers" ? "sales" : "purchases")
      .select(partyColumn)
      .eq("organization_id", organizationId)
      .eq("is_opening", true)
      .is("reversed_at", null),
    db
      .from("payments")
      .select(partyColumn)
      .eq("organization_id", organizationId)
      .eq("is_opening", true)
      .is("reversed_at", null)
      .not(partyColumn, "is", null),
  ]);
  if (parties.error) throw new Error("Не удалось загрузить справочник");
  // Колонки is_opening может ещё не быть (миграция не применена) — тогда
  // считаем, что переносов не было; сама запись всё равно упадёт с понятной ошибкой.
  const transferred = new Set(
    [...(invoiceOpenings.data ?? []), ...(paymentOpenings.data ?? [])].map(
      (row) => (row as Record<string, string>)[partyColumn],
    ),
  );
  const list: ImportParty[] = (
    (parties.data ?? []) as { id: string; name: string; aliases: string[] | null; balance: string }[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    balance: p.balance,
    transferred: transferred.has(p.id),
  }));

  return (
    <>
      <Link className="back-link" href={`/${kind}`}>
        ← {kind === "customers" ? "Клиенты" : "Поставщики"}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ПОДКЛЮЧЕНИЕ МАГАЗИНА</span>
          <h1>Перенос тетради</h1>
          <p className="muted">
            Текущие долги из бумажной тетради — один раз, при подключении. Сфотографируйте
            страницы или впишите вручную, проверьте список и сохраните.
          </p>
        </div>
      </div>
      <div className="tabs">
        <Link className={kind === "customers" ? "selected" : ""} href="/import?kind=customers">
          Клиенты мне должны
        </Link>
        <Link className={kind === "suppliers" ? "selected" : ""} href="/import?kind=suppliers">
          Я должен поставщикам
        </Link>
      </div>
      <NotebookImport key={kind} kind={kind} parties={list} />
    </>
  );
}
