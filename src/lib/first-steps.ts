import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mainAction, type BusinessType, type ModuleId } from "./business";
import { isNewShop } from "./new-shop";
import { money } from "./format";
import type { IconName } from "@/components/action-icon";
import type { ExampleRow } from "@/components/teach";

/**
 * «Первые шаги» на главной нового магазина (просьба пользователя 27.10.2026):
 * что сделать в первые дни, с кнопкой «куда нажать». Отметка «сделано» — по
 * данным магазина, не по нажатиям. Показываем первый месяц, пока не всё сделано.
 * Нажатие на шаг — сначала объяснение (FeatureSheet): шаги с настоящими
 * названиями кнопок и бледный пример, потом кнопка туда же, что и раньше.
 */
export type FirstStep = {
  id: string;
  title: string;
  text: string;
  /** Куда нажимать — по порядку, словами с экрана. */
  steps: string[];
  /** Бледный пример, как это будет выглядеть. */
  rows: ExampleRow[];
  href: string;
  button: string;
  icon: IconName;
  done: boolean;
};

export async function firstSteps(
  db: SupabaseClient,
  organizationId: string,
  business: BusinessType,
  modules: readonly ModuleId[],
  shopCreatedAt: string | null,
  currency: string,
): Promise<FirstStep[] | null> {
  if (!isNewShop(shopCreatedAt)) return null;
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const head = { count: "exact" as const, head: true };
  const rental = modules.includes("rental");
  const [customers, openings, sales, rentals, closures] = await Promise.all([
    count(db.from("customers").select("id", head).eq("organization_id", organizationId)),
    // Перенос тетради записывает старые долги начальными остатками.
    count(db.from("sales").select("id", head).eq("organization_id", organizationId).eq("is_opening", true)),
    count(db.from("sales").select("id", head).eq("organization_id", organizationId).eq("is_opening", false)),
    rental ? count(db.from("rentals").select("id", head).eq("organization_id", organizationId)) : Promise.resolve(0),
    count(db.from("day_closures").select("day", head).eq("organization_id", organizationId)),
  ]);
  const main = mainAction(business, modules);
  const sum = (n: number) => money(n, currency);
  const steps: FirstStep[] = [
    {
      id: "customer",
      title: "Добавьте первого клиента",
      text: "Имя и телефон - по телефону потом напомните о долге в WhatsApp.",
      steps: [
        "Впишите имя и телефон клиента",
        "Нажмите «Добавить» - клиент появится в «Клиентах»",
        "Продадите ему в долг - долг запишется сам",
      ],
      rows: [
        { name: "Айгуль", note: "+996 555 12-34-56", value: sum(12500) },
        { name: "Нурлан", note: "+996 700 98-76-54", value: sum(3200) },
      ],
      href: "/customers/new",
      button: "Добавить клиента",
      icon: "cash-in",
      done: customers > 0,
    },
    {
      id: "notebook",
      title: "Перенесите тетрадь по фото",
      text: "Сфотографируйте страницу тетради - Depter сам запишет, кто сколько должен.",
      steps: [
        "Нажмите «Фото страниц тетради» и сфотографируйте страницу",
        "Проверьте, что прочитал Depter, и поправьте, если нужно",
        "Нажмите «Сохранить долги» - клиенты и долги появятся в списке",
      ],
      rows: [
        { name: "Айгуль", note: "из тетради", value: sum(12500) },
        { name: "Нурлан", note: "из тетради", value: sum(3200) },
      ],
      href: "/import",
      button: "Перенести тетрадь",
      icon: "camera",
      done: openings > 0,
    },
    {
      id: "record",
      title: rental ? "Выдайте первую вещь" : "Запишите первую продажу",
      text: rental
        ? "Клиент, вещи, на сколько дней и залог - Depter напомнит, когда вернуть."
        : "В долг или за наличные - долг клиента посчитается сам, накладную можно отправить в WhatsApp.",
      steps: rental
        ? [
            "Выберите клиента",
            "Отметьте вещи, на сколько дней и залог",
            "Нажмите «Выдать» - Depter запомнит, когда вернуть",
          ]
        : [
            "Выберите клиента",
            "Впишите сумму или выберите товары",
            "Нажмите «Записать» - долг посчитается сам, накладную можно отправить в WhatsApp",
          ],
      rows: rental
        ? [{ name: "Айгуль", note: "Платье вечернее, M · вернуть до 2 ноября", value: `залог ${sum(2000)}` }]
        : [
            { name: "Продажа в долг · Айгуль", note: "Сахар 1 кг × 10, Масло 1 л × 2", value: sum(1310) },
            { name: "Долг Айгуль теперь", value: sum(13810) },
          ],
      href: main.href,
      button: main.label,
      icon: main.icon,
      done: sales > 0 || rentals > 0,
    },
    {
      id: "day",
      title: "Подведите итог дня",
      text: "Вечером: сколько продали, сколько денег пришло и сколько наличных должно быть в кассе. Сошлось - нажмите «Закрыть день».",
      steps: [
        "Вечером откройте «Итог дня»",
        "Сверьте «В кассе по записям» с наличными в кассе",
        "Сошлось - нажмите «Закрыть день»",
      ],
      rows: [
        { name: "Продано", value: sum(12400) },
        { name: "Пришло наличными", value: sum(8000) },
        { name: "В кассе по записям", value: sum(6500) },
      ],
      href: "/day",
      button: "Открыть итог дня",
      icon: "chart",
      done: closures > 0,
    },
  ];
  return steps.every((s) => s.done) ? null : steps;
}
