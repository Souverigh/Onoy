import type { SupabaseClient } from "@supabase/supabase-js";
import type { Currency } from "./currency";

export type CurrencyDebts = { currency: Currency; receivable: number; payable: number };

/**
 * Долги на сейчас по валютам: клиенты должны нам, мы — поставщикам. Как на
 * главной: каждая валюта отдельно, без пересчёта. Считаем в тийынах/центах.
 */
export async function debtTotalsByCurrency(
  db: SupabaseClient,
  organizationId: string,
  shopCurrency: Currency,
): Promise<CurrencyDebts[]> {
  const [customers, suppliers] = await Promise.all([
    db.from("customer_balances").select("balance,currency").eq("organization_id", organizationId).range(0, 4999),
    db.from("supplier_balances").select("balance,currency").eq("organization_id", organizationId).range(0, 4999),
  ]);
  if (customers.error || suppliers.error) throw new Error("debtTotalsByCurrency failed");
  const debts = new Map<Currency, { receivable: number; payable: number }>();
  const add = (currency: string | null, key: "receivable" | "payable", value: string) => {
    const cur = (currency ?? shopCurrency) as Currency;
    const d = debts.get(cur) ?? { receivable: 0, payable: 0 };
    d[key] += Math.round(Number(value) * 100);
    debts.set(cur, d);
  };
  for (const c of customers.data ?? []) add(c.currency, "receivable", c.balance);
  for (const s of suppliers.data ?? []) add(s.currency, "payable", s.balance);
  return [...debts.entries()].map(([currency, d]) => ({ currency, receivable: d.receivable / 100, payable: d.payable / 100 }));
}

type PeriodMoves = { sold: number; collected: number; purchased: number; paidSuppliers: number };

/**
 * Блоки «В $», «В ₽» для отчёта за период: что было за период в этой валюте
 * и долги в ней на сейчас. Пустые строки и пустые валюты — не показываем.
 */
export function foreignBlocks(
  moves: { currency: Currency; current: PeriodMoves }[],
  debts: CurrencyDebts[],
  shopCurrency: Currency,
): { currency: Currency; lines: { label: string; value: number }[] }[] {
  const currencies = [
    ...new Set([...moves.map((m) => m.currency), ...debts.map((d) => d.currency)]),
  ].filter((c) => c !== shopCurrency);
  return currencies
    .map((currency) => {
      const m = moves.find((x) => x.currency === currency)?.current;
      const d = debts.find((x) => x.currency === currency);
      return {
        currency,
        lines: [
          { label: "Продано", value: m?.sold ?? 0 },
          { label: "Собрано", value: m?.collected ?? 0 },
          { label: "Товар от поставщиков", value: m?.purchased ?? 0 },
          { label: "Оплачено поставщикам", value: m?.paidSuppliers ?? 0 },
          { label: "Долг клиентов сейчас", value: d?.receivable ?? 0 },
          { label: "Мой долг поставщикам сейчас", value: d?.payable ?? 0 },
        ].filter((line) => Math.abs(line.value) >= 0.005),
      };
    })
    .filter((block) => block.lines.length > 0);
}
