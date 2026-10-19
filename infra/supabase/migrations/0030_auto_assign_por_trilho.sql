-- 0030_auto_assign_por_trilho.sql
-- Rodízio por TRILHO (cobrança × relacionamento) no pool de auto-atribuição.
--
-- Problema: o rodízio (0022) e o SLA (0025) são cegos ao trilho. Em Patrocínio
-- o Neuber foi criado (21/09) como responsável SOMENTE pelo relacionamento, mas
-- ficou fora do pool → nunca recebeu conversa; tudo caía em Sabrina/Melyna/Kamila.
--
-- Solução (aditiva, dirigida por config):
--   * chat_auto_assign_pool.trilho: 'cobranca' | 'relacionamento' | NULL.
--     NULL = atende qualquer trilho (comportamento antigo; unidade sem trilho
--     configurado não muda nada).
--   * Trilho da conversa = mesma regra do badge da inbox (chat_conversation_trilhos):
--     telefone em clientes_cobranca_dashboard → 'cobranca'; senão em
--     adimplentes_base (bi_atual) → 'relacionamento'; senão desconhecido, que
--     vai para o grupo de cobrança (onde caía antes).
--   * Elegíveis = ativos com trilho NULL ou igual ao da conversa. Se ninguém
--     for elegível (ex.: Neuber is_active=false), cai no pool ativo inteiro —
--     conversa nunca fica sem dono por causa do filtro.
--   * Cursor por (unidade, trilho) em tabela nova → round-robin justo dentro de
--     cada grupo. O cursor antigo (chat_auto_assign_cursor) deixa de ser usado.
--   * SLA (0025) devolve só dentro do mesmo grupo. Grupo de 1 (Neuber) = não
--     devolve (já era a regra "pool < 2"): a conversa de relacionamento fica com
--     ele, não vaza para a equipe de cobrança.
-- Falha na consulta de trilho NUNCA derruba o handoff do n8n: exception → NULL
-- → grupo de cobrança.

-- --------------------------------------------------------------------------
-- Schema
-- --------------------------------------------------------------------------
alter table public.chat_auto_assign_pool
  add column if not exists trilho text
  check (trilho in ('cobranca', 'relacionamento'));

create table if not exists public.chat_auto_assign_cursor_trilho (
  unit_id uuid not null references public.units(id) on delete cascade,
  trilho  text not null,           -- 'cobranca' | 'relacionamento' | '*' (pool sem filtro)
  counter bigint not null default 0,
  primary key (unit_id, trilho)
);

alter table public.chat_auto_assign_cursor_trilho enable row level security;
-- Sem policy: só funções SECURITY DEFINER escrevem/leem.

