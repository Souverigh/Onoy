import type { IconName } from "@/components/icon";
import type { ExampleRow } from "@/components/teach";
import { mainAction, navLabel, word, type BusinessType, type ModuleId } from "./business";
import { money } from "./format";
import { reminderMessage } from "./reminder";

/**
 * «Что умеет Depter» (просьба пользователя 29.10.2026): карточки на /features
 * у нового магазина. Нажатие — объяснение снизу экрана: зачем, шаги с
 * настоящими названиями кнопок, бледный пример и кнопка туда, где это делают.
 * Карточки — под вид бизнеса: без модуля его карточки нет.
 */
export type Feature = {
  id: string;
  icon: IconName;
  title: string;
  /** Подпись на карточке. */
  short: string;
  text: string;
  steps: string[];
  rows: ExampleRow[];
  /** Пример сообщения клиенту под строками. */
  message?: string;
  button: { label: string; href: string };
};

export function features(shop: {
  business: BusinessType;
  modules: readonly ModuleId[];
  currency: string;
  shopName: string;
  today: string;
}): Feature[] {
  const { business, modules, currency } = shop;
  const sum = (n: number) => money(n, currency);
  const purchase = word(business, "purchase");
  const stock = modules.includes("stock");
  const list: (Feature | false)[] = [
    {
      id: "suppliers",
      icon: "truck",
      title: "Поставщики",
      short: "Кому должен магазин и сколько",
      text: "Взяли товар в долг - запишите, и Depter посчитает, сколько вы должны каждому поставщику.",
      steps: [
        `На главной нажмите «${purchase}»`,
        "Выберите поставщика и впишите сумму или сфотографируйте накладную",
        "Долг появится в «Поставщиках» и на главной в «Я должен»",
      ],
      rows: [
        { name: "Оптовка «Дордой»", note: "товар 28 октября", value: sum(45000) },
        { name: "Сут-Азия", note: "+996 555 65-43-21", value: sum(8300) },
      ],
      button: { label: "Открыть поставщиков", href: "/suppliers" },
    },
    {
      id: "remind",
      icon: "chat",
      title: "Напомнить о долге",
      short: "Клиент получит в WhatsApp, сколько должен",
      text: "Клиент получит в WhatsApp, сколько он должен. Текст с суммой Depter пишет сам.",
      steps: [
        "Откройте клиента в «Клиентах»",
        "Нажмите зелёный значок WhatsApp под суммой долга",
        "Откроется WhatsApp с готовым текстом и ссылкой - нажмите «Отправить»",
      ],
      rows: [{ name: "Айгуль", note: "долг", value: sum(12500) }],
      message: reminderMessage({
        shopName: shop.shopName,
        balance: 12500,
        currency,
        today: shop.today,
        link: "depter.kg/c/…",
      }),
      button: { label: "Открыть клиентов", href: "/customers" },
    },
    {
      id: "invoice",
      icon: "file",
      title: "Накладная клиенту",
      short: "После продажи - отправить в WhatsApp",
      text: "После продажи накладная с товарами и суммой уходит клиенту в WhatsApp.",
      steps: [
        "Запишите продажу",
        "Сразу после записи откроется экран с накладной",
        "Нажмите «Отправить клиенту» - накладная уйдёт в WhatsApp",
      ],
      rows: [
        { name: "Сахар 1 кг × 10", value: sum(950) },
        { name: "Масло подсолнечное 1 л × 2", value: sum(360) },
        { name: "Итого · Айгуль", value: sum(1310) },
      ],
      button: { label: "Записать продажу", href: "/money/new?type=sale" },
    },
    {
      id: "promise",
      icon: "calendar",
      title: "Срок оплаты",
      short: "Кто обещал заплатить - Depter напомнит",
      text: "Клиент обещал заплатить к определённому дню - запишите дату. В этот день он появится на главной в «Кому напомнить сегодня».",
      steps: [
        "Откройте клиента в «Клиентах»",
        "В «Срок оплаты» выберите день в «Обещал оплатить до»",
        "В этот день клиент будет на главной - напомните одной кнопкой",
      ],
      rows: [{ name: "Айгуль", note: "обещала оплатить до 5 ноября", value: sum(12500) }],
      button: { label: "Открыть клиентов", href: "/customers" },
    },
    {
      id: "notebook",
      icon: "camera",
      title: "Старые долги по фото",
      short: "Сфотографируйте тетрадь - долги перенесутся",
      text: "Не нужно переписывать тетрадь руками: Depter прочитает фото и запишет, кто сколько должен.",
      steps: [
        "Нажмите «Фото страниц тетради» и сфотографируйте страницу",
        "Проверьте, что прочитал Depter, и поправьте, если нужно",
        "Нажмите «Сохранить долги» - клиенты и долги появятся в списке",
      ],
      rows: [
        { name: "Айгуль", note: "из тетради", value: sum(12500) },
        { name: "Нурлан", note: "из тетради", value: sum(3200) },
      ],
      button: { label: "Перенести тетрадь", href: "/import" },
    },
    stock &&
      modules.includes("catalog") && {
        id: "catalog",
        icon: "cart",
        title: "Каталог",
        short: "Клиенты сами заказывают по ссылке",
        text: "Клиенты сами выбирают товары по ссылке, без звонков и переписки. Заказ приходит в «Заказы».",
        steps: [
          "Включите каталог и отправьте клиенту ссылку в WhatsApp",
          "Клиент отмечает товары и нажимает «Отправить заказ»",
          "Заказ появляется в «Заказах» - соберите его и сделайте продажу",
        ],
        rows: [
          { name: "Айгуль", note: "Сахар 10 кг, Масло 5 л", value: sum(2150) },
          { name: "Магазин «Береке»", note: "Мука 50 кг", value: sum(3800) },
        ],
        button: { label: "Включить каталог", href: "/stock/catalog" },
      },
    modules.includes("rental") && {
      id: "rental",
      icon: "calendar",
      title: navLabel(business, "/rentals", "Прокат"),
      short: "Что на руках и когда вернуть",
      text: "Выдали вещь на дни - Depter помнит, у кого она, до какого дня вернуть и какой залог.",
      steps: [
        `На главной нажмите «${mainAction(business, modules).label}»`,
        "Выберите клиента, вещи, на сколько дней и залог",
        "Когда вернут - отметьте возврат в «Прокате»",
      ],
      rows: [{ name: "Айгуль", note: "Платье вечернее, M · вернуть до 2 ноября", value: `залог ${sum(2000)}` }],
      button: { label: "Открыть прокат", href: "/rentals" },
    },
    stock && {
      id: "stock",
      icon: "box",
      title: navLabel(business, "/stock", "Склад"),
      short: "Что осталось и что заканчивается",
      text: "Получили товар - остаток прибавится, продали - убавится. Что заканчивается, Depter покажет сам.",
      steps: [
        "Добавьте товары по одному или загрузите из Excel",
        `Получили товар - «${purchase}», остаток прибавится`,
        "Продали - остаток убавится сам",
      ],
      rows: [
        { name: "Сахар 1 кг", note: `цена ${sum(95)}`, value: "24 шт" },
        { name: "Масло подсолнечное 1 л", note: "мало осталось", value: "3 шт" },
      ],
      button: { label: `Открыть «${navLabel(business, "/stock", "Склад")}»`, href: "/stock" },
    },
    {
      id: "pay",
      icon: "settings",
      title: "Куда платить",
      short: "Ваш номер для перевода - клиент увидит его по ссылке",
      text: "Впишите номер MBank, Optima, О!Деньги или QR из банка - клиент увидит их по ссылке из напоминания, в «Оплатить», и переведёт сам.",
      steps: [
        "Откройте Настройки → «Реквизиты для оплаты»",
        "Впишите номер или загрузите QR из банка",
        "Отправьте клиенту напоминание - реквизиты будут по ссылке",
      ],
      rows: [
        { name: "MBank", value: "0555 12-34-56" },
        { name: "О!Деньги", value: "0700 12-34-56" },
      ],
      button: { label: "Вписать номер", href: "/settings#pay" },
    },
  ];
  return list.filter((f): f is Feature => Boolean(f));
}
