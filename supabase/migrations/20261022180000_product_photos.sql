-- Фото товара для каталога (просьба пользователя 22.10.2026): одно фото на
-- товар, снятое телефоном или выбранное из галереи в карточке товара.
--   products.photo_path — путь в хранилище product-photos (пусто — без фото);
--   set_product_photo   — поставить/убрать фото (участник магазина), путь
--                         только своего магазина и товара, в журнал;
--   get_catalog         — отдаёт и путь фото.
-- Хранилище product-photos — публичное на чтение: каталог открывается без
-- входа, а в пути — случайная часть, угадать нельзя. Загружать и удалять —
-- только участники магазина в папку своего магазина. Блок хранилища
-- выполняется только в настоящем Supabase (в тестовом PGlite его нет).
-- Новая колонка (пустая) и функции; данные не меняются.
begin;

alter table public.products add column photo_path text
  check (photo_path is null or length(photo_path) between 1 and 300);

create function public.set_product_photo(p_org uuid, p_product uuid, p_path text) returns text
language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  if p_path is not null and (
    p_path not like p_org::text || '/' || p_product::text || '/%' or p_path like '%..%' or length(p_path) > 300
  ) then raise exception 'invalid_photo'; end if;
  select photo_path into v_old from public.products
  where organization_id = p_org and id = p_product
  for update;
  if not found then raise exception 'invalid_product'; end if;
  update public.products set photo_path = p_path where organization_id = p_org and id = p_product;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), case when p_path is null then 'product.photo_removed' else 'product.photo_set' end,
    p_product, '{}'::jsonb);
  -- Прежний файл — приложение удалит из хранилища.
  return v_old;
end
$$;
revoke all on function public.set_product_photo(uuid,uuid,text) from public, anon;
grant execute on function public.set_product_photo(uuid,uuid,text) to authenticated;

create or replace function public.get_catalog(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'shop_name', o.name,
    'shop_phone', coalesce(nullif(o.phone, ''), nullif(o.seller_phone, ''), ''),
    'currency', coalesce(o.currency, 'KGS'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.sale_price::text,
          'photo', p.photo_path)
        order by lower(p.name))
      from public.products p
      where p.organization_id = l.organization_id and p.archived_at is null
        and not p.catalog_hidden and p.sale_price > 0
    ), '[]'::jsonb)
  )
  from public.catalog_links l
  join public.organizations o on o.id = l.organization_id
  where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null and o.blocked_at is null
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-photos', 'product-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;

    create policy "org members upload product photos" on storage.objects
      for insert to authenticated with check (
        bucket_id = 'product-photos'
        and private.is_member(((storage.foldername(name))[1])::uuid)
      );
    -- Удаление через API сначала читает объект — нужна и политика чтения.
    create policy "org members read product photos" on storage.objects
      for select to authenticated using (
        bucket_id = 'product-photos'
        and private.is_member(((storage.foldername(name))[1])::uuid)
      );
    create policy "org members delete product photos" on storage.objects
      for delete to authenticated using (
        bucket_id = 'product-photos'
        and private.is_member(((storage.foldername(name))[1])::uuid)
      );
  end if;
end
$$;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022180000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
