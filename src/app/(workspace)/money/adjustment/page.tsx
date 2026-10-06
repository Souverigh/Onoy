import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { AdjustmentForm } from "@/components/adjustment-form";
import { InfoTip } from "@/components/info-tip";

type Party = { id: string; name: string; phone: string | null; aliases: string[] | null; balance: string; currency: string | null };

// Скидка или возврат товара (ТЗ §5, adjustment): уменьшает долг клиента или
// долг магазина перед поставщиком. Только с комментарием.
export default async function AdjustmentPage({
  searchParams,
}: {
  searchParams: Promise<{ party?: string; error?: string }>;
}) {
  const { party, error } = await searchParams;
  const { db, organizationId, currency: shopCurrency } = await requireOwner();
  const [customers, suppliers] = await Promise.all([
    // Архивных не показываем (задача 25).
    db.from("customer_balances").select("id,name,phone,aliases,balance,currency").eq("organization_id", organizationId).is("merged_into_id", null).is("archived_at", null).order("name").range(0, 4999),
    db.from("supplier_balances").select("id,name,phone,aliases,balance,currency").eq("organization_id", organizationId).is("merged_into_id", null).is("archived_at", null).order("name").range(0, 999),
  ]);
  if (customers.error || suppliers.error) throw new Error("Не удалось подготовить форму");
  const customerList = (customers.data ?? []) as Party[];
  const supplierList = (suppliers.data ?? []) as Party[];
  const initial = customerList.some((c) => c.id === party)
    ? `customers:${party}`
    : supplierList.some((s) => s.id === party)
      ? `suppliers:${party}`
      : "";
  const back = initial ? `/${initial.split(":")[0]}/${party}` : "/money";

  return (
    <>
      <Link className="back-link" href={back}>
        ← Назад
      </Link>
      <div className="page-heading">
        <h1 className="label-with-tip">
          Скидка или возврат
          <InfoTip>Уменьшает долг. Деньгами не считается — в «Собрано» не попадёт.</InfoTip>
        </h1>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error === "note"
            ? "Напишите, за что скидка или что вернули — без комментария запись не сохранится."
            : error === "over"
              ? "Больше долга записать нельзя — скидкой не делается аванс. Проверьте сумму."
            : error === "over_qty"
              ? "Столько вернуть нельзя: это больше, чем клиент брал, с учётом прошлых возвратов. Обновите страницу и проверьте."
            : error === "lines"
              ? "Эти товары уже нельзя вернуть: продажа отменена или изменилась. Обновите страницу."
            : error === "retry"
              ? "Эта запись уже отправлялась. Проверьте историю клиента или поставщика."
              : "Проверьте сумму и выбранного клиента или поставщика."}
        </p>
      )}
      <section className="panel form-panel">
        <AdjustmentForm
          parties={[
            ...customerList.map((c) => ({ ...c, id: `customers:${c.id}` })),
            ...supplierList.map((s) => ({ ...s, id: `suppliers:${s.id}`, name: `${s.name} (поставщик)` })),
          ]}
          initial={initial}
          idempotencyKey={randomUUID()}
          shopCurrency={shopCurrency}
        />
      </section>
    </>
  );
}
