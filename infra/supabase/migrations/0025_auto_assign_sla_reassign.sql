-- 0025_auto_assign_sla_reassign.sql
-- Devolução ao rodízio por SLA + entrada da Kamila no pool de Patrocínio.
--
-- Contexto (medido em 2026-07-30, Patrocínio, janela de 30 dias):
--   O rodízio de 0022 é justo — a atribuição original saiu 150 Melyna / 150
--   Sabrina. O desequilíbrio observado no inbox (230 x 70) vem TODO da tomada
--   manual (`takeOverConversation`): 91 tomadas, 86 delas pela Melyna.
--   E não é cherry-picking: em 90 das 91 o dono original NÃO havia respondido
--   nada até a tomada, com mediana de 3h20 de espera e zero tomadas em menos
--   de 5 minutos. Ou seja, a Melyna estava cobrindo abandono na unha.
--
-- Problema: com a cobertura sendo manual, (a) depende de alguém garimpar o
-- inbox, (b) o cliente espera horas, e (c) o abandono fica invisível — some
-- dentro do contador de quem cobriu.
--
-- Solução: se o dono não der NENHUMA resposta dentro do SLA, a conversa volta
-- ao rodízio automaticamente e vai pro próximo agente. A cobertura continua
-- existindo (não bloqueamos a tomada manual — bloquear deixaria ~85 conversas/
-- mês no vácuo), mas passa a ser automática, rápida e auditável: o evento
-- 'reassigned' gerado pelo cron tem actor_id NULL, então dá pra separar
-- "devolvido por SLA" de "tomado por um humano" em qualquer relatório.
--
-- Anti-ping-pong: a conversa dá no máximo UMA volta no rodízio (limite =
-- tamanho do pool). Se ninguém atendeu depois disso, ela para de circular e
-- fica com o último dono — sinal de que o problema é de escala/turno, não de
-- distribuição, e precisa de gente olhando.
--
-- Tudo aditivo. Só afeta unidades com pool ativo (hoje: só Patrocínio).

-- --------------------------------------------------------------------------
-- Kamila entra no rodízio de Patrocínio (3ª posição) → 1/3 para cada.
-- operator_id = auth.users.id (= profiles.user_id).
-- --------------------------------------------------------------------------
insert into public.chat_auto_assign_pool (unit_id, operator_id, sort_order) values
  ('d6e66926-c42c-4ec6-970b-c38d3642fa59', 'f73133d6-3610-4214-9677-187d9db2f548', 2)  -- Kamila
on conflict (unit_id, operator_id) do nothing;

-- --------------------------------------------------------------------------
-- Config por unidade. Sem linha = usa o default do COALESCE abaixo (30 min).
-- --------------------------------------------------------------------------
create table if not exists public.chat_auto_assign_config (
  unit_id            uuid primary key references public.units(id) on delete cascade,
  -- Minutos sem NENHUMA resposta do dono antes de devolver ao rodízio.
  stale_after_minutes int not null default 30 check (stale_after_minutes >= 5),
  -- Desliga o SLA sem apagar a config (o rodízio de entrada continua vivo).
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

alter table public.chat_auto_assign_config enable row level security;

drop policy if exists chat_auto_assign_config_select on public.chat_auto_assign_config;
create policy chat_auto_assign_config_select on public.chat_auto_assign_config
  for select using (public.chat_user_has_unit(unit_id));

insert into public.chat_auto_assign_config (unit_id, stale_after_minutes) values
  ('d6e66926-c42c-4ec6-970b-c38d3642fa59', 30)
on conflict (unit_id) do nothing;

-- --------------------------------------------------------------------------
-- Índice de apoio: a varredura filtra por dono + estado + assigned_at.
-- --------------------------------------------------------------------------
create index if not exists idx_conv_sla_stale
  on public.conversations (unit_id, assigned_at)
  where status = 'open'
    and routing = 'human'
    and assigned_operator_id is not null;

-- --------------------------------------------------------------------------
-- Varredura: devolve ao rodízio quem estourou o SLA sem responder.
-- Roda pelo pg_cron (sem JWT) → auth.uid() é NULL nos eventos gerados, que é
-- exatamente a marca de "foi o robô, não um humano".
-- --------------------------------------------------------------------------
create or replace function public.chat_reassign_stale_assignments()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c          record;
  pool_count int;
  voltas     int;
  n          bigint;
  chosen     uuid;
  tentativa  int;
  total      int := 0;
begin
  for c in
    select conv.id, conv.unit_id, conv.assigned_operator_id
      from conversations conv
      join chat_auto_assign_config cfg on cfg.unit_id = conv.unit_id and cfg.is_active
     where conv.status = 'open'
       and conv.routing = 'human'
       and conv.assigned_operator_id is not null
       and conv.assigned_at < now() - make_interval(mins => cfg.stale_after_minutes)
       -- Só casos VIVOS: cliente falou nas últimas 24h. Sem isso a varredura
       -- pegaria backlog zumbi (na 1ª execução eram 30 candidatas, das quais
       -- só 2 tinham cliente esperando de fato — a mais velha era de 25/06)
       -- e despejaria conversa morta no rodízio.
       and conv.last_inbound_at >= now() - interval '24 hours'
       -- Dono não respondeu NADA desde que a conversa caiu com ele.
       and not exists (
         select 1 from messages m
          where m.conversation_id = conv.id
            and m.sent_by = 'operator'
            and m.created_at >= conv.assigned_at
       )
     order by conv.assigned_at
  loop
    select count(*) into pool_count
      from chat_auto_assign_pool
     where unit_id = c.unit_id and is_active;

    -- Sem pool (ou pool de 1): não há pra onde devolver.
    if pool_count < 2 then
      continue;
    end if;

    -- Anti-ping-pong: no máximo uma volta completa no rodízio.
    select count(*) into voltas
      from chat_conversation_events
     where conversation_id = c.id
       and event_type = 'reassigned'
       and actor_id is null;

    if voltas >= pool_count then
      continue;
    end if;

    -- Próximo do rodízio, pulando o dono atual (no máximo pool_count tentativas).
    chosen := null;
    for tentativa in 1..pool_count loop
      insert into chat_auto_assign_cursor (unit_id, counter)
      values (c.unit_id, 1)
      on conflict (unit_id)
        do update set counter = chat_auto_assign_cursor.counter + 1
      returning counter into n;

      select operator_id into chosen
        from chat_auto_assign_pool
       where unit_id = c.unit_id and is_active
       order by sort_order, operator_id
       offset ((n - 1) % pool_count)
       limit 1;

      exit when chosen is distinct from c.assigned_operator_id;
      chosen := null;
    end loop;

    if chosen is null then
      continue;
    end if;

    -- trg_chat_stamp_transition recarimba assigned_at (reinicia o SLA) e
    -- trg_chat_log_transition grava o 'reassigned' com actor_id NULL.
    update conversations
       set assigned_operator_id = chosen
     where id = c.id;

    total := total + 1;
  end loop;

  return total;
end;
$$;

revoke execute on function public.chat_reassign_stale_assignments() from anon, authenticated, public;

-- --------------------------------------------------------------------------
-- Cron a cada 5 min: com SLA de 30 min, o atraso extra de detecção é <= 5 min.
-- --------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('chat-reassign-stale-assignments');
exception when others then
  null;  -- job ainda não existe
end $$;

select cron.schedule(
  'chat-reassign-stale-assignments',
  '*/5 * * * *',
  $$select public.chat_reassign_stale_assignments();$$
);
