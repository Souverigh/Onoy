-- ТЗ §6: «выбор продавца запоминается как синоним имени» — распознанное
-- ADRE имя контрагента сохраняется в aliases, чтобы в следующий раз
-- совпадение находилось сразу.
begin;

create function public.add_counterparty_alias(
  p_org uuid, p_kind text, p_id uuid, p_alias text
) returns void
language plpgsql security definer set search_path='' as $$
declare v_alias text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('customer','supplier') then raise exception 'invalid_kind'; end if;
  v_alias := trim(coalesce(p_alias,''));
  if length(v_alias) = 0 or length(v_alias) > 160 then raise exception 'invalid_alias'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  if p_kind = 'customer' then
    update public.customers
    set aliases = array_append(aliases, v_alias)
    where organization_id=p_org and id=p_id and not (v_alias = any(aliases));
    if not found and not exists(select 1 from public.customers where organization_id=p_org and id=p_id)
    then raise exception 'invalid_customer'; end if;
  else
    update public.suppliers
    set aliases = array_append(aliases, v_alias)
    where organization_id=p_org and id=p_id and not (v_alias = any(aliases));
    if not found and not exists(select 1 from public.suppliers where organization_id=p_org and id=p_id)
    then raise exception 'invalid_supplier'; end if;
  end if;
end
$$;

revoke all on function public.add_counterparty_alias(uuid,text,uuid,text) from public,anon;
grant execute on function public.add_counterparty_alias(uuid,text,uuid,text) to authenticated;

commit;
