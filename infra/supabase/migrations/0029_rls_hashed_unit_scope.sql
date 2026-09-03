-- 0029 — RLS do chat: escopo por unidade avaliado 1x por query (subplan hasheado)
-- em vez de chat_user_has_unit() por linha; e política de mídia casando pela PK.
-- Diagnóstico 2026-09-03: signed URL 5,6s (seq scan de conversations por
-- objeto), listas 300-400ms. chat_user_has_unit() continua existindo (RPCs).

begin;

-- 1. Conjunto de unidades do operador logado (mesma regra de chat_user_has_unit).
create or replace function public.chat_my_unit_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select uu.unit_id
    from public.user_units uu
    join public.profiles p on p.id = uu.user_id
   where p.user_id = auth.uid()
$$;
revoke all on function public.chat_my_unit_ids() from public;
grant execute on function public.chat_my_unit_ids() to authenticated, service_role;

-- 2. conversation_id embutido no path do objeto ('<conv_uuid>/<wamid>.<ext>'),
--    cast seguro: retorna null se o prefixo não for uuid.
create or replace function public.chat_media_conv_id(p_name text)
returns uuid
language sql immutable strict parallel safe
as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
    else null end
$$;
grant execute on function public.chat_media_conv_id(text) to authenticated, service_role, anon;

-- 3. Políticas (mesma semântica, custo por linha = lookup em hash).
drop policy if exists chat_conv_all on public.conversations;
create policy chat_conv_all on public.conversations for all
  using (unit_id in (select public.chat_my_unit_ids()))
  with check (unit_id in (select public.chat_my_unit_ids()));

drop policy if exists chat_contacts_all on public.contacts;
create policy chat_contacts_all on public.contacts for all
  using (unit_id in (select public.chat_my_unit_ids()))
  with check (unit_id in (select public.chat_my_unit_ids()));

drop policy if exists chat_wabas_select on public.wabas;
create policy chat_wabas_select on public.wabas for select
  using (unit_id in (select public.chat_my_unit_ids()));

drop policy if exists chat_auto_assign_config_select on public.chat_auto_assign_config;
create policy chat_auto_assign_config_select on public.chat_auto_assign_config for select
  using (unit_id in (select public.chat_my_unit_ids()));

drop policy if exists chat_auto_assign_pool_select on public.chat_auto_assign_pool;
create policy chat_auto_assign_pool_select on public.chat_auto_assign_pool for select
  using (unit_id in (select public.chat_my_unit_ids()));

drop policy if exists chat_phones_select on public.chat_phone_numbers;
create policy chat_phones_select on public.chat_phone_numbers for select
  using (exists (select 1 from public.wabas w
                  where w.id = chat_phone_numbers.waba_id
                    and w.unit_id in (select public.chat_my_unit_ids())));

drop policy if exists chat_msg_all on public.messages;
create policy chat_msg_all on public.messages for all
  using (exists (select 1 from public.conversations c
                  where c.id = messages.conversation_id
                    and c.unit_id in (select public.chat_my_unit_ids())));

drop policy if exists chat_conv_events_select on public.chat_conversation_events;
create policy chat_conv_events_select on public.chat_conversation_events for select
  using (exists (select 1 from public.conversations c
                  where c.id = chat_conversation_events.conversation_id
                    and c.unit_id in (select public.chat_my_unit_ids())));

drop policy if exists chat_media_select on storage.objects;
create policy chat_media_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-media'
     and exists (select 1 from public.conversations c
                  where c.id = public.chat_media_conv_id(objects.name)
                    and c.unit_id in (select public.chat_my_unit_ids())));

commit;

-- 4. Aba Encerrados: range em closed_at sem varrer a tabela (rodar FORA de
--    transação; aplicado em prod 2026-09-03 via Management API).
-- create index concurrently if not exists idx_conv_closed_handoff
--   on public.conversations (closed_at desc)
--   where status = 'closed' and handoff_reason is not null and handoff_reason <> 'cancel';
