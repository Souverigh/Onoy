import { getContext } from "@/lib/context";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getContext();
  const review = await ctx.db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .eq("status", "review");
  return (
    <Shell name={ctx.organizationName} reviewCount={review.count ?? 0}>
      {children}
    </Shell>
  );
}
