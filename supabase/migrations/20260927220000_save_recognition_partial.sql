-- Аудит ТЗ 15.1 п. 2: ошибка в одной строке накладной (нечитаемое число,
-- нарушение проверки) валила весь документ, а пользователю показывался
-- текст SQL. Теперь каждая строка сохраняется отдельно: плохие пропускаются,
-- документ получает статус «Расхождение» и понятное сообщение «Не разобрали
-- строки 3, 5 — проверьте их на фото». Тело — как в adre.sql. Данные не
-- меняются.
begin;

create or replace function public.save_recognition(
  p_org uuid, p_document uuid, p_provider text, p_model text, p_prompt_version text,
  p_raw_json jsonb, p_lines jsonb, p_status text, p_latency_ms integer, p_cost numeric
) returns void
language plpgsql security definer set search_path='' as $$
declare v_line jsonb; v_bad text[] := '{}'; v_status text := p_status;
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
    begin
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
    exception when others then
      -- Строку не сохранили — запоминаем номер, остальные идут дальше.
      v_bad := array_append(v_bad, coalesce(v_line->>'n', '?'));
    end;
  end loop;

  if array_length(v_bad, 1) > 0 then v_status := 'review'; end if;
  update public.documents
  set status=v_status,
      error_message=case when array_length(v_bad, 1) > 0
        then 'Не разобрали ' || case when array_length(v_bad,1) = 1 then 'строку ' else 'строки ' end
             || array_to_string(v_bad, ', ') || ' — проверьте их на фото и добавьте вручную.'
        end
  where organization_id=p_org and id=p_document;
end
$$;

-- Аудит 15.1 п. 17 и ТЗ §6 «строку можно добавить или удалить»: когда
-- распознавание не справилось, позиции вводятся вручную. Только участник
-- магазина и только для прихода/продажи. Номер — следующий по порядку.
create function public.add_document_line(
  p_org uuid, p_document uuid, p_name text, p_qty text, p_unit text, p_price text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  if not exists(select 1 from public.documents where organization_id=p_org and id=p_document and kind in ('sale','purchase'))
  then raise exception 'invalid_document'; end if;
  insert into public.document_lines(organization_id, document_id, n, name_raw, qty, unit, price)
  values (
    p_org, p_document,
    coalesce((select max(n) from public.document_lines where organization_id=p_org and document_id=p_document), 0) + 1,
    trim(p_name), p_qty::numeric, coalesce(nullif(trim(p_unit),''),'шт'), p_price::numeric
  ) returning id into v_id;
  return v_id;
end
$$;

create function public.delete_document_line(p_org uuid, p_line uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  delete from public.document_lines where organization_id=p_org and id=p_line;
  if not found then raise exception 'invalid_line'; end if;
end
$$;
revoke all on function public.add_document_line(uuid,uuid,text,text,text,text) from public, anon;
revoke all on function public.delete_document_line(uuid,uuid) from public, anon;
grant execute on function public.add_document_line(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.delete_document_line(uuid,uuid) to authenticated;

commit;
