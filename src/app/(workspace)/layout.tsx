import { getContext } from "@/lib/context";
import { Shell } from "@/components/shell";
import { subscriptionState } from "@/lib/subscription";
import { bishkekDate } from "@/lib/day-summary";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getContext();
  const sub = subscriptionState(ctx.paidUntil, ctx.blocked?.reason, Boolean(ctx.blocked), bishkekDate());
  const date = (d: string) =>
    new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00+06:00`));
  // Бейджи: заявки клиентов (деньги, главный) и накладные с расхождением.
  const [review, claims] = await Promise.all([
    ctx.db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .in("status", ["review", "failed"]),
    ctx.isOwner
      ? ctx.db
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organizationId)
          .eq("status", "pending")
      : Promise.resolve({ count: 0 }),
  ]);
  return (
    <Shell
      name={ctx.organizationName}
      reviewCount={review.count ?? 0}
      claimsCount={claims.count ?? 0}
      isOwner={ctx.isOwner}
    >
      {sub.kind === "blocked" && (
        <p className="form-error shop-blocked" role="alert">
          Магазин приостановлен{sub.reason ? `: ${sub.reason}` : ""}. Данные доступны для просмотра, новые
          записи внести нельзя. Страница клиентов по ссылке работает. Напишите в Depter.
        </p>
      )}
      {sub.kind === "expired" && (
        <p className="form-error shop-blocked" role="alert">
          Подписка закончилась {date(sub.paidUntil)}, льготная неделя прошла - только просмотр. Данные
          сохранены, страница клиентов работает. Оплатите подписку, чтобы снова вносить записи.
        </p>
      )}
      {ctx.isOwner && sub.kind === "grace" && (
        <p className="notice claims-notice shop-blocked" role="status">
          Подписка закончилась {date(sub.paidUntil)}. Льготный период до {date(sub.graceUntil)} - потом только
          просмотр.
        </p>
      )}
      {ctx.isOwner && sub.kind === "ending" && (
        <p className="notice shop-blocked" role="status">
          Подписка оплачена до {date(sub.paidUntil)}
          {sub.daysLeft === 0 ? " - сегодня последний день" : ` - осталось ${sub.daysLeft} дн.`}.
        </p>
      )}
      {children}
    </Shell>
  );
}
