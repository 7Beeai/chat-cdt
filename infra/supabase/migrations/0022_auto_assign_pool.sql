-- 0022_auto_assign_pool.sql
-- Auto-atribuição (round-robin) de handoffs por unidade.
--
-- Problema: handoffs caem na aba "Aguardando" (routing='queued', sem dono) e o
-- operador ESCOLHE qual assumir → cherry-picking (pegam os fáceis, deixam os
-- difíceis pro colega). Pedido da franquia Patrocínio: distribuir igualmente
-- entre as duas agentes, tirando a escolha.
--
-- Solução: ao entrar na fila, se a unidade tem um POOL de auto-atribuição
-- configurado, um trigger já carimba o próximo agente (revezamento) e marca
-- routing='human'. O caso pula "Aguardando" e vai direto pro "Meus" do agente.
-- Genérico e dirigido por config: só unidades com pool ativo são afetadas; as
-- demais seguem com a fila aberta de sempre.
--
-- Encaixe com o n8n (docs/04): a IA só responde se routing='ai' (Ajuste 3);
-- como deixamos 'human', a IA fica quieta e NÃO desfaz a atribuição.
-- Push (chat_notify_handoff) está dormente em prod (GUCs app.* não setadas),
-- então ir direto p/ 'human' não perde notificação — o inbox é realtime+polling.
-- Tudo aditivo; não altera tabelas do n8n nem o contrato de routing.

-- --------------------------------------------------------------------------
-- Config: quem entra no rodízio, por unidade.
-- --------------------------------------------------------------------------
create table if not exists public.chat_auto_assign_pool (
  unit_id     uuid not null references public.units(id) on delete cascade,
  operator_id uuid not null references auth.users(id) on delete cascade,
  sort_order  int  not null default 0,
  -- is_active=false tira o agente do rodízio sem apagar (base p/ futuro
  -- toggle "ausente/disponível" sem mudar schema).
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (unit_id, operator_id)
);

-- Cursor do revezamento, por unidade. Incremento atômico serializa handoffs
-- concorrentes → agentes distintos.
create table if not exists public.chat_auto_assign_cursor (
  unit_id uuid primary key references public.units(id) on delete cascade,
  counter bigint not null default 0
);

alter table public.chat_auto_assign_pool   enable row level security;
alter table public.chat_auto_assign_cursor enable row level security;

-- Leitura p/ membros da unidade (transparência / futura UI). Escrita só via
-- migração/admin/trigger (SECURITY DEFINER) — sem policy de insert/update.
drop policy if exists chat_auto_assign_pool_select on public.chat_auto_assign_pool;
create policy chat_auto_assign_pool_select on public.chat_auto_assign_pool
  for select using (public.chat_user_has_unit(unit_id));

-- --------------------------------------------------------------------------
-- BEFORE UPDATE: ao ai→queued sem dono, escolhe o próximo agente do pool.
-- Roda ANTES de trg_chat_stamp_transition (nome 'auto' < 'stamp'), então o
-- stamp/log já enxergam o dono e logam o evento 'assigned'.
-- --------------------------------------------------------------------------
create or replace function public.chat_auto_assign_on_queue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pool_count int;
  n          bigint;
  chosen     uuid;
begin
  select count(*) into pool_count
    from chat_auto_assign_pool
   where unit_id = new.unit_id and is_active;

  -- Unidade sem rodízio: não faz nada (segue com a fila aberta normal).
  if pool_count = 0 then
    return new;
  end if;

  -- Avança o cursor da unidade (atômico). counter começa em 1 na 1ª vez.
  insert into chat_auto_assign_cursor (unit_id, counter)
  values (new.unit_id, 1)
  on conflict (unit_id)
    do update set counter = chat_auto_assign_cursor.counter + 1
  returning counter into n;

  -- Próximo da fila circular, ordenado por sort_order.
  select operator_id into chosen
    from chat_auto_assign_pool
   where unit_id = new.unit_id and is_active
   order by sort_order, operator_id
   offset ((n - 1) % pool_count)
   limit 1;

  if chosen is not null then
    new.assigned_operator_id := chosen;
    -- Agente assume de fato: libera "Devolver p/ IA" (thread-header exige
    -- routing='human') e bloqueia a IA (n8n Ajuste 3).
    new.routing      := 'human'::public.chat_routing_state;
    new.queued_at    := coalesce(new.queued_at, now());
    new.assigned_at  := coalesce(new.assigned_at, now());
  end if;

  return new;
end;
$$;

revoke execute on function public.chat_auto_assign_on_queue() from anon, authenticated, public;

drop trigger if exists trg_chat_auto_assign on public.conversations;
create trigger trg_chat_auto_assign
  before update on public.conversations
  for each row
  when (
    new.routing = 'queued'::public.chat_routing_state
    and old.routing is distinct from new.routing
    and new.assigned_operator_id is null
  )
  execute function public.chat_auto_assign_on_queue();

-- --------------------------------------------------------------------------
-- Seed — Patrocínio (unit d6e66926): Sabrina (0) e Melyna (1).
-- operator_id = auth.users.id (= profiles.user_id).
-- Roger fica de fora (gestor); ainda pode "assumir" casos manualmente.
-- --------------------------------------------------------------------------
insert into public.chat_auto_assign_pool (unit_id, operator_id, sort_order) values
  ('d6e66926-c42c-4ec6-970b-c38d3642fa59', '739db14f-8383-4b82-a804-85a3420d5498', 0),  -- Sabrina
  ('d6e66926-c42c-4ec6-970b-c38d3642fa59', 'de3203d6-a309-461d-9679-b6c29ecd853a', 1)   -- Melyna
on conflict (unit_id, operator_id) do nothing;
