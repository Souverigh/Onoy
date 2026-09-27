import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/context";
import { money } from "@/lib/format";
import { reverseOperation } from "@/app/(workspace)/money/actions";
import { safeBackPath } from "@/lib/back-path";
import { Submit } from "@/components/submit";
import { paymentLabel, type PaymentKind } from "@/lib/entry-labels";

type Kind = "purchase" | "sale" | "payment";
const tables: Record<Kind, { table: string; amountField: string; partyTable: string; partyField: string; label: string }> = {
  purchase: { table: "purchases", amountField: "total", partyTable: "suppliers", partyField: "supplier_id", label: "Приход" },
  sale: { table: "sales", amountField: "total", partyTable: "customers", partyField: "customer_id", label: "Продажа" },
  payment: { table: "payments", amountField: "amount", partyTable: "customers", partyField: "customer_id", label: "Оплата" },
};

export default async function ReverseOperation({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { kind: rawKind, id } = await params;
  const { back: rawBack } = await searchParams;
  const back = safeBackPath(rawBack);
  if (!["purchase", "sale", "payment"].includes(rawKind)) notFound();
  const kind = rawKind as Kind;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId } = await requireOwner();
  const meta = tables[kind];
  const row = await db
    .from(meta.table)
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (row.error || !row.data) notFound();
  const data = row.data as Record<string, unknown>;
  if (data.reversed_at) notFound();

  let party = kind === "payment" && data.direction === "outgoing" ? "поставщик" : "клиент";
  if (kind === "payment" && data.direction === "outgoing") {
    const supplier = data.supplier_id
      ? await db.from("suppliers").select("name").eq("organization_id", organizationId).eq("id", data.supplier_id).maybeSingle()
      : null;
    party = supplier?.data?.name ?? "поставщик";
  } else if (kind === "purchase") {
    const supplier = await db.from("suppliers").select("name").eq("organization_id", organizationId).eq("id", data.supplier_id).maybeSingle();
    party = supplier.data?.name ?? "поставщик";
  } else {
    const customer = await db.from("customers").select("name").eq("organization_id", organizationId).eq("id", data.customer_id).maybeSingle();
    party = customer.data?.name ?? "клиент";
  }

  return (
    <>
      <Link className="back-link" href={back ?? "/money"}>
        ← {back ? "Назад" : "Деньги"}
      </Link>
      <div className="page-heading">
        <h1>
          Отменить запись:{" "}
          {data.is_opening
            ? kind === "payment"
              ? "аванс из тетради"
              : "долг из тетради"
            : kind === "payment"
              ? paymentLabel(data.kind as PaymentKind).toLowerCase()
              : meta.label.toLowerCase()}
        </h1>
      </div>
      <section className="panel simple-operation-panel">
        <p>
          {party} · {money(String(data[meta.amountField]))}
        </p>
        <p className="operation-hint">
          Запись не удаляется — она останется в истории с пометкой «отменена»,
          долг пересчитается сразу.
        </p>
        <form action={reverseOperation} className="simple-operation-form">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          {back && <input type="hidden" name="back" value={back} />}
          <label>
            Почему отменяем?
            <textarea name="comment" required maxLength={500} rows={3} placeholder="Например: ошиблись суммой" />
          </label>
          <div className="simple-operation-actions">
            <Submit>Да, отменить запись</Submit>
            <Link className="text-button" href={back ?? "/money"}>
              Не отменять
            </Link>
          </div>
        </form>
      </section>
    </>
  );
}
