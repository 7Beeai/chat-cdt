-- ============================================================================
-- CHAT-CDT — schema inicial (additive sobre o banco existente do n8n)
--
-- Premissas confirmadas no banco vivo:
--   * Tenant = public.units (já existe). Não criamos `tenants`.
--   * Operador = public.profiles (já existe) + acesso por public.user_units.
--     Não criamos `operators`. Push subscriptions ficam em tabela própria
--     pra não tocar em profiles (de propriedade do n8n).
--   * Templates Meta = public.template_inventory (já existe). Read-only.
--   * Webhook log do n8n = public.webhook_events_log. Mantemos separado
--     em public.chat_webhook_events para isolar auditoria do CHAT-CDT.
--   * pg_net + pgcrypto já instalados (verificado).
--
-- O n8n precisa de 2-3 ajustes (documentados no README) para coordenar
-- com este app via conversations.routing.
-- ============================================================================

-- Enums --------------------------------------------------------------------
create type chat_routing_state       as enum ('ai','queued','human');
create type chat_handoff_reason      as enum ('payment_re_register','cancel','other_support');
create type chat_conversation_status as enum ('open','snoozed','closed');
create type chat_message_direction   as enum ('in','out');
create type chat_message_status      as enum ('pending','sent','delivered','read','failed');
create type chat_sender_kind         as enum ('ai','operator','system','customer');

-- WABAs registry -----------------------------------------------------------
-- Não existia tabela canônica; waba_id era texto solto em 5+ tabelas.
create table wabas (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  waba_id     text unique not null,
  business_id text,
  name        text,
  created_at  timestamptz not null default now()
);

-- Phone numbers (Cloud API) -----------------------------------------------
-- disparadores_whatsapp não tem o phone_number_id da Graph; criamos
-- registry próprio FK em wabas. Quem precisar relacionar com o disparador
-- original pode JOIN por (unit_id, waba_id).
create table chat_phone_numbers (
  id              uuid primary key default gen_random_uuid(),
  waba_id         uuid not null references wabas(id) on delete cascade,
  phone_number_id text unique not null,
  display_phone   text,
  quality_rating  text,
  created_at      timestamptz not null default now()
);

-- Contacts -----------------------------------------------------------------
-- Chave por (unit_id, wa_id). matricula opcional em profile jsonb permite
-- vincular ao débito sem depender da volatilidade de clientes_cobranca_*.
create table contacts (
  id              uuid primary key default gen_random_uuid(),
  unit_id         uuid not null references units(id) on delete cascade,
  wa_id           text not null,
  name            text,
  profile         jsonb not null default '{}'::jsonb,
  crm_external_id text,
  created_at      timestamptz not null default now(),
  unique (unit_id, wa_id)
);
create index on contacts (unit_id, wa_id);

-- Conversations ------------------------------------------------------------
create table conversations (
  id                          uuid primary key default gen_random_uuid(),
  unit_id                     uuid not null references units(id) on delete cascade,
  contact_id                  uuid not null references contacts(id) on delete cascade,
  phone_number_id             uuid not null references chat_phone_numbers(id),
  status                      chat_conversation_status not null default 'open',
  routing                     chat_routing_state not null default 'ai',
  handoff_reason              chat_handoff_reason,
  priority                    int not null default 0,
  assigned_operator_id        uuid references auth.users(id),
  last_inbound_at             timestamptz,
  customer_window_expires_at  timestamptz,
  opened_at                   timestamptz not null default now(),
  closed_at                   timestamptz
);
create index on conversations (unit_id, routing, priority desc, last_inbound_at desc);
create index on conversations (assigned_operator_id);
create index on conversations (contact_id, status);
-- Race guard: no máximo uma conversa 'open' por contato. n8n e CHAT-CDT
-- podem tentar criar concorrentemente; uma cria, a outra cai no ON CONFLICT.
create unique index uniq_open_conv_per_contact
  on conversations (contact_id) where status = 'open';

-- Messages -----------------------------------------------------------------
-- Tabela própria do CHAT-CDT. Coexiste com message_log/message_inbound do
-- n8n. n8n grava uma cópia AQUI (a cada outbound da IA) para o operador
-- enxergar o histórico completo na thread. Inbound do CHAT-CDT vem do
-- nosso webhook; outbound do operador vem da rota /api/messages/send.
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  wa_message_id   text unique,
  direction       chat_message_direction not null,
  type            text not null,
  payload         jsonb not null,
  status          chat_message_status not null default 'pending',
  error           jsonb,
  sent_by         chat_sender_kind not null,
  operator_id     uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index on messages (conversation_id, created_at desc);