-- --------------------------------------------------------------------------
-- Trilho de uma conversa, sem o filtro de auth.uid() (roda em trigger/cron).
-- Usa idx_ccd_unit_matchkey e idx_ab_unit_matchkey.
-- --------------------------------------------------------------------------
create or replace function public.chat_trilho_da_conversa(p_unit_id uuid, p_contact_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  k text;
begin
  select chat_phone_match_key(ct.wa_id) into k
    from contacts ct
   where ct.id = p_contact_id;

  if k is null then
    return null;
  end if;

  if exists (
    select 1 from clientes_cobranca_dashboard d
     where d.unit_id = p_unit_id
       and chat_phone_match_key(d.whatsapp) = k
  ) then
    return 'cobranca';
  end if;

  if exists (
    select 1 from adimplentes_base a
     where a.unit_id = p_unit_id
       and a.bi_atual
       and chat_phone_match_key(a.telefone) = k
  ) then
    return 'relacionamento';
  end if;

  return null;
exception when others then
  return null;
end;
$$;

revoke execute on function public.chat_trilho_da_conversa(uuid, uuid) from anon, authenticated, public;

-- --------------------------------------------------------------------------
-- Próximo agente do grupo do trilho (compartilhado por entrada e SLA).
-- p_excluir: dono atual (SLA) — pulado se houver outro elegível.
-- Retorna NULL se não houver ninguém elegível além de p_excluir.
-- --------------------------------------------------------------------------
create or replace function public.chat_auto_assign_proximo(
  p_unit_id uuid,
  p_trilho  text,
  p_excluir uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  alvo       text := coalesce(p_trilho, 'cobranca');
  chave      text;
  elegiveis  uuid[];
  n          bigint;
  i          int;
  candidato  uuid;
begin
  -- Grupo do trilho: quem é do trilho OU atende tudo (trilho NULL).
  select array_agg(operator_id order by sort_order, operator_id) into elegiveis
    from chat_auto_assign_pool
   where unit_id = p_unit_id and is_active
     and (trilho is null or trilho = alvo);
  chave := alvo;

  -- Ninguém no grupo → pool ativo inteiro (nunca deixa sem dono).
  if coalesce(array_length(elegiveis, 1), 0) = 0 then
    select array_agg(operator_id order by sort_order, operator_id) into elegiveis
      from chat_auto_assign_pool
     where unit_id = p_unit_id and is_active;
    chave := '*';
  end if;

  if coalesce(array_length(elegiveis, 1), 0) = 0 then
    return null;
  end if;

  for i in 1..array_length(elegiveis, 1) loop
    insert into chat_auto_assign_cursor_trilho (unit_id, trilho, counter)
    values (p_unit_id, chave, 1)
    on conflict (unit_id, trilho)
      do update set counter = chat_auto_assign_cursor_trilho.counter + 1
    returning counter into n;

    candidato := elegiveis[((n - 1) % array_length(elegiveis, 1)) + 1];
    if candidato is distinct from p_excluir then
      return candidato;
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.chat_auto_assign_proximo(uuid, text, uuid) from anon, authenticated, public;

-- --------------------------------------------------------------------------
-- Entrada na fila (substitui o corpo da 0022; trigger trg_chat_auto_assign
-- continua o mesmo).
-- --------------------------------------------------------------------------
create or replace function public.chat_auto_assign_on_queue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  chosen uuid;
begin
  -- Unidade sem rodízio: não faz nada (segue com a fila aberta normal).
  if not exists (
    select 1 from chat_auto_assign_pool
     where unit_id = new.unit_id and is_active
  ) then
    return new;
  end if;

  chosen := chat_auto_assign_proximo(
    new.unit_id,
    chat_trilho_da_conversa(new.unit_id, new.contact_id)
  );

  if chosen is not null then
    new.assigned_operator_id := chosen;
    -- Agente assume de fato: libera "Devolver p/ IA" e bloqueia a IA (n8n Ajuste 3).
    new.routing      := 'human'::public.chat_routing_state;
    new.queued_at    := coalesce(new.queued_at, now());
    new.assigned_at  := coalesce(new.assigned_at, now());
  end if;

  return new;
end;
$$;

revoke execute on function public.chat_auto_assign_on_queue() from anon, authenticated, public;

-- --------------------------------------------------------------------------
-- SLA (substitui o corpo da 0025): devolve só dentro do grupo do trilho.
-- Seleção de candidatas idêntica à 0025.
-- --------------------------------------------------------------------------
create or replace function public.chat_reassign_stale_assignments()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c          record;
  alvo       text;
  grupo      int;
  voltas     int;
  chosen     uuid;
  total      int := 0;
begin
  for c in
    select conv.id, conv.unit_id, conv.contact_id, conv.assigned_operator_id
      from conversations conv
      join chat_auto_assign_config cfg on cfg.unit_id = conv.unit_id and cfg.is_active
     where conv.status = 'open'
       and conv.routing = 'human'
       and conv.assigned_operator_id is not null
       and conv.assigned_at < now() - make_interval(mins => cfg.stale_after_minutes)
       -- Só casos VIVOS: cliente falou nas últimas 24h (ver 0025).
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
    alvo := coalesce(chat_trilho_da_conversa(c.unit_id, c.contact_id), 'cobranca');

    select count(*) into grupo
      from chat_auto_assign_pool
     where unit_id = c.unit_id and is_active
       and (trilho is null or trilho = alvo);

    -- Grupo de 0 ou 1 (ex.: relacionamento = só Neuber): não há pra onde devolver.
    if grupo < 2 then
      continue;
    end if;

    -- Anti-ping-pong: no máximo uma volta completa no grupo.
    select count(*) into voltas
      from chat_conversation_events
     where conversation_id = c.id
       and event_type = 'reassigned'
       and actor_id is null;

    if voltas >= grupo then
      continue;
    end if;

    chosen := chat_auto_assign_proximo(c.unit_id, alvo, c.assigned_operator_id);

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
-- Seed — Patrocínio: cobrança = Sabrina/Melyna/Kamila; relacionamento = Neuber.
-- --------------------------------------------------------------------------
update public.chat_auto_assign_pool
   set trilho = 'cobranca'
 where unit_id = 'd6e66926-c42c-4ec6-970b-c38d3642fa59'
   and operator_id in (
     '739db14f-8383-4b82-a804-85a3420d5498',  -- Sabrina
     'de3203d6-a309-461d-9679-b6c29ecd853a',  -- Melyna
     'f73133d6-3610-4214-9677-187d9db2f548'   -- Kamila Silva
   );

insert into public.chat_auto_assign_pool (unit_id, operator_id, sort_order, is_active, trilho)
values ('d6e66926-c42c-4ec6-970b-c38d3642fa59', '0fe48726-b987-4952-a571-208c8c8b58b3', 3, true, 'relacionamento')  -- Neuber
on conflict (unit_id, operator_id)
  do update set trilho = 'relacionamento', is_active = true;
