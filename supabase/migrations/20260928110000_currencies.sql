-- Валюты (ТЗ §6, §15.2, §14.3; решения пользователя 28.09.2026):
--  - у магазина базовая валюта (сом — Джалал-Абад, рубль — Москва);
--  - у клиента/поставщика — валюта расчётов (null = валюта магазина);
--    долг ведётся в ней: sales.total / purchases.total / payments.amount —
--    всегда в валюте контрагента, как раньше, поэтому балансы, давность,
--    акт сверки и отмена считают без изменений;
--  - запись в другой валюте (оплата Хорозу в сомах, долларовая накладная
--    клиенту в сомах) пересчитывается при записи по курсу: исходная сумма,
--    её валюта и курс хранятся рядом (original_amount, original_currency,
--    fx_rate), пересчитанная — в total/amount;
--  - сменить валюту магазина или контрагента можно, только пока у него нет
--    записей; объединить можно только контрагентов с одной валютой.
-- Существующие данные не меняются: магазины — KGS, контрагенты — null
-- (валюта магазина), у записей новые поля null.
begin;

-- Колонка есть с foundation.sql (только KGS) — расширяем список.
alter table public.organizations drop constraint organizations_currency_check;
alter table public.organizations add constraint organizations_currency_check
  check (currency in ('KGS','USD','RUB'));
grant update (currency) on public.organizations to authenticated;

alter table public.customers add column currency text check (currency in ('KGS','USD','RUB'));
alter table public.suppliers add column currency text check (currency in ('KGS','USD','RUB'));
grant update (currency) on public.customers to authenticated;
grant update (currency) on public.suppliers to authenticated;

do $$
declare t text;
begin
  foreach t in array array['sales','purchases','payments'] loop
    execute format($f$
      alter table public.%I
        add column original_amount numeric(16,2) check (original_amount > 0 and original_amount < 1e14),
        add column original_currency text check (original_currency in ('KGS','USD','RUB')),
        add column fx_rate numeric(18,6) check (fx_rate > 0 and fx_rate < 1e12),
        add constraint %I check (
          (original_amount is null) = (original_currency is null)
          and (original_amount is null) = (fx_rate is null)
        )
    $f$, t, t || '_original_complete');
  end loop;
end
$$;

