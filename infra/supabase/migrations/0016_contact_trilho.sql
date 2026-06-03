-- 0015_contact_trilho.sql
-- ---------------------------------------------------------------------------
-- Adiciona o TRILHO do contato ao painel: 'cobranca' | 'relacionamento' | null.
--
-- Regra (validada nos dados — ver analise-cdt):
--   * telefone casa com um devedor em clientes_cobranca_dashboard -> 'cobranca'
--   * senão, telefone casa com adimplentes_base (bi_atual)        -> 'relacionamento'
--   * senão                                                       -> null
--
-- Por que NÃO é "está nas duas tabelas": 20.192 devedores (~43%) NÃO estão em
-- adimplentes_base (verificado por matrícula E por telefone). Decidir cobrança
-- pela PRESENÇA na tabela de cobrança pega todos os devedores; adimplentes-só =
-- relacionamento. Mesma resposta da regra original no conjunto de interseção,
-- e correta nas bordas (os 20k devedores ausentes de adimplentes).
--
-- Continua SOMENTE-LEITURA, SECURITY DEFINER, gated por chat_user_has_unit.
-- NÃO altera nenhuma tabela do n8n. Estende chat_debtor_context (0008): apenas
-- ACRESCENTA a chave 'trilho' ao JSONB — todos os demais campos são idênticos.
--
-- PRÉ-REQUISITO (rodar UMA vez, fora de transação — JÁ APLICADO via MCP):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ab_unit_matchkey
--     ON public.adimplentes_base (unit_id, public.chat_phone_match_key(telefone))
--     WHERE bi_atual;
--   -- aditivo, CONCURRENTLY para não travar as escritas do n8n; mesma estratégia
--   -- do idx_ccd_unit_matchkey (migration 0013).
-- ---------------------------------------------------------------------------

create or replace function public.chat_debtor_context(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_unit     uuid;
  v_wa       text;
  v_key      text;
  v_deb      record;
  v_distinct int;
  v_link     jsonb;
  v_pay      jsonb;
  v_total    numeric;
  v_qtd      int;
begin
  -- conversa -> unidade + telefone
  select co.unit_id, c.wa_id
    into v_unit, v_wa
  from public.conversations co
  join public.contacts c on c.id = co.contact_id
  where co.id = p_conversation_id;

  if v_unit is null then return null; end if;
  if not public.chat_user_has_unit(v_unit) then return null; end if;

  v_key := public.chat_phone_match_key(v_wa);
  if v_key is null then
    return jsonb_build_object('matched', false, 'trilho', null);
  end if;

  -- devedor escolhido (prefere bi_atual, depois mais recente)
  select d.*
    into v_deb
  from public.clientes_cobranca_dashboard d
  where d.unit_id = v_unit
    and public.chat_phone_match_key(d.whatsapp) = v_key
  order by d.bi_atual desc nulls last, d.updated_at desc nulls last, d.matricula asc
  limit 1;

  -- NÃO é devedor -> relacionamento se estiver na base de adimplentes ativa, senão nada
  if not found then
    return jsonb_build_object(
      'matched', false,
      'trilho',
        case when exists (
               select 1 from public.adimplentes_base a
               where a.unit_id = v_unit
                 and a.bi_atual
                 and public.chat_phone_match_key(a.telefone) = v_key
             ) then 'relacionamento' else null end
    );
  end if;

  -- ambiguidade: >1 matrícula distinta para o mesmo telefone+unidade
  select count(distinct d.matricula)
    into v_distinct
  from public.clientes_cobranca_dashboard d
  where d.unit_id = v_unit
    and public.chat_phone_match_key(d.whatsapp) = v_key;

  -- último link de pagamento gerado (centavos -> reais)
  select jsonb_build_object(
           'valor',          round(l.valor) / 100.0,
           'status',         l.status,
           'pix_copia_cola', l.pix_copia_cola,
           'link',           l.link_pagamento,
           'gerado_em',      coalesce(l.data_link_gerado, l.created_at),
           'expira_em',      l.expires_at
         )
    into v_link
  from public.links_pagamentos_gerados l
  where l.matricula = v_deb.matricula and l.unit_id = v_unit
  order by coalesce(l.data_link_gerado, l.created_at) desc nulls last
  limit 1;

  -- último pagamento (centavos -> reais)
  select jsonb_build_object(
           'valor',           round(p.valor) / 100.0,
           'data',            p.data_pagamento,
           'forma',           p.forma_pagamento,
           'baixa_realizada', p.baixa_realizada
         )
    into v_pay
  from public.pagamentos p
  where p.matricula = v_deb.matricula and p.unit_id = v_unit
  order by p.data_pagamento desc nulls last
  limit 1;

  -- totais de pagamento
  select coalesce(sum(p.valor), 0), count(*)
    into v_total, v_qtd
  from public.pagamentos p
  where p.matricula = v_deb.matricula and p.unit_id = v_unit;

  -- é devedor -> cobrança
  return jsonb_build_object(
    'matched',          true,
    'trilho',           'cobranca',
    'ambiguous',        v_distinct > 1,
    'name',             v_deb.name,
    'matricula',        v_deb.matricula,
    'valor_aberto',     round(v_deb.valor_inadimplente) / 100.0,
    'status',           v_deb.status,
    'regua',            v_deb.regua,
    'tentativas',       coalesce(v_deb.disparos, 0) + coalesce(v_deb.disparos_equipe, 0),
    'pagamento_feito',  v_deb.pagamento_feito,
    'atualizado_em',    v_deb.updated_at,
    'ultimo_link',      v_link,
    'ultimo_pagamento', v_pay,
    'total_pago',       round(v_total) / 100.0,
    'qtd_pagamentos',   v_qtd
  );
end;
$$;

comment on function public.chat_debtor_context(uuid) is
  'Contexto de cobrança (JSONB, somente leitura) + TRILHO (cobranca|relacionamento|null) de uma conversa, casado por telefone+unidade. Valores em REAIS (origem em centavos). Gated por chat_user_has_unit. Não altera tabelas do n8n.';

revoke all on function public.chat_debtor_context(uuid) from public;
grant execute on function public.chat_debtor_context(uuid) to authenticated;
