import { getContext } from "@/lib/context";
import { Dashboard, type Summary } from "@/components/dashboard";
import { dayHistory, unclosedDays } from "@/lib/day-summary";
import { recentRecords } from "@/lib/recent";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { db, organizationId, isOwner } = await getContext();
  const { error } = await searchParams;
  const review = db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["review", "failed"]);
  // Продавцу итоги магазина не показываем (ТЗ) — и не считаем.
  if (!isOwner) {
    const [recent, reviewResult] = await Promise.all([recentRecords(db, organizationId), review]);
    return (
      <Dashboard
        summary={null}
        staff
        ownerOnlyNotice={error === "owner"}
        recent={recent}
        reviewCount={reviewResult.count ?? 0}
      />
    );
  }
  const [stats, unclosed, late, history, claims, reviewResult, recent] = await Promise.all([
    db.rpc("dashboard_summary", { org: organizationId }),
    unclosedDays(db, organizationId),
    // Просрочено больше 30 дней: неоплаченные продажи старше месяца.
    db
      .from("customer_debt_aging")
      .select("due_31_60,due_61_90,due_over_90")
      .eq("organization_id", organizationId)
      .gt("oldest_days", 30)
      .range(0, 4999),
    dayHistory(db, organizationId, 1),
    db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
    review,
    recentRecords(db, organizationId),
  ]);
  if (stats.error) throw new Error("Не удалось загрузить показатели");
  const lateRows = late.data ?? [];
  const overdue = {
    count: lateRows.length,
    amount:
      lateRows.reduce(
        (sum, r) => sum + Math.round((Number(r.due_31_60) + Number(r.due_61_90) + Number(r.due_over_90)) * 100),
        0,
      ) / 100,
  };
  const todayRow = history[0]; // за 1 день — одна строка, сегодня
  return (
    <Dashboard
      summary={stats.data as Summary}
      unclosedDays={unclosed}
      overdue={overdue}
      today={todayRow ? { sold: todayRow.sold, collected: todayRow.collected } : undefined}
      pendingClaims={claims.count ?? 0}
      reviewCount={reviewResult.count ?? 0}
      recent={recent}
    />
  );
}
