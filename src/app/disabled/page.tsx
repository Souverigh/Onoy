import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/context";
import { LogoutButton } from "@/components/logout-button";

/**
 * Владелец отключил доступ продавцу (member_disabled.sql): данные магазина
 * ему не видны и записать он ничего не может. Здесь — только объяснение и
 * «Выйти». Доступ вернули — сразу в приложение.
 */
export default async function Disabled() {
  const { db, user } = await getUserContext();
  const { data } = await db
    .from("organization_members")
    .select("disabled_at")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) redirect("/onboarding");
  if (!data.disabled_at) redirect("/");
  return (
    <main className="center">
      <section className="panel onboarding">
        <div className="brand">Depter</div>
        <h1>Доступ отключён</h1>
        <p className="muted">
          Владелец магазина отключил ваш доступ. Ваши продажи и оплаты сохранены. Чтобы снова работать, попросите
          владельца вернуть доступ в Настройках → Сотрудники.
        </p>
        <LogoutButton />
      </section>
    </main>
  );
}
