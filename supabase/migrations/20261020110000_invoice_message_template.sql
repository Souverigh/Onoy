-- Настройки → Магазин: свой текст сообщения клиенту о продаже (WhatsApp) с
-- подстановками {клиент}, {сумма} и т.д. (просьба пользователя 20.10.2026).
-- Пусто — стандартный текст. Только новая колонка; данные не трогаются.
begin;

alter table public.organizations
  add column invoice_message text check (invoice_message is null or length(invoice_message) <= 1000);

grant update (invoice_message) on public.organizations to authenticated;

commit;
