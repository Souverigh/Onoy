-- Настройки → Магазин (задача 34): имя и телефон продавца для накладной,
-- адрес, реквизиты для оплаты (MBank / Optima / О!Деньги) и картинка QR
-- магазина; на накладной — «Долг после этой накладной» и QR на страницу
-- клиента, оба по умолчанию включены. Только новые колонки с default.
begin;

alter table public.organizations
  add column seller_name text not null default '' check (length(seller_name) <= 80),
  add column seller_phone text not null default '' check (length(seller_phone) <= 40),
  add column address text not null default '' check (length(address) <= 200),
  add column pay_mbank text not null default '' check (length(pay_mbank) <= 60),
  add column pay_optima text not null default '' check (length(pay_optima) <= 60),
  add column pay_odengi text not null default '' check (length(pay_odengi) <= 60),
  -- QR для оплаты — картинкой (data:image/…;base64), не больше ~300 КБ.
  add column pay_qr_image text check (
    pay_qr_image is null or (pay_qr_image ~ '^data:image/(png|jpeg|webp);base64,' and length(pay_qr_image) <= 400000)
  ),
  add column invoice_show_debt boolean not null default true,
  add column invoice_show_qr boolean not null default true;

grant update (seller_name, seller_phone, address, pay_mbank, pay_optima, pay_odengi, pay_qr_image,
  invoice_show_debt, invoice_show_qr) on public.organizations to authenticated;

-- Страница клиента по ссылке (задача 21): куда платить. Только реквизиты
-- магазина этой ссылки; отозванная ссылка — ничего.
create function public.get_shop_payment_by_token(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'shop_name', o.name,
    'shop_phone', o.phone,
    'address', o.address,
    'mbank', o.pay_mbank,
    'optima', o.pay_optima,
    'odengi', o.pay_odengi,
    'qr_image', o.pay_qr_image
  )
  from public.share_links l join public.organizations o on o.id=l.organization_id
  where p_token is not null and length(p_token)=32 and l.token=p_token and l.revoked_at is null
$$;
revoke all on function public.get_shop_payment_by_token(text) from public;
grant execute on function public.get_shop_payment_by_token(text) to anon, authenticated;

-- Отозванная ссылка (задача 22): магазин и его телефон, чтобы клиент мог
-- написать, — без долга и записей.
create function public.get_revoked_link_shop(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('shop_name', o.name, 'shop_phone', o.phone)
  from public.share_links l join public.organizations o on o.id=l.organization_id
  where p_token is not null and length(p_token)=32 and l.token=p_token and l.revoked_at is not null
  limit 1
$$;
revoke all on function public.get_revoked_link_shop(text) from public;
grant execute on function public.get_revoked_link_shop(text) to anon, authenticated;

commit;
