import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mainAction, type BusinessType, type ModuleId } from "./business";

/**
 * «Первые шаги» на главной нового магазина (просьба пользователя 27.10.2026):
 * что сделать в первые дни, с кнопкой «куда нажать». Отметка «сделано» — по
 * данным магазина, не по нажатиям. Показываем первый месяц, пока не всё сделано.
 */
export type FirstStep = { id: string; title: string; text: string; href: string; button: string; done: boolean };

/** Сколько дней после открытия магазина показывать шаги. */
export const FIRST_STEPS_DAYS = 30;

export async function firstSteps(
  db: SupabaseClient,
  organizationId: string,
  business: BusinessType,
  modules: readonly ModuleId[],
  shopCreatedAt: string | null,
): Promise<FirstStep[] | null> {
  if (!shopCreatedAt || Date.now() - Date.parse(shopCreatedAt) > FIRST_STEPS_DAYS * 86_400_000) return null;
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const head = { count: "exact" as const, head: true };
  const rental = modules.includes("rental");
  const [customers, openings, sales, rentals, members, invites] = await Promise.all([
    count(db.from("customers").select("id", head).eq("organization_id", organizationId)),
    // Перенос тетради записывает старые долги начальными остатками.
    count(db.from("sales").select("id", head).eq("organization_id", organizationId).eq("is_opening", true)),
    count(db.from("sales").select("id", head).eq("organization_id", organizationId).eq("is_opening", false)),
    rental ? count(db.from("rentals").select("id", head).eq("organization_id", organizationId)) : Promise.resolve(0),
    count(db.from("organization_members").select("user_id", head).eq("organization_id", organizationId)),
    count(db.from("organization_invites").select("id", head).eq("organization_id", organizationId)),
  ]);
  const main = mainAction(business, modules);
  const steps: FirstStep[] = [
    {
      id: "customer",
      title: "Добавьте первого клиента",
      text: "Имя и телефон - по телефону потом напомните о долге в WhatsApp.",
      href: "/customers/new",
      button: "Добавить клиента",
      done: customers > 0,
    },
    {
      id: "notebook",
      title: "Перенесите тетрадь по фото",
      text: "Сфотографируйте страницу тетради - Depter сам запишет, кто сколько должен.",
      href: "/import",
      button: "Перенести тетрадь",
      done: openings > 0,
    },
    {
      id: "record",
      title: rental ? "Выдайте первую вещь" : "Запишите первую продажу",
      text: rental
        ? "Клиент, вещи, на сколько дней и залог - Depter напомнит, когда вернуть."
        : "В долг или за наличные - долг клиента посчитается сам, накладную можно отправить в WhatsApp.",
      href: main.href,
      button: main.label,
      done: sales > 0 || rentals > 0,
    },
    {
      id: "seller",
      title: "Пригласите продавца",
      text: "Если за прилавком не только вы: у продавца будет свой вход, а вы увидите, кто что записал.",
      href: "/settings#staff",
      button: "Пригласить",
      done: members > 1 || invites > 0,
    },
  ];
  return steps.every((s) => s.done) ? null : steps;
}
