-- 0031 — chat_apply_message_statuses: statuses da Meta em lote
--
-- Contexto: cada disparo do Motor V2 gera 3+ eventos de status (sent/
-- delivered/read) que a Meta entrega também ao app Chat CDT (subscrito nas
-- mesmas WABAs). Nos slots de disparo chegam 6–7 mil chamadas/min no webhook
-- e o route fazia UM UPDATE por status — quase todos no-op, porque o motor
-- nunca grava em messages (0020). O processo Node saturava, nginx devolvia
-- 502/504, a Meta reenviava e o health check passava de 6s (alerta honey
-- "chat fora do normal" em todo slot, 2026-10-27).
--
-- Esta função recebe o array de statuses de um envelope inteiro e atualiza
-- SÓ as linhas que existem em messages (IA/operador), numa ida ao banco.
-- Semântica igual à anterior: último status do envelope por wa_message_id
-- vence; status desconhecido é ignorado em vez de quebrar o lote.

create or replace function public.chat_apply_message_statuses(p_statuses jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
begin
  if p_statuses is null or jsonb_typeof(p_statuses) <> 'array' then
    return 0;
  end if;

  with s as (
    select distinct on (x.id) x.id, x.status, x.errors
    from rows from (
           jsonb_to_recordset(p_statuses) as (id text, status text, errors jsonb)
         ) with ordinality as x(id, status, errors, ord)
    where x.id is not null
      and x.status in ('sent', 'delivered', 'read', 'failed')
    order by x.id, x.ord desc
  )
  update public.messages m
     set status = s.status::chat_message_status,
         error  = s.errors
    from s
   where m.wa_message_id = s.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.chat_apply_message_statuses(jsonb) is
  'Aplica em lote os statuses de um envelope do webhook da Meta ([{id, status, errors}]) em messages, só nas linhas existentes (wa_message_id). Último status por id vence. Retorna quantas linhas mudaram. Uso exclusivo do service_role (webhook /api/meta/webhook).';

revoke execute on function public.chat_apply_message_statuses(jsonb) from anon, authenticated, public;
grant  execute on function public.chat_apply_message_statuses(jsonb) to service_role;
