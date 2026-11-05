-- 0033 — queued_at re-carimbado em TODA entrada na fila (04/11/2026, GO Victor)
--
-- Problema medido (7 dias até 04/11): o trigger chat_stamp_conversation_transition só gravava
-- queued_at quando NULL. Conversa que já passou pela fila, voltou pra IA e foi repassada de novo
-- mantinha o queued_at antigo (média 825 h). O TTL de 6 h da fila (public.fila_humana_ttl_48h,
-- pg_cron hora a hora no minuto 25, repo CPT) a devolvia pra IA na rodada seguinte: 824 repasses
-- devolvidos em ~29 min sem nenhum operador ver (36% dos retornos automáticos, 19% dos repasses).
-- Relatório: cpt-ibirite/docs/REPASSES-FILA-HUMANA-E-APP-CHAT-CDT-2026-11-04.md
--
-- Fix (aditivo): (1) queued_at := now() em toda transição → queued; (2) backfill das conversas
-- hoje na fila com carimbo mais velho que o último evento 'queued'.

create or replace function public.chat_stamp_conversation_transition()
returns trigger
language plpgsql
as $$
begin
  if new.routing = 'queued'::public.chat_routing_state
     and old.routing is distinct from new.routing then
    new.queued_at := now();            -- 0033: sempre, não só quando NULL
  end if;

  if new.assigned_operator_id is distinct from old.assigned_operator_id
     and new.assigned_operator_id is not null then
    new.assigned_at := now();
  end if;

  if new.status = 'closed'::public.chat_conversation_status
     and old.status is distinct from new.status
     and new.closed_at is null then
    new.closed_at := now();
  end if;

  return new;
end;
$$;

-- backfill: quem está na fila agora com queued_at anterior ao último 'queued' recebe a data do evento
update public.conversations c
   set queued_at = e.ult
  from (select conversation_id, max(created_at) ult
          from public.chat_conversation_events
         where event_type = 'queued'
         group by conversation_id) e
 where e.conversation_id = c.id
   and c.status = 'open'
   and c.routing = 'queued'
   and (c.queued_at is null or c.queued_at < e.ult - interval '1 minute');
