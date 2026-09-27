-- Скидка в накладной («Скидка -200») — отдельная строка с отрицательной
-- ценой: без неё итог по строкам не сходится с бумагой, а check price >= 0
-- ронял сохранение всей накладной. Количество по-прежнему > 0 (знак — в
-- цене). Ограничение только ослабляется, существующие строки не меняются.
begin;

alter table public.document_lines drop constraint document_lines_price_check;
alter table public.document_lines add constraint document_lines_price_check
  check (price > -1e14 and price < 1e14);

commit;
