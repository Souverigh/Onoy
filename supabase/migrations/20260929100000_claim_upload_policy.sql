-- Фото квитанции к заявке «Я оплатил» по ссылке клиента не загружалось:
-- политика storage для anon проверяла токен подзапросом к share_links, а у
-- anon нет прав на эту таблицу (revoke all в debt_ledger.sql) →
-- «permission denied for table share_links». Проверка токена — через
-- security definer функцию; саму таблицу anon по-прежнему не видит.
begin;

create function public.claim_token_active(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
  select p_token is not null and length(p_token)=32 and exists(
    select 1 from public.share_links where token=p_token and revoked_at is null
  );
$$;
revoke all on function public.claim_token_active(text) from public, authenticated;
grant execute on function public.claim_token_active(text) to anon;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "clients upload claim receipts by token" on storage.objects;
    create policy "clients upload claim receipts by token" on storage.objects
      for insert to anon with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = 'claims'
        and public.claim_token_active((storage.foldername(name))[2])
      );
  end if;
end
$$;

commit;
