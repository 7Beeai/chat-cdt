-- ============================================================================
-- 0003 — Tabela de config para o trigger de push fanout.
--
-- Substitui o mecanismo de GUC (app.app_origin / app.cron_secret) por uma
-- tabela.  Motivo: Supabase Cloud bloqueia `ALTER DATABASE ... SET` mesmo
-- para o role postgres, então o caminho documentado em 0001 não funciona em
-- prod gerenciado.  RLS deny-all + EXECUTE revogado mantêm o nível de
-- segurança.
--
-- Aplicada via MCP como `chat_cdt_config_table`.
--
-- Depois de aplicar, popular os 2 valores via SQL separado (não vai pelo
-- repositório porque carrega secret):
--
--   insert into public.chat_config (key, value) values
--     ('app_origin',  'https://chat.cdt.7bee.ai'),
--     ('cron_secret', '<MESMO VALOR DO .env.local CRON_SECRET>')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- ============================================================================

create table if not exists public.chat_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.chat_config enable row level security;

drop policy if exists chat_config_deny_all on public.chat_config;
create policy chat_config_deny_all on public.chat_config
  for all to public using (false) with check (false);

revoke all on public.chat_config from anon, authenticated, public;
grant  select, insert, update, delete on public.chat_config to service_role;

-- chat_notify_handoff lê os 2 valores da tabela em vez do GUC.
create or replace function public.chat_notify_handoff()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  origin text;
  secret text;
begin
  select value into origin from public.chat_config where key = 'app_origin';
  select value into secret from public.chat_config where key = 'cron_secret';

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

revoke execute on function public.chat_notify_handoff() from anon, authenticated, public;
