-- Страница клиента по ссылке (задачи 2 и 21): отклонённая заявка — «Заявка
-- отклонена: причина», а не «Оплата»; отменённых записей и внутренних
-- заметок (комментарий скидки) клиент не видит. Обёртка над
-- get_statement_by_token — та же проверка ссылки и блокировки магазина.
-- Только новая функция, данные не меняются.
begin;

create function public.get_client_page_by_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_org uuid; v_customer uuid;
begin
  v_result := public.get_statement_by_token(p_token);
  select l.organization_id, l.customer_id into v_org, v_customer
  from public.share_links l where l.token=p_token and l.revoked_at is null;
  return jsonb_set(v_result, '{entries}', (
    select coalesce(jsonb_agg(
      (e - 'note')
      || case when e->>'kind'='payment' and e->>'status'='rejected' then jsonb_build_object(
           'reject_comment', (
             select p.reject_comment from public.payments p
             where p.organization_id=v_org and p.customer_id=v_customer and p.id=(e->>'id')::uuid))
         else '{}'::jsonb end
      order by i), '[]'::jsonb)
    from jsonb_array_elements(v_result->'entries') with ordinality as t(e, i)
    where not coalesce((e->>'reversed')::boolean, false)
  ));
end
$$;
revoke all on function public.get_client_page_by_token(text) from public;
grant execute on function public.get_client_page_by_token(text) to anon, authenticated;

commit;
