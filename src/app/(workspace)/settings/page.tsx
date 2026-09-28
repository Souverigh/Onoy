import { headers } from "next/headers";
import { LogoutButton } from "@/components/logout-button";
import { getContext } from "@/lib/context";
import { StaffPanel, type Invite, type Member } from "@/components/staff-panel";
import { Submit } from "@/components/submit";
import { updateShop } from "./actions";
import { EXPORT_TABLES } from "@/lib/export-data";

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; staff?: string }>;
}) {
  const { db, organizationId, organizationName, user, isOwner, plan, paidUntil } = await getContext();
  const { saved, error, staff } = await searchParams;
  // Сотрудники и приглашения — только владельцу (RLS тоже не отдаст продавцу).
  let members: Member[] = [];
  let invites: Invite[] = [];
  let origin = "";
  if (isOwner) {
    const [m, i] = await Promise.all([
      db
        .from("organization_members")
        .select("user_id,role,display_name,email")
        .eq("organization_id", organizationId)
        .order("created_at"),
      db
        .from("organization_invites")
        .select("id,token,display_name,expires_at")
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
    ]);
    members = (m.data ?? []) as Member[];
    invites = (i.data ?? []) as Invite[];
    const h = await headers();
    origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  }
  const org = await db
    .from("organizations")
    .select("phone,block_duplicate_photos,document_names")
    .eq("id", organizationId)
    .maybeSingle();

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Настройки</h1>
          <p className="muted">Ваш рабочий кабинет.</p>
        </div>
      </div>
      {saved && (
        <p className="notice success" role="status">
          Сохранено.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          Не удалось сохранить. Проверьте название, телефон и названия в накладных (до 20 строк).
        </p>
      )}
      <section className="panel form-panel">
        <form action={updateShop} className="entry-form">
          <label>
            Название магазина
            <input name="name" required maxLength={120} defaultValue={organizationName} />
          </label>
          <label>
            Телефон магазина (для WhatsApp клиентам)
            <input
              name="phone"
              type="tel"
              maxLength={40}
              placeholder="+996 700 000000"
              defaultValue={org.data?.phone ?? ""}
            />
          </label>
          <label>
            Как ваш магазин написан в накладных (необязательно)
            <textarea
              name="document_names"
              rows={3}
              placeholder={"Маликнур\nD MALIKNUR SATAROV"}
              defaultValue={((org.data?.document_names as string[] | null) ?? []).join("\n")}
            />
            <small className="muted">
              По строке на вариант — как на печати, в шапке или от руки. По ним приложение
              понимает, продажа это или приход, и не путает ваш магазин с клиентом.
            </small>
          </label>
          <label className="cash-toggle">
            <input
              type="checkbox"
              name="block_duplicate_photos"
              defaultChecked={org.data?.block_duplicate_photos ?? true}
            />
            Не принимать одно фото накладной дважды
          </label>
          <p className="muted">
            Если выключить — запись с уже использованным фото сохранится, но
            приложение предупредит о дубликате.
          </p>
          <div className="actions">
            <Submit>Сохранить</Submit>
          </div>
        </form>
      </section>
      {isOwner && (
        <StaffPanel
          members={members}
          invites={invites}
          origin={origin}
          shopName={organizationName}
          currentUserId={user.id}
          status={staff}
          businessPlan={plan === "business"}
        />
      )}
      {isOwner && (
      <section className="panel export-panel">
        <h2>Выгрузка в Excel</h2>
        <p className="muted">
          Все записи магазина, включая отменённые (с пометкой). Даты — по Бишкеку, суммы — числами.
        </p>
        <a className="button primary" href="/export">
          Скачать всю базу
        </a>
        <div className="export-tables">
          {Object.entries(EXPORT_TABLES).map(([key, label]) => (
            <a key={key} className="text-button" href={`/export?table=${key}`}>
              {label}
            </a>
          ))}
        </div>
      </section>
      )}
      <section className="panel">
        <dl className="details">
          <dt>Пользователь</dt>
          <dd>{user.email}</dd>
          <dt>Тариф</dt>
          <dd>
            {plan === "business" ? "Бизнес" : "Базовый"}
            {paidUntil
              ? ` · оплачено до ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${paidUntil}T12:00:00+06:00`))}`
              : ""}
          </dd>
          <dt>Валюта</dt>
          <dd>Кыргызский сом (KGS)</dd>
          <dt>Часовой пояс</dt>
          <dd>Бишкек (UTC+6)</dd>
          <dt>Версия</dt>
          <dd>0.3 · Долги, фото-основание, отмена записей, заявки, ссылка клиента</dd>
        </dl>
        <LogoutButton />
      </section>
    </>
  );
}
