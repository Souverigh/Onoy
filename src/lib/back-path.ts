/**
 * Куда вернуться после действия — только карточка клиента/поставщика, чтобы
 * параметр `back` нельзя было использовать как открытый редирект.
 */
export function safeBackPath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return /^\/(customers|suppliers)\/[a-f0-9-]{36}$/i.test(raw) ? raw : null;
}
