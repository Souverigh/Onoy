-- Кеш распознавания: ответ Gemini сохраняется сразу, как только получен, —
-- и при проверке фото до подтверждения (приход/продажа), и при распознавании
-- квитанции. Одинаковое фото create_document сводит к одному документу, так
-- что повторный выбор того же фото и фоновая оцифровка после подтверждения
-- берут готовый результат из document_extractions вместо второго вызова
-- Gemini. Статус документа не меняется — это делает save_recognition.
begin;

create function public.cache_extraction(
  p_org uuid, p_document uuid, p_provider text, p_model text, p_prompt_version text,
  p_raw_json jsonb, p_latency_ms integer, p_cost numeric
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists (
    select 1 from public.documents where organization_id=p_org and id=p_document
  ) then raise exception 'invalid_document'; end if;
  if coalesce(p_raw_json->>'kind','') not in ('invoice','receipt')
  then raise exception 'invalid_extraction'; end if;

  insert into public.document_extractions(
    organization_id, document_id, payload, model_version, provider, prompt_version,
    latency_ms, cost
  ) values (
    p_org, p_document, p_raw_json, coalesce(p_model,'unknown'), p_provider, p_prompt_version,
    p_latency_ms, p_cost
  );
end
$$;

revoke all on function public.cache_extraction(uuid,uuid,text,text,text,jsonb,integer,numeric) from public,anon;
grant execute on function public.cache_extraction(uuid,uuid,text,text,text,jsonb,integer,numeric) to authenticated;

commit;
