-- Как магазин называют на документах (ТЗ §15.5 P1 «Свой магазин на
-- документе»): «Маликнур», «D MALIKNUR SATAROV» и т.п. По ним распознавание
-- понимает, какая сторона накладной — наш магазин: продавец → продажа,
-- покупатель → приход, а контрагент — другая сторона. Название магазина
-- (organizations.name) учитывается всегда, здесь — дополнительные варианты.
-- Существующие магазины получают пустой список, данные не меняются.
begin;

alter table public.organizations add column document_names text[] not null default '{}'
  check (cardinality(document_names) <= 20);
grant update (document_names) on public.organizations to authenticated;

commit;
