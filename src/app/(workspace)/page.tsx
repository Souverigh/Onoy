import { getContext } from "@/lib/context";
import { Dashboard, type Summary } from "@/components/dashboard";
import { unclosedDays } from "@/lib/day-summary";
export default async function Home() {
  const { db, organizationId } = await getContext();
  const [stats, events, unclosed, late] = await Promise.all([
    db.rpc("dashboard_summary", { org: organizationId }),
    db
      .from("audit_events")
      .select("id,action,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(5),
    unclosedDays(db, organizationId),
    // Просрочено больше 30 дней: неоплаченные продажи старше месяца.
    db
      .from("customer_debt_aging")
      .select("due_31_60,due_61_90,due_over_90")
      .eq("organization_id", organizationId)
      .gt("oldest_days", 30)
      .range(0, 4999),
  ]);
  const lateRows = late.data ?? [];
  const overdue = {
    count: lateRows.length,
    amount: lateRows
      .reduce(
        (sum, r) =>
          sum + Math.round((Number(r.due_31_60) + Number(r.due_61_90) + Number(r.due_over_90)) * 100),
        0,
      ) / 100,
  };
  if (stats.error || events.error)
    throw new Error("Не удалось загрузить показатели");
  return (
    <Dashboard
      summary={stats.data as Summary}
      events={events.data ?? []}
      unclosedDays={unclosed}
      overdue={overdue}
    />
  );
}
