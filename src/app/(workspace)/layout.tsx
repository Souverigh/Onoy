import { getContext } from "@/lib/context";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getContext();
  return <Shell name={ctx.organizationName}>{children}</Shell>;
}
