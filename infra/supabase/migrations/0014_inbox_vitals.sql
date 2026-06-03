-- 0014_inbox_vitals.sql
-- True (uncapped) queue vitals for the inbox triage column.
--
-- WHY: the inbox layout fetches the working set with `.limit(300)` and derives
-- the "Aguardando / SLA estourado / Em atendimento" vitals AND the "Aguardando"
-- tab badge client-side over that capped set. With >300 open handoffs the
-- counter silently pins at 300 while Relatórios (server-side count) shows the
-- real figure — they disagreed. This RPC returns the real per-unit counts so
-- the UI can show the truth even though the LIST stays capped for performance.
--
-- Mirrors the 0012 report RPCs: SECURITY DEFINER + the profiles.id scope chain
-- (NOT user_units.user_id = auth.uid()). Optional p_unit narrows to one unit;
-- we instead return per-unit rows and let the client re-aggregate, so the
-- localStorage unit filter switches with no extra round trip.
--
-- Definitions are kept IDENTICAL to the client (list-data.ts matchesTab +
-- queue-vitals.tsx) so "uncapped" is the only behavioral change:
--   waiting  = open & routing<>'ai' & assigned_operator_id is null
--   breached = waiting & last_inbound_at <= now() - 20 min
--   active   = open & routing<>'ai' & assigned_operator_id is not null

create or replace function public.chat_inbox_vitals()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
with scope as (
  select uu.unit_id
  from user_units uu
  join profiles p on p.id = uu.user_id
  where p.user_id = auth.uid()
),
h as (
  select c.unit_id, c.routing, c.assigned_operator_id, c.last_inbound_at
  from conversations c
  where c.unit_id in (select unit_id from scope)
    and c.handoff_reason is not null
    and c.status = 'open'
)
select coalesce(
  jsonb_agg(jsonb_build_object(
    'unit_id',  unit_id,
    'waiting',  waiting,
    'breached', breached,
    'active',   active
  )),
  '[]'::jsonb
)
from (
  select
    unit_id,
    count(*) filter (
      where routing <> 'ai' and assigned_operator_id is null
    ) as waiting,
    count(*) filter (
      where routing <> 'ai' and assigned_operator_id is null
        and last_inbound_at <= now() - interval '20 minutes'
    ) as breached,
    count(*) filter (
      where routing <> 'ai' and assigned_operator_id is not null
    ) as active
  from h
  group by unit_id
) t;
$$;

grant execute on function public.chat_inbox_vitals() to authenticated;
