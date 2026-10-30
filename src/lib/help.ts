import type { ExampleRow } from "@/components/teach";
import { money } from "./format";
import { reminderMessage } from "./reminder";
import { PRICE_KGS } from "./subscription";

/**
 * «Помощь» в меню «Ещё» (просьба пользователя 30.10.2026): частые вопросы с
 * ответом словами с экрана, бледным примером и кнопкой туда, где это делают.
 * Новый вопрос — одна запись здесь. ownerOnly — продавцу не показываем
 * (настройки, подписка).
 */
export type HelpQuestion = {
  id: string;
  q: string;
  a: string;
  rows?: ExampleRow[];
  message?: string;
  button?: { label: string; href: string };
  ownerOnly?: boolean;
};

export function helpQuestions(shop: { currency: string; shopName: string; today: string; isOwner: boolean }): HelpQuestion[] {
  const sum = (n: number) => money(n, shop.currency);
  const list: HelpQuestion[] = [
    {
      id: "notebook",
      q: "Как записать старые долги из тетради?",
      a: "Откройте «Клиенты» и нажмите «Из тетради». Сфотографируйте страницу, проверьте, что прочитал Depter, и нажмите «Сохранить долги» - клиенты и их долги появятся в списке.",
      rows: [
        { name: "Айгуль", note: "из тетради", value: sum(12500) },
        { name: "Нурлан", note: "из тетради", value: sum(3200) },
      ],
      button: { label: "Перенести тетрадь", href: "/import" },
    },
    {
      id: "part",
      q: "Клиент заплатил часть долга - как записать?",
      a: "На главной нажмите «Клиент принёс деньги», выберите клиента и впишите, сколько он принёс. Долг уменьшится сам - остаток Depter посчитает.",
      rows: [
        { name: "Долг Айгуль был", value: sum(12500) },
        { name: "Принесла 30 октября", value: sum(5000) },
        { name: "Осталось", value: sum(7500) },
      ],
      button: { label: "Записать оплату", href: "/money/new?type=payment&direction=incoming" },
    },
    {
      id: "mistake",
      q: "Ошибся в записи - как исправить?",
      a: "Записи не стираются, а отменяются - так всегда видно, что было. Владелец открывает «Все записи», нажимает три точки у записи и «Отменить», потом записывает заново правильно. Продавец просит об этом владельца.",
      button: shop.isOwner ? { label: "Открыть все записи", href: "/money" } : undefined,
    },
    {
      id: "remind",
      q: "Как напомнить клиенту о долге?",
      a: "Откройте клиента в «Клиентах» и нажмите зелёный значок WhatsApp под суммой долга - откроется WhatsApp с готовым текстом. Кто обещал заплатить сегодня или давно должен, сам появляется на главной в «Кому напомнить сегодня».",
      rows: [{ name: "Айгуль", note: "долг", value: sum(12500) }],
      message: reminderMessage({
        shopName: shop.shopName,
        balance: 12500,
        currency: shop.currency,
        today: shop.today,
        link: "depter.kg/c/…",
      }),
      button: { label: "Открыть клиентов", href: "/customers" },
    },
    {
      id: "invoice",
      q: "Как отправить клиенту накладную?",
      a: "Сразу после записи продажи откроется экран с накладной - нажмите «Отправить клиенту в WhatsApp» и выберите чат клиента.",
      rows: [
        { name: "Сахар 1 кг × 10", value: sum(950) },
        { name: "Масло подсолнечное 1 л × 2", value: sum(360) },
        { name: "Итого · Айгуль", value: sum(1310) },
      ],
      button: { label: "Записать продажу", href: "/money/new?type=sale" },
    },
    {
      id: "client-link",
      q: "Видит ли клиент свой долг?",
      a: "Да, по своей ссылке. В карточке клиента в «Ссылка для клиента» нажмите «Создать ссылку» - потом она сама добавляется в напоминание. По ссылке клиент видит долг, историю и куда платить и может нажать «Я оплатил».",
      button: { label: "Открыть клиентов", href: "/customers" },
    },
    {
      id: "seller",
      q: "Как добавить продавца?",
      a: "В «Настройках» в «Сотрудники» впишите имя продавца и нажмите «Создать ссылку». Отправьте ссылку продавцу - он войдёт со своего телефона, а вы увидите, кто что записал.",
      button: { label: "Открыть сотрудников", href: "/settings#staff" },
      ownerOnly: true,
    },
    {
      id: "message",
      q: "Как изменить текст сообщения клиенту?",
      a: "В «Настройках» - «Сообщение клиенту». Этот текст уходит клиенту в WhatsApp после продажи.",
      button: { label: "Изменить текст", href: "/settings#message" },
      ownerOnly: true,
    },
    {
      id: "phone",
      q: "Потерял телефон - данные пропадут?",
      a: "Нет. Всё хранится в Depter, а не в телефоне. Войдите на другом телефоне так же, как раньше (через Google или почту и пароль) - все клиенты и долги на месте.",
    },
    {
      id: "price",
      q: "Сколько стоит Depter?",
      a: `Первый месяц бесплатно, дальше ${PRICE_KGS.toLocaleString("ru-RU")} сом в месяц. За неделю до конца оплаты на главной появится «Продлить» - откроется WhatsApp с готовым сообщением нам.`,
      ownerOnly: true,
    },
  ];
  return list.filter((h) => shop.isOwner || !h.ownerOnly);
}
