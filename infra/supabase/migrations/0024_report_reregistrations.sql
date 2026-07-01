-- 0024_report_reregistrations.sql
-- Estende chat_report_attendance (0012) com a métrica de recadastro de forma
-- de pagamento (handoff_reason='payment_re_register'), que a 0012 não cobria
-- porque foi criada antes das colunas close_card_reregistered (0017) e
-- close_payment_method (0015) existirem.
--
-- MANTÉM a assinatura exata (timestamptz, timestamptz, uuid) — CREATE OR
-- REPLACE na mesma função, não uma nova. Mudar a assinatura criaria uma
-- função duplicada por overload e o frontend continuaria chamando a antiga.
--
-- Reaproveita o MESMO mecanismo de escopo por unidade da 0012 (scope via
-- user_units + profiles.user_id = auth.uid()), sem inventar filtro novo.
--
-- Recorte pela janela por closed_at (não opened_at) — a métrica é "quantos
-- recadastros fecharam no mês", não "quantos handoffs abriram no mês".
--
-- Aditiva: só acrescenta a chave 'reregistrations' ao jsonb existente;
-- 'funnel'/'sla'/'outcomes'/'operators' ficam intactos.

create or replace function public.chat_report_attendance(
  p_from timestamptz,
  p_to   timestamptz,
  p_unit uuid default null
)
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
    and (p_unit is null or uu.unit_id = p_unit)
),
hand as (
  select c.*
  from conversations c
  where c.unit_id in (select unit_id from scope)
    and c.handoff_reason is not null
    and c.opened_at >= p_from and c.opened_at < p_to
),
closed as (select * from hand where status = 'closed'),
reregist as (
  select c.*
  from conversations c
  where c.unit_id in (select unit_id from scope)
    and c.handoff_reason = 'payment_re_register'
    and c.close_outcome = 'resolvido'
    and c.closed_at >= p_from and c.closed_at < p_to
)
select jsonb_build_object(
  'funnel', jsonb_build_object(
    'queued',   (select count(*) from hand),
    'assigned', (select count(*) from hand where assigned_at is not null or assigned_operator_id is not null),
    'closed',   (select count(*) from hand where status = 'closed')
  ),
  'sla', jsonb_build_object(
    'time_to_assign_sec', (select jsonb_build_object(
        'avg', coalesce(round(avg(extract(epoch from (assigned_at - queued_at)))), 0),
        'p50', coalesce(round(percentile_cont(0.5) within group (order by extract(epoch from (assigned_at - queued_at)))), 0),
        'p90', coalesce(round(percentile_cont(0.9) within group (order by extract(epoch from (assigned_at - queued_at)))), 0),
        'n', count(*)
      ) from hand where assigned_at is not null and queued_at is not null),
    'handle_time_sec', (select jsonb_build_object(
        'avg', coalesce(round(avg(extract(epoch from (closed_at - assigned_at)))), 0),
        'p50', coalesce(round(percentile_cont(0.5) within group (order by extract(epoch from (closed_at - assigned_at)))), 0),
        'n', count(*)
      ) from hand where closed_at is not null and assigned_at is not null)
  ),
  'outcomes', (select coalesce(jsonb_agg(jsonb_build_object('outcome', close_outcome, 'n', n) order by n desc), '[]'::jsonb)
    from (select close_outcome, count(*) n from closed where close_outcome is not null group by 1) t),
  'operators', (select coalesce(jsonb_agg(jsonb_build_object(
        'operator_id', operator_id, 'name', name, 'closed', closed_n, 'resolved', resolved_n,
        'resolution_rate', coalesce(round(100.0 * resolved_n / nullif(closed_n,0), 1), 0),
        'avg_handle_sec', coalesce(handle_avg, 0)
      ) order by closed_n desc), '[]'::jsonb)
    from (
      select c.closed_by as operator_id, pr.name,
             count(*) closed_n,
             count(*) filter (where c.close_outcome = 'resolvido') resolved_n,
             round(avg(extract(epoch from (c.closed_at - c.assigned_at)))) handle_avg
      from closed c left join profiles pr on pr.user_id = c.closed_by
      where c.closed_by is not null
      group by c.closed_by, pr.name
    ) t),
  'reregistrations', jsonb_build_object(
    'yes', (select coalesce(count(*) filter (where close_card_reregistered = true), 0) from reregist),
    'no', (select coalesce(count(*) filter (where close_card_reregistered = false), 0) from reregist),
    'resolved_total', (select coalesce(count(*) filter (where close_card_reregistered is not null), 0) from reregist),
    'by_unit', (select coalesce(jsonb_agg(jsonb_build_object(
          'unit_id', unit_id, 'unit_name', unit_name, 'yes', yes) order by yes desc), '[]'::jsonb)
      from (
        select reregist.unit_id, u.name as unit_name,
               count(*) filter (where reregist.close_card_reregistered = true) yes
        from reregist join units u on u.id = reregist.unit_id
        group by reregist.unit_id, u.name
        having count(*) filter (where reregist.close_card_reregistered = true) > 0
      ) t),
    'by_method', (select coalesce(jsonb_agg(jsonb_build_object(
          'method', method, 'count', n) order by n desc), '[]'::jsonb)
      from (
        select close_payment_method as method, count(*) n
        from reregist
        where close_card_reregistered = true and close_payment_method is not null
        group by close_payment_method
      ) t)
  )
);
$$;

grant execute on function public.chat_report_attendance(timestamptz, timestamptz, uuid) to authenticated;
