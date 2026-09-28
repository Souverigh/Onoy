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
          sold: 12400,
          receivable: 378340,
          payable: 55816.76,
          low_stock: 0,
          review: 0,
        }}
        today={{ sold: 12400, collected: 5000 }}
        pendingClaims={3}
        reviewCount={1}
        unclosedDays={["2026-09-26"]}
        recent={[
          { key: "1", label: "Продажа в долг", party: "Медербек", partyHref: "/customers", amount: "5850", at: new Date().toISOString(), reversed: false },
          { key: "2", label: "Получена оплата", party: "Асан", partyHref: "/customers", amount: "5000", at: new Date().toISOString(), reversed: false },
          { key: "3", label: "Приход", party: "Horoz Electric", partyHref: "/suppliers", amount: "3006.96", at: new Date().toISOString(), reversed: true },
        ]}
        preview
      />
    </Shell>
  );
}
