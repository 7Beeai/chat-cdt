-- 0028_push_assignment_inbound.sql
-- Push de atribuição + push de resposta do cliente.
--
-- Pedido da franquia Patrocínio (2026-08): "notificações automáticas quando
-- houver alguma atualização, pendência ou retorno do cliente".
--
-- Contexto: o push original (chat_notify_handoff, 0001/0003) só dispara na
-- transição routing→'queued'. Em unidades COM rodízio (0022) essa transição
-- não existe — o BEFORE trigger reescreve para 'human' + dono na mesma UPDATE,
-- então o AFTER de handoff nunca vê 'queued' e o agente não recebe nada.
-- E não existia notificação nenhuma quando o CLIENTE responde numa conversa
-- que já está com um operador.
--
-- Dois triggers novos, ambos aditivos e à prova de falha (EXCEPTION WHEN
-- OTHERS → nunca quebram o UPDATE/INSERT que os disparou; pg_net é async):
--
-- 1) trg_chat_notify_assignment (conversations, AFTER UPDATE)
--    Dispara quando assigned_operator_id muda para alguém, em conversa aberta.
--    Cobre: rodízio 0022 (auth.uid() NULL — update vem do n8n), devolução por
--    SLA 0025 (pg_cron, auth.uid() NULL) e reatribuição feita por OUTRA pessoa
--    (admin). NÃO notifica quem atribuiu a si mesmo (assumir/tomar no app:
--    new.assigned_operator_id = auth.uid()) — ninguém precisa de push do que
--    acabou de clicar.
--
-- 2) trg_chat_notify_inbound (messages, AFTER INSERT, direction='in')
--    Dispara quando o cliente manda mensagem numa conversa ABERTA, EM MÃOS
--    HUMANAS e COM DONO (routing='human' + assigned_operator_id). Push só para
--    o dono, com preview do texto (ou rótulo do tipo de mídia). Conversas com
--    a IA (routing='ai') e fila sem dono ficam de fora de propósito: a IA
--    responde sozinha, e a fila já recebeu o push de handoff no enqueue.
--    O tag do sw.js = conversation_id → rajada de mensagens do mesmo cliente
--    substitui a notificação em vez de empilhar.
--
-- O endpoint /api/internal/push/notify ganhou os eventos 'assigned' (push só
-- para operator_user_id) e 'inbound' (idem, com preview). Aplicar esta
-- migração DEPOIS do deploy do app — o endpoint antigo ignoraria
-- operator_user_id e faria fanout de unidade com o título errado.
--
-- Descoberto no mesmo trabalho (2026-08-17): o push de handoff estava MORTO em
-- prod desde sempre — chat_config.cron_secret ≠ CRON_SECRET do .env.local →
-- todo net.http_post levava 401 (223 em 6h). Corrigido via UPDATE em
-- chat_config (fora do repo, carrega secret).

-- --------------------------------------------------------------------------
-- 1) Push de atribuição
-- --------------------------------------------------------------------------
create or replace function public.chat_notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  origin text;
  secret text;
begin
  -- Auto-atribuição no app (Assumir / tomada): quem clicou não precisa de push.
  -- Rodízio/SLA/n8n rodam sem JWT → auth.uid() NULL → notifica.
  if new.assigned_operator_id = auth.uid() then
    return new;
  end if;

  select value into origin from public.chat_config where key = 'app_origin';
  select value into secret from public.chat_config where key = 'cron_secret';
  if origin is null or origin = '' then
    return new;
  end if;

  perform net.http_post(
    url := origin || '/api/internal/push/notify',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object(
      'event',            'assigned',
      'conversation_id',  new.id,
      'unit_id',          new.unit_id,
      'reason',           new.handoff_reason,
      'operator_user_id', new.assigned_operator_id
    )
  );
  return new;
exception when others then
  -- Push é best-effort: nunca pode derrubar a transição da conversa.
  return new;
end$$;

revoke execute on function public.chat_notify_assignment() from anon, authenticated, public;

drop trigger if exists trg_chat_notify_assignment on public.conversations;
create trigger trg_chat_notify_assignment
  after update on public.conversations
  for each row
  when (
    new.assigned_operator_id is not null
    and new.assigned_operator_id is distinct from old.assigned_operator_id
    and new.status = 'open'::public.chat_conversation_status
  )
  execute function public.chat_notify_assignment();

-- --------------------------------------------------------------------------
-- 2) Push de resposta do cliente
-- --------------------------------------------------------------------------
create or replace function public.chat_notify_inbound()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv    record;
  origin  text;
  secret  text;
  preview text;
begin
  select id, unit_id, status, routing, assigned_operator_id
    into conv
    from public.conversations
   where id = new.conversation_id;

  if conv.id is null
     or conv.status <> 'open'
     or conv.routing <> 'human'
     or conv.assigned_operator_id is null then
    return new;
  end if;

  select value into origin from public.chat_config where key = 'app_origin';
  select value into secret from public.chat_config where key = 'cron_secret';
  if origin is null or origin = '' then
    return new;
  end if;

  preview := case new.type::text
    when 'text'     then left(coalesce(new.payload->'text'->>'body', ''), 120)
    when 'audio'    then 'Mensagem de áudio'
    when 'image'    then 'Imagem'
    when 'video'    then 'Vídeo'
    when 'document' then 'Documento'
    when 'sticker'  then 'Figurinha'
    else '[' || new.type::text || ']'
  end;

  perform net.http_post(
    url := origin || '/api/internal/push/notify',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object(
      'event',            'inbound',
      'conversation_id',  conv.id,
      'unit_id',          conv.unit_id,
      'operator_user_id', conv.assigned_operator_id,
      'preview',          preview
    )
  );
  return new;
exception when others then
  -- Nunca quebrar o INSERT do webhook por causa de push.
  return new;
end$$;

revoke execute on function public.chat_notify_inbound() from anon, authenticated, public;

drop trigger if exists trg_chat_notify_inbound on public.messages;
create trigger trg_chat_notify_inbound
  after insert on public.messages
  for each row
  when (new.direction = 'in'::public.chat_message_direction)
  execute function public.chat_notify_inbound();
