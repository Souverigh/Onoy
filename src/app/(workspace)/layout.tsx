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
    <Shell name={ctx.organizationName} reviewCount={review.count ?? 0} isOwner={ctx.isOwner}>
      {ctx.blocked && (
        <p className="form-error shop-blocked" role="alert">
          Магазин приостановлен{ctx.blocked.reason ? `: ${ctx.blocked.reason}` : ""}. Данные доступны для
          просмотра, но новые записи внести нельзя. Напишите в Depter.
        </p>
      )}
      {children}
    </Shell>
  );
}
