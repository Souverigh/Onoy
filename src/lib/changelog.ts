import type { ModuleId } from "./business";

/**
 * «Что нового» (просьба пользователя 25.10.2026): окно на главной после
 * обновления и раздел /news. Пишется для владельца и продавца магазина, не
 * для разработчиков: что стало можно и где это найти.
 *
 * Новая запись — сверху, с номером на 1 больше прежнего, вместе с самой
 * функцией (в том же коммите). ownerOnly — то, что продавец не видит
 * (настройки, отчёты); module — только магазинам, где модуль включён.
 */
export type NewsEntry = {
  /** Порядковый номер: по нему окно помнит, что человек уже видел. */
  n: number;
  /** День выкладки, ГГГГ-ММ-ДД. */
  date: string;
  title: string;
  text: string;
  /** Где посмотреть: адрес раздела и подпись кнопки. */
  link?: { href: string; label: string };
  ownerOnly?: boolean;
  module?: ModuleId;
};

export const CHANGELOG: readonly NewsEntry[] = [
  {
    n: 8,
    date: "2026-10-26",
    title: "Уведомления на телефон",
    text:
      "Новый заказ из каталога и «Я оплатил» от клиента теперь приходят уведомлением, даже когда Depter закрыт. Включите в Настройках на каждом телефоне. На iPhone - сначала добавьте Depter на экран «Домой».",
    link: { href: "/settings#notifications", label: "Включить уведомления" },
  },
  {
    n: 7,
    date: "2026-10-26",
    title: "Размеры и цвета для одежды и обуви",
    text:
      "Одна модель - все размеры и цвета, у каждого свой остаток. На складе модель одной строкой, при продаже размер выбирается кнопкой, в каталоге клиент сам выбирает размер.",
    link: { href: "/stock/model/new", label: "Добавить товар с размерами" },
    module: "variants",
  },
  {
    n: 6,
    date: "2026-10-26",
    title: "Depter под ваш вид бизнеса",
    text:
      "В Настройках выберите, чем вы занимаетесь: магазин, продукты, одежда, кафе, прокат. Под это подстроятся разделы меню, лишнее можно выключить.",
    link: { href: "/settings#business", label: "Открыть настройки" },
    ownerOnly: true,
  },
  {
    n: 5,
    date: "2026-10-25",
    title: "Заказы из каталога",
    text:
      "Клиент собирает список в каталоге и отправляет заказ - он приходит в раздел «Заказы». Нажмите «Сделать продажу», проверьте товары и запишите.",
    link: { href: "/orders", label: "Открыть заказы" },
    module: "catalog",
  },
  {
    n: 4,
    date: "2026-10-25",
    title: "Приход по фото находит товар по коду поставщика",
    text:
      "Если в накладной поставщика есть код товара, Depter найдёт по нему ваш товар. Не уверен - спросит, а не создаст новый.",
    module: "stock",
  },
  {
    n: 3,
    date: "2026-10-25",
    title: "Печать накладной с телефона",
    text: "Накладная печатается на обычный лист, в том числе с iPhone: «Печать» на странице продажи.",
  },
  {
    n: 2,
    date: "2026-10-23",
    title: "Категории товаров и фото в каталоге",
    text:
      "Товары можно разложить по категориям - Depter подскажет категорию по названию. В каталоге клиенты видят фото и выбирают категорию.",
    link: { href: "/stock/categories", label: "Категории" },
    module: "stock",
  },
  {
    n: 1,
    date: "2026-10-23",
    title: "Отбор «Кто вносил» в клиентах и поставщиках",
    text:
      "В списке клиентов и поставщиков можно оставить только тех, кому продажу или оплату записал выбранный продавец. Продавец видит «Мои записи».",
  },
];

/** Сколько дней назад показывать новому человеку (нет отметки «видел»). */
export const NEWS_FRESH_DAYS = 14;

/** Записи для этого человека: роль и включённые модули. */
export const newsFor = (entries: readonly NewsEntry[], isOwner: boolean, modules: readonly ModuleId[]) =>
  entries.filter((e) => (isOwner || !e.ownerOnly) && (!e.module || modules.includes(e.module)));

/**
 * Непрочитанное: новее того, что человек уже видел (seen — номер последней
 * записи). Не видел ничего — только свежее (за 14 дней) и не старше
 * магазина: новому магазину старые новости не показываем.
 */
export function unreadNews(
  entries: readonly NewsEntry[],
  seen: number | null,
  today: string,
  shopCreated: string | null,
): NewsEntry[] {
  if (seen !== null) return entries.filter((e) => e.n > seen);
  const fresh = new Date(`${today}T00:00:00Z`);
  fresh.setUTCDate(fresh.getUTCDate() - NEWS_FRESH_DAYS);
  const from = fresh.toISOString().slice(0, 10);
  const created = shopCreated?.slice(0, 10) ?? "";
  return entries.filter((e) => e.date >= from && e.date > created);
}

/** Номер самой новой записи — отметка «видел всё». */
export const newestNews = (entries: readonly NewsEntry[]) => entries.reduce((max, e) => Math.max(max, e.n), 0);
