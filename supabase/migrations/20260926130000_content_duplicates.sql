-- Похожие записи: та же накладная, сфотографированная заново (другой файл,
-- то же содержимое), или тот же контрагент с той же суммой за 30 дней.
-- Только предупреждение — запись не блокируется: постоянный клиент может
-- честно взять тот же набор товаров дважды.
--
-- Без перебора записей: отпечаток содержимого (sha256 от нормализованных
-- позиций и итога, считается в приложении — src/lib/adre/fingerprint.ts)
-- хранится на документе, поиск идёт по индексам — время не зависит от числа
-- записей магазина.
begin;

alter table public.documents
  add column content_fingerprint text
    check (content_fingerprint is null or content_fingerprint ~ '^[0-9a-f]{64}$');
create index documents_org_fingerprint_idx on public.documents(organization_id, content_fingerprint)
  where content_fingerprint is not null;
create index sales_org_customer_total_idx
  on public.sales(organization_id, customer_id, total, occurred_at desc);
create index purchases_org_supplier_total_idx
  on public.purchases(organization_id, supplier_id, total, occurred_at desc);

create function public.set_document_fingerprint(p_org uuid, p_document uuid, p_fingerprint text)
returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
  update public.documents set content_fingerprint=p_fingerprint
  where organization_id=p_org and id=p_document;
  if not found then raise exception 'invalid_document'; end if;
end
$$;

-- До трёх действующих (не сторнированных) записей, похожих на будущую.
-- p_document — фото будущей записи (совпадение по содержимому),
-- p_party + p_amount — контрагент и сумма (совпадение за 30 дней).
-- Любой из критериев можно не передавать.
create function public.find_similar_records(
  p_org uuid, p_kind text, p_document uuid, p_party uuid, p_amount text
) returns table(
  r_kind text, r_id uuid, r_occurred_at timestamptz, r_total numeric,
  r_party text, r_document uuid, r_reason text
)
language plpgsql stable security definer set search_path='' as $$
declare v_fp text; v_hash text; v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if p_kind not in ('purchase','sale') then raise exception 'invalid_kind'; end if;
  if p_document is not null then
    select d.content_fingerprint, d.file_hash into v_fp, v_hash
    from public.documents d where d.organization_id=p_org and d.id=p_document;
  end if;
  if coalesce(p_amount,'') ~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then v_amount := p_amount::numeric; end if;

  return query
  select u.kind, u.id, u.occurred_at, u.total, u.party, u.document_id, u.reason
  from (
  select distinct on (m.id) m.kind, m.id, m.occurred_at, m.total, m.party, m.document_id, m.reason
  from (
    -- Та же накладная: документы с тем же отпечатком (индекс по отпечатку),
    -- кроме того же файла фото — о нём предупреждает проверка фото.
    select 'sale'::text as kind, s.id, s.occurred_at, s.total, c.name as party,
      s.document_id, 'content'::text as reason, 0 as priority
    from public.documents d
    join public.sales s on s.organization_id=d.organization_id and s.document_id=d.id
    join public.customers c on c.organization_id=s.organization_id and c.id=s.customer_id
    where p_kind='sale' and v_fp is not null
      and d.organization_id=p_org and d.content_fingerprint=v_fp
      and d.id<>p_document and d.file_hash<>v_hash and s.reversed_at is null
    union all
    select 'purchase', p.id, p.occurred_at, p.total, sp.name,
      p.document_id, 'content', 0
    from public.documents d
    join public.purchases p on p.organization_id=d.organization_id and p.document_id=d.id
    join public.suppliers sp on sp.organization_id=p.organization_id and sp.id=p.supplier_id
    where p_kind='purchase' and v_fp is not null
      and d.organization_id=p_org and d.content_fingerprint=v_fp
      and d.id<>p_document and d.file_hash<>v_hash and p.reversed_at is null
    union all
    -- Тот же контрагент и та же сумма за 30 дней (индекс контрагент+сумма).
    select 'sale', s.id, s.occurred_at, s.total, c.name,
      s.document_id, 'party_amount', 1
    from public.sales s
    join public.customers c on c.organization_id=s.organization_id and c.id=s.customer_id
    where p_kind='sale' and p_party is not null and v_amount is not null
      and s.organization_id=p_org and s.customer_id=p_party and s.total=v_amount
      and s.occurred_at > now() - interval '30 days' and s.reversed_at is null
    union all
    select 'purchase', p.id, p.occurred_at, p.total, sp.name,
      p.document_id, 'party_amount', 1
    from public.purchases p
    join public.suppliers sp on sp.organization_id=p.organization_id and sp.id=p.supplier_id
    where p_kind='purchase' and p_party is not null and v_amount is not null
      and p.organization_id=p_org and p.supplier_id=p_party and p.total=v_amount
      and p.occurred_at > now() - interval '30 days' and p.reversed_at is null
  ) m
  order by m.id, m.priority
  ) u
  order by u.occurred_at desc
  limit 3;
end
$$;

revoke all on function public.set_document_fingerprint(uuid,uuid,text) from public,anon;
revoke all on function public.find_similar_records(uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.set_document_fingerprint(uuid,uuid,text) to authenticated;
grant execute on function public.find_similar_records(uuid,text,uuid,uuid,text) to authenticated;

commit;
