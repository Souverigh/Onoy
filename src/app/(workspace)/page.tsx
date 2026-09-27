import { getContext } from "@/lib/context";
import { Dashboard, type Summary } from "@/components/dashboard";
import { unclosedDays } from "@/lib/day-summary";
export default async function Home() {
  const { db, organizationId } = await getContext();
  const [stats, events, unclosed] = await Promise.all([
    db.rpc("dashboard_summary", { org: organizationId }),
    db
      .from("audit_events")
      .select("id,action,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(5),
    unclosedDays(db, organizationId),
  ]);
  if (stats.error || events.error)
    throw new Error("Не удалось загрузить показатели");
  return (
    <Dashboard summary={stats.data as Summary} events={events.data ?? []} unclosedDays={unclosed} />
  );
}
