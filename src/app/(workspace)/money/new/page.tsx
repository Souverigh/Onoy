import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OperationForm } from "@/components/operation-form";
import { getContext } from "@/lib/context";

type Operation = "purchase" | "sale" | "payment";
type Party = { id: string; name: string };

export default async function NewOperation({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; error?: string }>;
}) {
  const params = await searchParams;
  if (!["purchase", "sale", "payment"].includes(params.type ?? ""))
    notFound();
  const kind = params.type as Operation;
  const { db, organizationId } = await getContext();
  const [customerResult, supplierResult] = await Promise.all([
    db
      .from("customers")
      .select("id,name")
      .eq("organization_id", organizationId)
      .order("name")
      .range(0, 999),
    db
      .from("suppliers")
      .select("id,name")
      .eq("organization_id", organizationId)
      .order("name")
      .range(0, 999),
  ]);
  if (customerResult.error || supplierResult.error)
    throw new Error("Не удалось подготовить форму операции");

  const customers = (customerResult.data ?? []) as Party[];
  const suppliers = (supplierResult.data ?? []) as Party[];
  const needsParty =
    kind === "purchase"
      ? suppliers.length > 0
      : kind === "sale"
        ? customers.length > 0
        : customers.length > 0 || suppliers.length > 0;
  const title =
    kind === "purchase"
      ? "Приход"
      : kind === "sale"
        ? "Продажа"
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
      {!needsParty ? (
        <section className="panel empty">
          <h2>Кого добавить?</h2>
          <p>
            {kind === "purchase"
              ? "Чтобы записать приход, сначала добавьте поставщика."
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
      ) : (
        <section className="panel simple-operation-panel">
          <OperationForm
            kind={kind}
            idempotencyKey={randomUUID()}
            customers={customers}
            suppliers={suppliers}
            error={params.error}
          />
        </section>
      )}
    </>
  );
}
