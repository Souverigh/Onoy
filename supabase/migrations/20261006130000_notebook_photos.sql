-- Фото страницы тетради при переносе долга: в истории клиента у записи
-- «Долг из тетради» — ссылка на фото, с которого её перенесли. Одна страница
-- тетради — много клиентов, поэтому не documents/document_id (там одна запись
-- на фото), а список путей в хранилище receipts: <магазин>/notebook/<uuid>.<ext>.
-- Новые nullable-колонки и пересоздание функции; данные не меняются.
begin;

alter table public.sales add column notebook_photos text[];
alter table public.purchases add column notebook_photos text[];
alter table public.payments add column notebook_photos text[];

drop function public.import_opening_balance(uuid,text,uuid,text,text,text,uuid,date);
create function public.import_opening_balance(
  p_org uuid, p_kind text, p_party uuid, p_name text, p_phone text, p_amount text,
  p_idempotency_key uuid, p_occurred_on date default null, p_photos text[] default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_party uuid; v_amount numeric; v_name text; v_phone text; v_hash text; v_existing_hash text;
  v_at timestamptz; v_photos text[];
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('customer','supplier') or p_idempotency_key is null
    or coalesce(p_amount,'') !~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_opening'; end if;
  v_amount := p_amount::numeric;
  -- Дата долга, написанная в тетради (задача 26): давность считается от неё.
  if p_occurred_on is not null and (
    p_occurred_on > (now() at time zone 'Asia/Bishkek')::date or p_occurred_on < date '2000-01-01'
  ) then raise exception 'invalid_opening'; end if;
  v_at := case when p_occurred_on is null then now()
               else (p_occurred_on + time '12:00') at time zone 'Asia/Bishkek' end;
  if v_at > now() then v_at := now(); end if;
  if v_amount=0 or abs(v_amount)>=100000000000000 then raise exception 'invalid_opening'; end if;
  -- Фото страниц тетради: только файлы этого магазина из папки notebook.
  v_photos := nullif(coalesce(p_photos,'{}'::text[]),'{}'::text[]);
  if v_photos is not null and (
    cardinality(v_photos) > 10
    or exists(select 1 from unnest(v_photos) as p(path)
      where p.path is null or p.path !~ ('^' || p_org::text || '/notebook/[0-9a-f-]{36}\.[a-z0-9]{1,10}$'))
  ) then raise exception 'invalid_opening'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_name := trim(coalesce(p_name,''));
  v_phone := left(trim(coalesce(p_phone,'')),40);
  v_hash := md5(jsonb_build_object('kind',p_kind,'party',p_party,'name',v_name,'amount',v_amount::text)::text);

  -- Повтор той же строки (тот же ключ) — возвращаем уже созданное.
  select request_hash, coalesce(customer_id, supplier_id) into v_existing_hash, v_party from (
    select request_hash, customer_id, null::uuid as supplier_id from public.sales
      where organization_id=p_org and idempotency_key=p_idempotency_key
    union all
    select request_hash, null, supplier_id from public.purchases
      where organization_id=p_org and idempotency_key=p_idempotency_key
    union all
    select request_hash, customer_id, supplier_id from public.payments
      where organization_id=p_org and idempotency_key=p_idempotency_key
  ) prior limit 1;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_party;
  end if;

  if p_party is not null then
    if p_kind='customer' then
      select id into v_party from public.customers where organization_id=p_org and id=p_party;
    else
      select id into v_party from public.suppliers where organization_id=p_org and id=p_party;
    end if;
    if v_party is null then raise exception 'invalid_party'; end if;
  else
    if length(v_name) not between 1 and 160 then raise exception 'invalid_opening'; end if;
    if p_kind='customer' then
      select id into v_party from public.customers
        where organization_id=p_org and lower(name)=lower(v_name) order by created_at limit 1;
      if v_party is null then
        insert into public.customers(organization_id,name,phone) values(p_org,v_name,v_phone)
        returning id into v_party;
      end if;
    else
      select id into v_party from public.suppliers
        where organization_id=p_org and lower(name)=lower(v_name) order by created_at limit 1;
      if v_party is null then
        insert into public.suppliers(organization_id,name,phone) values(p_org,v_name,v_phone)
        returning id into v_party;
      end if;
    end if;
  end if;

  if private.has_opening(p_org,p_kind,v_party) then raise exception 'opening_exists'; end if;

  if v_amount>0 and p_kind='customer' then
    insert into public.sales(organization_id,customer_id,status,total,paid_immediately,is_opening,idempotency_key,request_hash,occurred_at,notebook_photos)
    values(p_org,v_party,'posted',v_amount,false,true,p_idempotency_key,v_hash,v_at,v_photos);
  elsif v_amount>0 then
    insert into public.purchases(organization_id,supplier_id,status,total,is_opening,idempotency_key,request_hash,occurred_at,notebook_photos)
    values(p_org,v_party,'posted',v_amount,true,p_idempotency_key,v_hash,v_at,v_photos);
  else
    -- Аванс: контрагент заплатил больше, чем должен (или магазин переплатил поставщику).
    insert into public.payments(organization_id,customer_id,supplier_id,direction,amount,status,is_opening,idempotency_key,request_hash,occurred_at,notebook_photos)
    values(p_org,
      case when p_kind='customer' then v_party end,
      case when p_kind='supplier' then v_party end,
      case when p_kind='customer' then 'incoming' else 'outgoing' end,
      -v_amount,'confirmed',true,p_idempotency_key,v_hash,v_at,v_photos);
  end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'opening.imported',v_party,
    jsonb_build_object('kind',p_kind,'amount',v_amount::text)
      || case when p_occurred_on is null then '{}'::jsonb else jsonb_build_object('occurred_on',p_occurred_on) end
      || case when v_photos is null then '{}'::jsonb else jsonb_build_object('photos',cardinality(v_photos)) end);
  return v_party;
end
$$;
revoke all on function public.import_opening_balance(uuid,text,uuid,text,text,text,uuid,date,text[]) from public,anon;
grant execute on function public.import_opening_balance(uuid,text,uuid,text,text,text,uuid,date,text[]) to authenticated;

commit;
