/** Что показать в уведомлении: заголовок, текст, куда открыть и метка (одна на событие). */
export type PushMessage = { title: string; body: string; url: string; tag: string };

/** Ответ push_targets (миграция 20261031100000) без списка телефонов. */
export type PushFacts =
  | { kind: "order"; name: string; total: string; lines: number; currency: string }
  | { kind: "claim"; name: string; amount: string; currency: string };

const goods = (n: number) => {
  const mod10 = n % 10,
    mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "товар" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "товара" : "товаров";
  return `${n} ${word}`;
};

/** Деньги для текста: «4 500 сом» (на сервере — money из format.ts). */
export type Money = (amount: string, currency: string) => string;

/** Текст уведомления для продавца: кто, сколько и где посмотреть. */
export function pushMessage(facts: PushFacts, id: string, money: Money): PushMessage {
  if (facts.kind === "order")
    return {
      title: "Новый заказ из каталога",
      body: `${facts.name.trim() || "Клиент"} · ${goods(facts.lines)} · ${money(facts.total, facts.currency)}`,
      url: `/orders/${id}`,
      tag: `order-${id}`,
    };
  return {
    title: "Клиент оплатил - подтвердите",
    body: `${facts.name.trim() || "Клиент"}: ${money(facts.amount, facts.currency)}`,
    url: "/claims",
    tag: `claim-${id}`,
  };
}
