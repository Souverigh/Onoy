-- Скидка и возврат товара (ТЗ §5, adjustment: «только с комментарием»).
-- Хранятся в payments с kind='discount'|'return': уменьшают долг так же,
-- как оплата, поэтому балансы, давность долга, акт сверки и страница клиента
-- учитывают их без изменений. Живыми деньгами не считаются — «Собрано» и
-- «Оплачено поставщикам» берут только kind='payment'. Существующие строки
-- получают kind='payment' (default), данные не меняются.
begin;

alter table public.payments add column kind text not null default 'payment'
  check (kind in ('payment','discount','return'));
alter table public.payments add column note text check (note is null or length(note) <= 500);
alter table public.payments add constraint payments_adjustment_note
  check (kind = 'payment' or length(trim(coalesce(note,''))) > 0);

create function public.commit_adjustment(
  p_org uuid, p_direction text, p_party uuid, p_kind text, p_amount text, p_note text,
  p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_id uuid; v_amount numeric;
  v_customer uuid; v_supplier uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_party is null
    or p_direction not in ('incoming','outgoing')
    or p_kind not in ('discount','return')
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_adjustment'; end if;
  if length(trim(coalesce(p_note,''))) = 0 or length(p_note) > 500
  then raise exception 'invalid_note'; end if;
  v_amount := p_amount::numeric;
  if v_amount <= 0 or v_amount >= 100000000000000 then raise exception 'invalid_adjustment'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_hash := md5(jsonb_build_object(
    'direction',p_direction,'party',p_party,'kind',p_kind,'amount',v_amount::text,'note',trim(p_note)
  )::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.payments where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  if p_direction='incoming' then
    if not exists(select 1 from public.customers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_customer := p_party;
  else
    if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_supplier := p_party;
  end if;

  insert into public.payments(
    organization_id,customer_id,supplier_id,direction,amount,status,kind,note,
    idempotency_key,request_hash
  ) values(
    p_org,v_customer,v_supplier,p_direction,v_amount,'confirmed',p_kind,trim(p_note),
    p_idempotency_key,v_hash
  ) returning id into v_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'adjustment.'||p_kind,v_id,
    jsonb_build_object('amount',v_amount::text,'direction',p_direction,'note',left(trim(p_note),500)));
  return v_id;
end
$$;
revoke all on function public.commit_adjustment(uuid,text,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.commit_adjustment(uuid,text,uuid,text,text,text,uuid) to authenticated;

-- Страница клиента: у оплат — вид (оплата / скидка / возврат) и комментарий
-- скидки. Тело — как в promised_date_aging.sql.
create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_shop_name text; v_shop_phone text; v_balance text;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select l.*, c.name as customer_name, c.phone as customer_phone, c.promised_date
  into v_link
  from public.share_links l join public.customers c on c.organization_id=l.organization_id and c.id=l.customer_id
  where l.token=p_token and l.revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  select o.name, o.phone into v_shop_name, v_shop_phone from public.organizations o where o.id=v_link.organization_id;
  select balance into v_balance from public.customer_balances
  where organization_id=v_link.organization_id and id=v_link.customer_id;
  return jsonb_build_object(
    'shop_name', v_shop_name,
    'shop_phone', v_shop_phone,
    'customer_name', v_link.customer_name,
    'balance', coalesce(v_balance,'0'),
    'promised_date', v_link.promised_date,
    'entries', (
      select coalesce(jsonb_agg(entry order by entry->>'occurred_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('kind','sale','id',s.id,'amount',s.total::text,
          'occurred_at',s.occurred_at,'reversed',s.reversed_at is not null,'paid_immediately',s.paid_immediately,
          'opening',s.is_opening,
          'invoice', exists(
            select 1 from public.documents d
            where d.organization_id=s.organization_id and d.id=s.document_id and d.status='digitized'
          )) as entry
        from public.sales s where s.organization_id=v_link.organization_id and s.customer_id=v_link.customer_id and s.status='posted'
        union all
        select jsonb_build_object('kind','payment','id',id,'amount',amount::text,
          'occurred_at',occurred_at,'reversed',reversed_at is not null,'status',status,
          'opening',is_opening,'payment_kind',kind,'note',note) as entry
        from public.payments where organization_id=v_link.organization_id and customer_id=v_link.customer_id
      ) rows
    )
  );
end
$$;

commit;