-- Валюта долга контрагента: своя или магазина.
create function private.party_currency(p_org uuid, p_kind text, p_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce(
    case when p_kind='customers'
      then (select currency from public.customers where organization_id=p_org and id=p_id)
      else (select currency from public.suppliers where organization_id=p_org and id=p_id) end,
    (select currency from public.organizations where id=p_org)
  );
$$;
revoke all on function private.party_currency(uuid,text,uuid) from public, anon, authenticated;

-- Валюту не меняют задним числом: записи уже посчитаны в ней.
create function private.reject_currency_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.currency is not distinct from old.currency then return new; end if;
  if tg_table_name='organizations' then
    if exists(select 1 from public.sales where organization_id=old.id)
      or exists(select 1 from public.purchases where organization_id=old.id)
      or exists(select 1 from public.payments where organization_id=old.id)
    then raise exception 'currency_locked'; end if;
  elsif private.party_has_records(old.organization_id, tg_table_name, old.id) then
    raise exception 'currency_locked';
  end if;
  return new;
end
$$;
create trigger organizations_currency_locked before update of currency on public.organizations
  for each row execute function private.reject_currency_change();
create trigger customers_currency_locked before update of currency on public.customers
  for each row execute function private.reject_currency_change();
create trigger suppliers_currency_locked before update of currency on public.suppliers
  for each row execute function private.reject_currency_change();

-- Объединение (merge_party) переносит записи на другого контрагента —
-- только в той же валюте, иначе суммы потеряют смысл.
create function private.reject_currency_move() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.customer_id is distinct from old.customer_id and new.customer_id is not null
    and private.party_currency(new.organization_id,'customers',new.customer_id)
      is distinct from private.party_currency(old.organization_id,'customers',old.customer_id)
  then raise exception 'currency_mismatch'; end if;
  return new;
end
$$;
create function private.reject_supplier_currency_move() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.supplier_id is distinct from old.supplier_id and new.supplier_id is not null
    and private.party_currency(new.organization_id,'suppliers',new.supplier_id)
      is distinct from private.party_currency(old.organization_id,'suppliers',old.supplier_id)
  then raise exception 'currency_mismatch'; end if;
  return new;
end
$$;
create trigger sales_currency_move before update of customer_id on public.sales
  for each row execute function private.reject_currency_move();
create trigger purchases_currency_move before update of supplier_id on public.purchases
  for each row execute function private.reject_supplier_currency_move();
create trigger payments_customer_currency_move before update of customer_id on public.payments
  for each row execute function private.reject_currency_move();
create trigger payments_supplier_currency_move before update of supplier_id on public.payments
  for each row execute function private.reject_supplier_currency_move();

-- Пересчёт в валюту контрагента; null — запись в валюте контрагента.
-- Курс — как его называют люди: сколько более слабой валюты за одну более
-- сильную (1 $ = 87,80 сом, 1 $ = 85 ₽, 1 ₽ = 1,03 сом). Сильная → слабая —
-- умножаем, слабая → сильная — делим: оплата Хорозу 4 900 645 сом по 87,80 =
-- 55 816,00 $ без потери точности на курсе вида 0,011390.
create function private.currency_rank(p_currency text) returns int
language sql immutable set search_path='' as $$
  select case p_currency when 'USD' then 3 when 'RUB' then 2 when 'KGS' then 1 end;
$$;
revoke all on function private.currency_rank(text) from public, anon, authenticated;

create function private.converted_amount(
  p_party_currency text, p_original_amount text, p_original_currency text, p_fx_rate text
) returns numeric
language plpgsql immutable set search_path='' as $$
declare v numeric;
begin
  if p_original_currency is null and p_original_amount is null and p_fx_rate is null then return null; end if;
  if p_original_currency not in ('KGS','USD','RUB') or p_original_currency = p_party_currency
    or coalesce(p_original_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or coalesce(p_fx_rate,'') !~ '^[0-9]{1,11}(\.[0-9]{1,6})?$'
    or p_fx_rate::numeric <= 0 or p_original_amount::numeric <= 0
  then raise exception 'invalid_currency'; end if;
  v := round(
    case when private.currency_rank(p_original_currency) > private.currency_rank(p_party_currency)
      then p_original_amount::numeric * p_fx_rate::numeric
      else p_original_amount::numeric / p_fx_rate::numeric end, 2);
  if v <= 0 or v >= 100000000000000 then raise exception 'invalid_currency'; end if;
  return v;
end
$$;
revoke all on function private.converted_amount(text,text,text,text) from public, anon, authenticated;

-- Балансы раскрывают c.* при создании — пересоздаём, чтобы в них была
-- currency (тела как в party_archive_merge.sql).
drop view public.customer_balances;
create view public.customer_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total) from public.sales s
       where s.organization_id=c.organization_id and s.customer_id=c.id
         and s.status='posted' and not s.paid_immediately and s.reversed_at is null
     ),0)::numeric(16,2)
     - coalesce((
       select sum(p.amount) from public.payments p
       where p.organization_id=c.organization_id and p.customer_id=c.id
         and p.status='confirmed' and p.reversed_at is null
     ),0)::numeric(16,2)
   )::text as balance
 from public.customers c;
drop view public.supplier_balances;
create view public.supplier_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total) from public.purchases s
       where s.organization_id=c.organization_id and s.supplier_id=c.id
         and s.status='posted' and s.reversed_at is null
     ),0)::numeric(16,2)
     - coalesce((
       select sum(p.amount) from public.payments p
       where p.organization_id=c.organization_id and p.supplier_id=c.id
         and p.status='confirmed' and p.reversed_at is null
     ),0)::numeric(16,2)
   )::text as balance
 from public.suppliers c;
revoke all on public.customer_balances, public.supplier_balances from anon, authenticated;
grant select on public.customer_balances, public.supplier_balances to authenticated;

-- Записи с пересчётом. Тела — как в debt_ledger.sql / payment_occurred_at.sql;
-- p_amount — сумма в валюте контрагента; если задана исходная валюта,
-- сумма считается на сервере (p_amount не используется). Без исходной
-- валюты хеш идемпотентности прежний.
drop function public.commit_purchase(uuid,uuid,text,uuid,uuid);
create function public.commit_purchase(
  p_org uuid, p_supplier uuid, p_amount text, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_purchase uuid; v_amount numeric;
  v_converted numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_supplier is null
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
  then raise exception 'invalid_purchase'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_supplier)
  then raise exception 'invalid_supplier'; end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org,'suppliers',p_supplier), p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_purchase'; end if;
    v_amount:=p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_purchase'; end if;

  v_hash:=md5((jsonb_build_object('supplier_id',p_supplier,'amount',v_amount::text,'document',p_document)
    || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',trim_scale(p_original_amount::numeric)::text,'original_currency',p_original_currency,
      'fx_rate',trim_scale(p_fx_rate::numeric)::text) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.purchases where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents
    where organization_id=p_org and id=p_document and kind='purchase'
  ) then raise exception 'invalid_document'; end if;

  insert into public.purchases(
    organization_id,supplier_id,status,total,document_id,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate
  ) values(p_org,p_supplier,'posted',v_amount,p_document,p_idempotency_key,v_hash,
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end)
  returning id into v_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,jsonb_build_object('total',v_amount::text));
  return v_purchase;
