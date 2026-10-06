import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default function Preview() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ONGOY_PREVIEW !== "1"
  )
    notFound();
  return (
    <Shell name="Мой магазин" preview claimsCount={3} reviewCount={1}>
      <Dashboard
        summary={{
          debts: [
            { currency: "KGS", receivable: 378340, payable: 120500 },
            { currency: "USD", receivable: 0, payable: 55816.76 },
          ],
        }}
        today={{ sold: 12400, collected: 5000, expenses: 1500, currency: "KGS" }}
        pendingClaims={3}
        reviewCount={1}
        reminders={[{ id: "1", name: "Медербек", balance: 5850, currency: "KGS", reason: "обещал оплатить сегодня", waHref: null }]}
        recent={[
          { key: "1", label: "Продажа в долг", party: "Медербек", partyHref: "/customers", amount: "5850", currency: "KGS", at: new Date().toISOString(), reversed: false },
          { key: "2", label: "Получена оплата", party: "Асан", partyHref: "/customers", amount: "5000", currency: "KGS", at: new Date().toISOString(), reversed: false },
          { key: "3", label: "Товар от поставщика", party: "Horoz Electric", partyHref: "/suppliers", amount: "3006.96", currency: "USD", at: new Date().toISOString(), reversed: true },
        ]}
        preview
      />
    </Shell>
  );
}
