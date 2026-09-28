import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { money } from "@/lib/format";
import { Submit } from "@/components/submit";
import { commitAdjustment } from "../actions";

type Party = { id: string; name: string; balance: string };

// Скидка или возврат товара (ТЗ §5, adjustment): уменьшает долг клиента или
// долг магазина перед поставщиком. Только с комментарием.
export default async function AdjustmentPage({
  searchParams,
}: {
  searchParams: Promise<{ party?: string; error?: string }>;
}) {
  const { party, error } = await searchParams;
  const { db, organizationId } = await requireOwner();
  const [customers, suppliers] = await Promise.all([
    db.from("customer_balances").select("id,name,balance").eq("organization_id", organizationId).is("merged_into_id", null).order("name").range(0, 999),
    db.from("supplier_balances").select("id,name,balance").eq("organization_id", organizationId).is("merged_into_id", null).order("name").range(0, 999),
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
        <div>
          <h1>Скидка или возврат</h1>
          <p className="muted">Уменьшает долг. Деньгами не считается — в «Собрано» не попадёт.</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error === "note"
            ? "Напишите, за что скидка или что вернули — без комментария запись не сохранится."
            : error === "retry"
              ? "Эта запись уже отправлялась. Проверьте историю контрагента."
              : "Проверьте сумму и выбранного клиента или поставщика."}
        </p>
      )}
      <section className="panel form-panel">
        <form action={commitAdjustment} className="simple-operation-form">
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          <label>
            Клиент или поставщик
            <select name="party" required defaultValue={initial}>
              <option value="">Выберите из списка</option>
              {customerList.length > 0 && (
                <optgroup label="Клиенты">
                  {customerList.map((c) => (
                    <option key={c.id} value={`customers:${c.id}`}>
                      {c.name} · долг {money(c.balance)}
                    </option>
                  ))}
                </optgroup>
              )}
              {supplierList.length > 0 && (
                <optgroup label="Поставщики">
                  {supplierList.map((s) => (
                    <option key={s.id} value={`suppliers:${s.id}`}>
                      {s.name} · мы должны {money(s.balance)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <fieldset className="adjustment-kind">
            <legend>Что это</legend>
            <label>
              <input type="radio" name="kind" value="discount" defaultChecked /> Скидка
            </label>
            <label>
              <input type="radio" name="kind" value="return" /> Возврат товара
            </label>
          </fieldset>
          <label className="amount-field">
            Сколько сом?
            <input
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              required
              pattern="[0-9 ]+([.,][0-9]{1,2})?"
              placeholder="0"
            />
          </label>
          <label>
            Комментарий (обязательно)
            <input name="note" required maxLength={500} placeholder="Например: вернул 2 автомата 16А" />
          </label>
          <Submit>Записать</Submit>
        </form>
      </section>
    </>
  );
}