end
$$;
revoke all on function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text) to authenticated;

drop function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid);
create function public.commit_sale(
  p_org uuid, p_customer uuid, p_amount text, p_paid_immediately boolean, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_sale uuid; v_amount numeric;
  v_converted numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_customer is null or p_paid_immediately is null
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
  then raise exception 'invalid_sale'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer)
  then raise exception 'invalid_customer'; end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org,'customers',p_customer), p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_sale'; end if;
    v_amount:=p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_sale'; end if;

  v_hash:=md5((jsonb_build_object(
    'customer_id',p_customer,'amount',v_amount::text,
    'paid_immediately',p_paid_immediately,'document',p_document
  ) || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',trim_scale(p_original_amount::numeric)::text,'original_currency',p_original_currency,
      'fx_rate',trim_scale(p_fx_rate::numeric)::text) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.sales where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='sale'
  ) then raise exception 'invalid_document'; end if;

  insert into public.sales(
    organization_id,customer_id,status,total,paid_immediately,document_id,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate
  ) values(p_org,p_customer,'posted',v_amount,p_paid_immediately,p_document,p_idempotency_key,v_hash,
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end)
  returning id into v_sale;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'sale.posted',v_sale,
    jsonb_build_object('total',v_amount::text,'paid_immediately',p_paid_immediately));
  return v_sale;
end
$$;
revoke all on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text) to authenticated;

drop function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz);
create function public.commit_payment(
  p_org uuid, p_direction text, p_party uuid, p_amount text, p_bank_reference text, p_idempotency_key uuid,
  p_document uuid default null, p_occurred_at timestamptz default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_payment uuid; v_amount numeric;
  v_customer uuid; v_supplier uuid; v_converted numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_party is null
    or p_direction not in ('incoming','outgoing')
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
    or (p_bank_reference is not null and (
      length(trim(p_bank_reference))>200 or trim(p_bank_reference)=''
    ))
  then raise exception 'invalid_payment'; end if;
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  if p_direction='incoming' then
    if not exists(select 1 from public.customers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_customer:=p_party;
  else
    if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_supplier:=p_party;
  end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org, case when p_direction='incoming' then 'customers' else 'suppliers' end, p_party),
    p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_payment'; end if;
    v_amount:=p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;

  -- Без даты и без исходной валюты хеш прежний.
  v_hash:=md5((jsonb_build_object(
    'direction',p_direction,'party',p_party,'amount',v_amount::text,
    'bank_reference',p_bank_reference,'document',p_document
  ) || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end
    || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',trim_scale(p_original_amount::numeric)::text,'original_currency',p_original_currency,
      'fx_rate',trim_scale(p_fx_rate::numeric)::text) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.payments where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='payment'
  ) then raise exception 'invalid_document'; end if;

  insert into public.payments(
    organization_id,customer_id,supplier_id,direction,amount,status,
    bank_reference,document_id,idempotency_key,request_hash,occurred_at,
    original_amount,original_currency,fx_rate
  ) values(
    p_org,v_customer,v_supplier,p_direction,v_amount,'confirmed',
    nullif(trim(p_bank_reference),''),p_document,p_idempotency_key,v_hash,
    coalesce(p_occurred_at, now()),
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end
  ) returning id into v_payment;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),
    case when p_direction='incoming' then 'payment.received' else 'payment.paid' end,
    v_payment,jsonb_build_object('amount',v_amount::text,'direction',p_direction));
  return v_payment;
end
$$;
revoke all on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz,text,text,text) from public,anon;
grant execute on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz,text,text,text) to authenticated;

-- Страница клиента по ссылке: валюта долга клиента (тело выписки не меняем —
-- private.get_statement_by_token_unchecked, см. platform_admin.sql).
create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_currency text;
begin
  select private.party_currency(l.organization_id,'customers',l.customer_id) into v_currency
  from public.share_links l where l.token=p_token and l.revoked_at is null;
  return private.get_statement_by_token_unchecked(p_token)
    || jsonb_build_object('currency', coalesce(v_currency,'KGS'));
end
$$;
create or replace function public.get_invoice_by_token(p_token text, p_sale uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_currency text;
begin
  select private.party_currency(l.organization_id,'customers',l.customer_id) into v_currency
  from public.share_links l where l.token=p_token and l.revoked_at is null;
  return private.get_invoice_by_token_unchecked(p_token, p_sale)
    || jsonb_build_object('currency', coalesce(v_currency,'KGS'));
end
$$;

commit;
