-- 0007_debtor_context.sql
-- ---------------------------------------------------------------------------
-- Painel de contexto do devedor (coluna 4 do inbox).
--
-- A UI precisa de dados de cobrança (valor em aberto, matrícula/contrato,
-- nº de disparos/tentativas, status da régua, link de pagamento) que vivem
-- nas tabelas do n8n `clientes_cobranca_*`. NÃO PODEMOS alterar essas tabelas
-- nem expô-las cruas (RLS delas é do fluxo n8n, baseada em
-- `user_unit_permissions`, e o operador CHAT-CDT não está lá).
--
-- Solução ADITIVA e SOMENTE-LEITURA: uma função `chat_debtor_context`
-- SECURITY DEFINER (mesmo padrão de `chat_my_units`/`chat_user_has_unit`) que:
--   1. resolve conversa -> unit_id + contato.wa_id
--   2. exige que o operador tenha a unidade (chat_user_has_unit) — senão vazio
--   3. casa o telefone com `clientes_cobranca_dashboard` por uma CHAVE
--      canônica BR (DDD + últimos 8 dígitos), restrita ao MESMO unit_id
--   4. devolve UMA linha (prefere bi_atual, depois updated_at mais recente)
--
-- NOTA (a revisitar quando o painel for retrabalhado): a chave DDD+8 não é
-- única por pessoa dentro de uma unidade (~1% das conversas casam com 2
-- matrículas) e `valor_inadimplente`/`disparos` voltam do PostgREST como
-- STRING (precisa coerção numérica na borda). Ver docs/08-status.md.
-- ---------------------------------------------------------------------------

-- Normaliza um telefone para a chave canônica BR: DDD(2) || últimos 8 dígitos,
-- sem DDI 55. IMMUTABLE: usável em índice/where sem reexecução.
create or replace function public.chat_phone_match_key(phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when d is null or length(d) < 8 then null
    else substr(local2, 1, 2) || right(local2, 8)
  end
  from (
    select d,
           case
             when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
             else d
           end as local2
    from (select regexp_replace(coalesce(phone, ''), '\D', '', 'g') as d) z
  ) y;
$$;

comment on function public.chat_phone_match_key(text) is
  'Chave canônica BR de telefone (DDD + últimos 8 dígitos, sem DDI 55). Usada para casar contacts.wa_id com clientes_cobranca_*.whatsapp.';

create or replace function public.chat_debtor_context(p_conversation_id uuid)
returns table (
  matched              boolean,
  debtor_name          text,
  matricula            text,
  valor_inadimplente   numeric,
  status               text,
  regua                text,
  disparos             numeric,
  disparos_equipe      numeric,
  pagamento_feito      boolean,
  link_pagamento       text,
  data_pagamento       timestamptz,
  data_ultima_mensagem text,
  updated_at           timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unit uuid;
  v_wa   text;
  v_key  text;
begin
  select co.unit_id, c.wa_id
    into v_unit, v_wa
  from public.conversations co
  join public.contacts c on c.id = co.contact_id
  where co.id = p_conversation_id;

  if v_unit is null then
    return;
  end if;

  if not public.chat_user_has_unit(v_unit) then
    return;
  end if;

  v_key := public.chat_phone_match_key(v_wa);
  if v_key is null then
    return;
  end if;

  return query
  select
    true,
    d.name,
    d.matricula,
    d.valor_inadimplente,
    d.status,
    d.regua,
    d.disparos,
    d.disparos_equipe,
    d.pagamento_feito,
    d.link_pagamento,
    d.data_pagamento,
    d.data_ultima_mensagem,
    d.updated_at
  from public.clientes_cobranca_dashboard d
  where d.unit_id = v_unit
    and public.chat_phone_match_key(d.whatsapp) = v_key
  order by d.bi_atual desc nulls last, d.updated_at desc nulls last
  limit 1;
end;
$$;

comment on function public.chat_debtor_context(uuid) is
  'Contexto de cobrança (somente leitura) de uma conversa, casado por telefone+unidade. Gated por chat_user_has_unit. Não altera tabelas do n8n.';

revoke all on function public.chat_phone_match_key(text)   from public;
revoke all on function public.chat_debtor_context(uuid)    from public;
grant execute on function public.chat_phone_match_key(text) to authenticated;
grant execute on function public.chat_debtor_context(uuid)  to authenticated;
