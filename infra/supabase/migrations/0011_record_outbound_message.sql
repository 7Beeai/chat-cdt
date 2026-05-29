-- 0009_record_outbound_message.sql
-- ---------------------------------------------------------------------------
-- Ponto de integração para o n8n REGISTRAR toda mensagem que a IA envia
-- (texto livre OU template/disparo) na tabela `messages` do CHAT-CDT, mantendo
-- o histórico completo para quando a conversa virar handoff.
--
-- Por que uma função e não INSERT cru no n8n:
--   * RLS está ligada em contacts/conversations/messages → INSERT do papel do
--     n8n pode ser bloqueado. SECURITY DEFINER (dona = postgres) contorna a RLS
--     de forma controlada — o n8n só precisa de EXECUTE.
--   * Resolve o caso "cliente nunca respondeu" (conversa ainda não existe):
--     faz find-or-create de contato + conversa, com tratamento de corrida.
--   * Idempotente por `wa_message_id` (reexecução do nó não duplica).
--
-- Só ESCREVE em tabelas do CHAT-CDT (contacts/conversations/messages) e LÊ
-- chat_phone_numbers/wabas. NÃO toca em nenhuma tabela do fluxo n8n.
-- ---------------------------------------------------------------------------

create or replace function public.chat_record_outbound_message(
  p_phone_number_id text,            -- metadata.phone_number_id (Meta, texto) do número que ENVIOU
  p_to              text,            -- WhatsApp do cliente (destinatário), dígitos E.164 (ex: 5511999998888)
  p_type            text,            -- 'text' | 'template' | 'image' | 'interactive' | ...
  p_payload         jsonb,           -- corpo no formato { "<type>": { ... } } (ver comentário)
  p_wa_message_id   text  default null,   -- id retornado pela Graph (messages[0].id). Recomendado p/ idempotência+status.
  p_status          text  default 'sent', -- 'sent' (default) | 'delivered' | 'read' | 'failed' | 'pending'
  p_sent_by         text  default 'ai',   -- 'ai' (default) | 'system'
  p_contact_name    text  default null    -- nome do contato, se houver (não sobrescreve um nome já existente)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone_row uuid;
  v_unit      uuid;
  v_contact   uuid;
  v_conv      uuid;
  v_msg       uuid;
begin
  if p_to is null or p_type is null or p_payload is null then
    raise exception 'p_to, p_type e p_payload são obrigatórios';
  end if;

  -- 1. Resolve o número Meta -> nosso chat_phone_numbers.id + unidade
  select cpn.id, w.unit_id
    into v_phone_row, v_unit
  from public.chat_phone_numbers cpn
  join public.wabas w on w.id = cpn.waba_id
  where cpn.phone_number_id = p_phone_number_id;

  if v_phone_row is null then
    raise exception 'phone_number_id % não cadastrado em chat_phone_numbers', p_phone_number_id;
  end if;

  -- 2. Contato (unique por unit_id+wa_id). Não sobrescreve nome já preenchido.
  insert into public.contacts as c (unit_id, wa_id, name)
  values (v_unit, p_to, nullif(p_contact_name, ''))
  on conflict (unit_id, wa_id)
    do update set name = coalesce(c.name, excluded.name)
  returning c.id into v_contact;

  -- 3. Conversa aberta (find-or-create, com tratamento da corrida do índice
  --    parcial uniq_open_conv_per_contact).
  select id into v_conv
  from public.conversations
  where contact_id = v_contact and status = 'open'
  limit 1;

  if v_conv is null then
    begin
      insert into public.conversations (unit_id, contact_id, phone_number_id)
      values (v_unit, v_contact, v_phone_row)
      returning id into v_conv;
    exception when unique_violation then
      select id into v_conv
      from public.conversations
      where contact_id = v_contact and status = 'open'
      limit 1;
    end;
  end if;

  -- 4. Mensagem (idempotente por wa_message_id). direction sempre 'out'.
  insert into public.messages (
    conversation_id, wa_message_id, direction, type, payload, sent_by, status
  )
  values (
    v_conv,
    nullif(p_wa_message_id, ''),
    'out',
    p_type,
    p_payload,
    coalesce(nullif(p_sent_by, ''), 'ai')::chat_sender_kind,
    coalesce(nullif(p_status, ''), 'sent')::chat_message_status
  )
  on conflict (wa_message_id) do nothing
  returning id into v_msg;

  return jsonb_build_object(
    'conversation_id', v_conv,
    'message_id',      v_msg,
    'inserted',        v_msg is not null
  );
end;
$$;

comment on function public.chat_record_outbound_message(text, text, text, jsonb, text, text, text, text) is
  'n8n chama após enviar via Graph. Registra o outbound da IA em messages (find-or-create contato+conversa, idempotente por wa_message_id). p_payload no formato {"<type>":{...}}. Escreve só em tabelas CHAT-CDT.';

revoke all on function public.chat_record_outbound_message(text, text, text, jsonb, text, text, text, text) from public;
grant execute on function public.chat_record_outbound_message(text, text, text, jsonb, text, text, text, text) to service_role, authenticated;
