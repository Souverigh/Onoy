/** Ошибки «Сделать продажу» / «Убрать» — для списка и страницы заказа. */
export const ORDER_ERRORS: Record<string, string> = {
  handled: "Этот заказ уже продан или убран - список обновлён.",
  progress:
    "Продажу по этому заказу уже начал другой продавец и ещё не записал. Попросите его записать или удалить черновик. Если черновик забыт - «Убрать» заказ и сразу «Вернуть».",
  products: "Товаров из заказа уже нет на складе. Сделайте продажу вручную.",
  customer: "Не получилось создать клиента. Попробуйте ещё раз или выберите клиента в форме.",
  drafts: "Слишком много черновиков. Запишите или удалите старые в «Продажах».",
  save: "Не получилось сохранить. Попробуйте ещё раз.",
};

export const orderDateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(
    new Date(value),
  );

export const qtyText = (value: string) => String(Number(value)).replace(".", ",");

/** «1 товар», «3 товара», «5 товаров». */
export function goodsCount(n: number) {
  const tens = n % 100;
  const ones = n % 10;
  const word = tens >= 11 && tens <= 14 ? "товаров" : ones === 1 ? "товар" : ones >= 2 && ones <= 4 ? "товара" : "товаров";
  return `${n} ${word}`;
}