-- Push subscriptions (Web Push) -------------------------------------------
-- Uma linha por subscription (um operador pode ter desktop + mobile).
create table chat_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- Webhook audit log (separado do webhook_events_log que é do n8n) ---------
create table chat_webhook_events (
  id           uuid primary key default gen_random_uuid(),
  app_event_id text,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);
create index on chat_webhook_events (received_at desc);
create index on chat_webhook_events (app_event_id);

-- ============================================================================
-- Triggers
-- ============================================================================

-- Bump last_inbound_at + abre janela 24h em todo inbound.
create or replace function chat_bump_conversation_window()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.direction = 'in' then
    update conversations
       set last_inbound_at            = new.created_at,
           customer_window_expires_at = new.created_at + interval '24 hours'
     where id = new.conversation_id;
  end if;
  return new;
end$$;
create trigger trg_chat_bump_window
  after insert on messages
  for each row execute function chat_bump_conversation_window();

-- Fanout de push quando routing transiciona para 'queued'. Lê
-- app.app_origin e app.cron_secret como GUC; sem isso, no-op.
create or replace function chat_notify_handoff()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  origin text := current_setting('app.app_origin', true);
  secret text := current_setting('app.cron_secret', true);
begin
  if new.routing = 'queued'
     and (old.routing is distinct from new.routing)
     and origin is not null and origin <> '' then
    perform net.http_post(
      url := origin || '/api/internal/push/notify',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', coalesce(secret, '')
      ),
      body := jsonb_build_object(
        'conversation_id', new.id,
        'unit_id',         new.unit_id,
        'reason',          new.handoff_reason
      )
    );
  end if;
  return new;
end$$;
create trigger trg_chat_notify_handoff
  after update of routing on conversations
  for each row execute function chat_notify_handoff();

-- ============================================================================
-- Helpers para RLS
-- ============================================================================

-- True se o auth.uid() atual tem acesso à unit alvo via user_units.
-- Cadeia: auth.users.id -> profiles.user_id -> profiles.id -> user_units.user_id
create or replace function chat_user_has_unit(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from user_units uu
      join profiles p on p.id = uu.user_id
     where p.user_id = auth.uid()
       and uu.unit_id = target
  )
$$;
-- chat_notify_handoff é função de trigger; nunca invocada via RPC.
revoke execute on function chat_notify_handoff()    from anon, authenticated, public;
-- chat_user_has_unit é invocada pelas RLS policies, então o role authenticated
-- precisa de EXECUTE; mantemos revogada para anon e public.
revoke execute on function chat_user_has_unit(uuid) from anon, public;
grant  execute on function chat_user_has_unit(uuid) to   authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table wabas                    enable row level security;
alter table chat_phone_numbers       enable row level security;
alter table contacts                 enable row level security;
alter table conversations            enable row level security;
alter table messages                 enable row level security;
alter table chat_push_subscriptions  enable row level security;
alter table chat_webhook_events      enable row level security; -- service-role only

-- Explicit deny-all so the linter doesn't flag "RLS enabled, no policy".
-- service_role bypasses RLS, so the webhook writer keeps working.
create policy chat_webhook_events_deny_all on chat_webhook_events
  for all using (false) with check (false);

create policy chat_wabas_select on wabas
  for select using (chat_user_has_unit(unit_id));

create policy chat_phones_select on chat_phone_numbers
  for select using (
    exists (
      select 1 from wabas w
       where w.id = chat_phone_numbers.waba_id
         and chat_user_has_unit(w.unit_id)
    )
  );

create policy chat_contacts_all on contacts
  for all using (chat_user_has_unit(unit_id))
        with check (chat_user_has_unit(unit_id));

create policy chat_conv_all on conversations
  for all using (chat_user_has_unit(unit_id))
        with check (chat_user_has_unit(unit_id));

create policy chat_msg_all on messages
  for all using (
    exists (
      select 1 from conversations c
       where c.id = messages.conversation_id
         and chat_user_has_unit(c.unit_id)
    )
  );

create policy chat_push_self on chat_push_subscriptions
  for all using (user_id = auth.uid())
        with check (user_id = auth.uid());

-- ============================================================================
-- Realtime: incluir as tabelas que a UI escuta. Idempotente.
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table conversations;
exception when duplicate_object then null;
end$$;
do $$
begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null;
end$$;

-- ============================================================================
-- Post-install (rodar manualmente, fora desta migration):
--
--   alter database postgres set app.app_origin  = 'https://chat.cdt.example.com';
--   alter database postgres set app.cron_secret = '<CRON_SECRET>';
--
-- Sem isso, chat_notify_handoff() vira no-op (não dispara push).
-- ============================================================================
