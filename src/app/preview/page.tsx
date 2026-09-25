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
    <Shell name="Мой магазин" preview>
      <Dashboard
        summary={{
          sold: 0,
          receivable: 0,
          payable: 0,
          low_stock: 0,
          review: 0,
        }}
        preview
      />
    </Shell>
  );
}
