/**
 * Новый магазин (просьба пользователя 29.10.2026): первые 30 дней после
 * открытия на главной — «Первые шаги» и «Что умеет Depter», в пустых разделах —
 * пример, как они будут выглядеть, в меню «Ещё» — пояснения к разделам.
 */
export const NEW_SHOP_DAYS = 30;

export function isNewShop(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  return Date.now() - Date.parse(createdAt) <= NEW_SHOP_DAYS * 86_400_000;
}

/** Пояснение под разделом в меню «Ещё» нового магазина (ключ — адрес раздела). */
export const MENU_HINTS: Readonly<Record<string, string>> = {
  "/suppliers": "Кому вы должны и сколько",
  "/money": "Продажи, оплаты, расходы списком",
  "/stock": "Что есть и сколько осталось",
  "/rentals": "Что на руках и когда вернуть",
  "/claims": "Клиент сообщил, что заплатил",
  "/orders": "Заказы клиентов из каталога",
  "/documents": "Фото накладных и чеков",
  "/news": "Новое в приложении",
  "/settings": "Магазин, продавцы, куда платить",
};
