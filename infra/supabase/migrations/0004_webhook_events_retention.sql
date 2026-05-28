-- ============================================================================
-- 0004 — Retenção da chat_webhook_events.
--
-- Sem retenção, a tabela cresce ~3 GB/mês (91% statuses do Meta que não
-- agregam pra replay). Estratégia em duas camadas:
--   1) Webhook handler filtra antes de inserir (só persiste inbound real).
--      → ver app/api/meta/webhook/route.ts → hasInboundMessages()
--   2) pg_cron diário apaga o que sobrar com mais de 7 dias (janela de
--      retry da Meta — depois disso o evento é tecnicamente inútil).
--
-- Resultado esperado: tabela estável em ~10 MB.
-- ============================================================================

-- Função de cleanup (idempotente). SECURITY DEFINER pra pg_cron rodar sem
-- depender de role específico.
create or replace function public.chat_purge_webhook_events()
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.chat_webhook_events
   where received_at < now() - interval '7 days';
end$$;

revoke execute on function public.chat_purge_webhook_events() from anon, authenticated, public;

-- Agenda pg_cron pra rodar todo dia às 03:00 UTC (00:00 BRT).
-- Se já existe (re-aplicação), unschedule primeiro.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'chat_purge_webhook_events_daily';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
  perform cron.schedule(
    'chat_purge_webhook_events_daily',
    '0 3 * * *',
    $cmd$ select public.chat_purge_webhook_events(); $cmd$
  );
end$$;
