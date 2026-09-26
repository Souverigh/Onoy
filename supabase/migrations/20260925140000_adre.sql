-- ADRE: фоновое распознавание фото (Gemini) — не блокирует долг, только
-- оцифровывает уже проведённый документ. Товары/склад не трогает — Этап 2.
begin;

alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('uploaded','processing','digitized','review','failed'));

alter table public.document_extractions
  add column provider text not null default 'gemini',
  add column prompt_version text not null default 'v1',
  add column latency_ms integer,
  add column cost numeric(10,4);
alter table public.document_extractions alter column provider drop default;
alter table public.document_extractions alter column prompt_version drop default;

create table public.document_lines(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  document_id uuid not null,
  created_at timestamptz not null default now(),
  n integer not null check (n > 0),
  name_raw text not null check (length(trim(name_raw)) between 1 and 200),
  qty numeric(16,3) not null check (qty > 0 and qty < 1e13),
  unit text not null default 'шт',
  price numeric(16,2) not null check (price >= 0 and price < 1e14),
  sum numeric(16,2) generated always as (round(qty * price, 2)) stored,
  confidence numeric(3,2) check (confidence is null or confidence between 0 and 1),
  foreign key (organization_id, document_id) references public.documents(organization_id, id)
);
create index document_lines_document_idx on public.document_lines(organization_id, document_id);
alter table public.document_lines enable row level security;
revoke all on public.document_lines from anon, authenticated;
grant select on public.document_lines to authenticated;
create policy tenant_read on public.document_lines for select to authenticated
  using (private.is_member(organization_id));
grant update (name_raw, qty, unit, price) on public.document_lines to authenticated;
create policy tenant_update on public.document_lines for update to authenticated
  using (private.is_member(organization_id)) with check (private.is_member(organization_id));

create function public.start_recognition(p_org uuid, p_document uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.documents set status='processing', error_message=null
  where organization_id=p_org and id=p_document and status in ('uploaded','failed');
  if not found then raise exception 'already_running'; end if;
end
$$;

create function public.save_recognition(
  p_org uuid, p_document uuid, p_provider text, p_model text, p_prompt_version text,
  p_raw_json jsonb, p_lines jsonb, p_status text, p_latency_ms integer, p_cost numeric
) returns void
language plpgsql security definer set search_path='' as $$
declare v_line jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_status not in ('digitized','review') then raise exception 'invalid_status'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists (
    select 1 from public.documents
    where organization_id=p_org and id=p_document and status='processing'
  ) then raise exception 'invalid_document'; end if;

  insert into public.document_extractions(
    organization_id, document_id, payload, model_version, provider, prompt_version,
    latency_ms, cost
  ) values (
    p_org, p_document, p_raw_json, coalesce(p_model,'unknown'), p_provider, p_prompt_version,
    p_latency_ms, p_cost
  );

  for v_line in select jsonb_array_elements(coalesce(p_lines,'[]'::jsonb))
  loop
    insert into public.document_lines(
      organization_id, document_id, n, name_raw, qty, unit, price, confidence
    ) values (
      p_org, p_document,
      (v_line->>'n')::int,
      v_line->>'name_raw',
      (v_line->>'qty')::numeric,
      coalesce(v_line->>'unit','шт'),
      (v_line->>'price')::numeric,
      nullif(v_line->>'confidence','')::numeric
    );
  end loop;

  update public.documents set status=p_status where organization_id=p_org and id=p_document;
end
$$;

create function public.fail_recognition(p_org uuid, p_document uuid, p_error text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.documents set status='failed', error_message=left(coalesce(p_error,''),500)
  where organization_id=p_org and id=p_document and status='processing';
  if not found then raise exception 'invalid_document'; end if;
end
$$;

create function public.confirm_document_lines(p_org uuid, p_document uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.documents set status='digitized'
  where organization_id=p_org and id=p_document and status='review';
  if not found then raise exception 'invalid_document'; end if;
end
$$;

revoke all on function public.start_recognition(uuid,uuid) from public,anon;
revoke all on function public.save_recognition(uuid,uuid,text,text,text,jsonb,jsonb,text,integer,numeric) from public,anon;
revoke all on function public.fail_recognition(uuid,uuid,text) from public,anon;
revoke all on function public.confirm_document_lines(uuid,uuid) from public,anon;
grant execute on function public.start_recognition(uuid,uuid) to authenticated;
grant execute on function public.save_recognition(uuid,uuid,text,text,text,jsonb,jsonb,text,integer,numeric) to authenticated;
grant execute on function public.fail_recognition(uuid,uuid,text) to authenticated;
grant execute on function public.confirm_document_lines(uuid,uuid) to authenticated;

commit;
