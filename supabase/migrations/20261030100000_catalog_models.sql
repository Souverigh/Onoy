-- Каталог клиента: размеры одной модели — одной карточкой с выбором размера
-- (модуль «variants», миграция 20261029100000). get_catalog отдаёт у товара
-- его модель и размер/цвет, а список моделей — их название и порядок
-- размеров. Всё остальное в ответе — как было (20261023100000).
-- Только пересоздаётся функция; таблицы и данные не меняются.
begin;

create or replace function public.get_catalog(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
  with shop as (
    select l.organization_id, o.name, o.phone, o.seller_phone, o.currency
    from public.catalog_links l
    join public.organizations o on o.id = l.organization_id
    where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null and o.blocked_at is null
  ), visible as (
    select p.* from public.products p, shop
    where p.organization_id = shop.organization_id and p.archived_at is null
      and not p.catalog_hidden and p.sale_price > 0
  )
  select jsonb_build_object(
    'shop_name', shop.name,
    'shop_phone', coalesce(nullif(shop.phone, ''), nullif(shop.seller_phone, ''), ''),
    'currency', coalesce(shop.currency, 'KGS'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'unit', v.unit, 'price', v.sale_price::text,
          'photo', v.photo_path, 'category', v.category_id, 'model', v.model_id, 'variant', v.variant_attrs)
        order by lower(v.name))
      from visible v
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent', c.parent_id) order by lower(c.name))
      from public.product_categories c
      where c.organization_id = shop.organization_id and (
        exists(select 1 from visible v where v.category_id = c.id)
        or exists(select 1 from visible v join public.product_categories s
                  on s.organization_id = c.organization_id and s.id = v.category_id where s.parent_id = c.id)
      )
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'axes', m.axes))
      from public.product_models m
      where m.organization_id = shop.organization_id
        and exists(select 1 from visible v where v.model_id = m.id)
    ), '[]'::jsonb)
  )
  from shop
$$;
revoke all on function public.get_catalog(text) from public;
grant execute on function public.get_catalog(text) to anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261030100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
