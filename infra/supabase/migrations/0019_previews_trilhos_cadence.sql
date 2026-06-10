-- 0019_previews_trilhos_cadence.sql
-- ---------------------------------------------------------------------------
-- Três frentes da sessão 2026-06-10:
--
-- A. chat_conversation_previews — o layout buscava previews com
--    .in('conversation_id', ids): com 600+ conversas a query string passa de
--    20KB e o PostgREST devolve "Bad Request" → TODA a lista renderizava
--    "Sem mensagens ainda". RPC via POST não tem limite de URL e retorna
--    exatamente a última mensagem por conversa (o método antigo também
--    perdia previews de conversas quietas pelo corte global de N*4 linhas).
--
-- B. chat_conversation_trilhos — versão em lote do trilho (0016) para a
--    coluna de chats: badge de relacionamento + filtro.
--
-- C. chat_debtor_context — contatos de relacionamento agora retornam
--    matricula/name de adimplentes_base (antes só telefone+nome do WhatsApp
--    apareciam no painel).
--
-- D. chat_cadence_history — templates de régua disparados pelo motor n8n
--    (message_log, SEM conversation_id) injetados no histórico da conversa,
--    somente leitura, casados por unidade+telefone. Corpo do template vem de
--    template_inventory (componente BODY). Dedup por wa_message_id contra
--    messages (cobre o caso de o outbound já ter sido logado pela IA).
--
-- Tudo SECURITY DEFINER gated por chat_user_has_unit, somente leitura,
-- nenhuma tabela do n8n é alterada (índice em message_log é aditivo, mesma
-- estratégia dos idx_ccd/idx_ab das migrations 0013/0016).
--
-- PRÉ-REQUISITO (rodar UMA vez, fora de transação):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_unit_matchkey
--     ON public.message_log (unit_id, public.chat_phone_match_key(to_whatsapp));
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dl_unit_matchkey
--     ON public.disparos_log (unit_id, public.chat_phone_match_key(telefone));
-- ---------------------------------------------------------------------------

-- A. Última mensagem de cada conversa, em lote ------------------------------
create or replace function public.chat_conversation_previews(
  p_conversation_ids uuid[]
)
returns table (
  conversation_id uuid,
  payload jsonb,
  direction text,
  msg_type text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, m.payload, m.direction::text, m.type, m.created_at
  from public.conversations c
  cross join lateral (
    select msg.payload, msg.direction, msg.type, msg.created_at
    from public.messages msg
    where msg.conversation_id = c.id
    order by msg.created_at desc
    limit 1
  ) m
  where c.id = any(p_conversation_ids)
    and public.chat_user_has_unit(c.unit_id);
$$;

comment on function public.chat_conversation_previews(uuid[]) is
  'Última mensagem (preview) de cada conversa, em lote via POST — substitui o .in() gigante que estourava o limite de URL do PostgREST. Gated por chat_user_has_unit.';

revoke all on function public.chat_conversation_previews(uuid[]) from public;
grant execute on function public.chat_conversation_previews(uuid[]) to authenticated;

-- B. Trilho em lote (mesma regra da 0016) -----------------------------------
create or replace function public.chat_conversation_trilhos(
  p_conversation_ids uuid[]
)
returns table (conversation_id uuid, trilho text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select co.id,
    case
      when exists (
        select 1 from public.clientes_cobranca_dashboard d
        where d.unit_id = co.unit_id
          and public.chat_phone_match_key(d.whatsapp) = k.key
      ) then 'cobranca'
      when exists (
        select 1 from public.adimplentes_base a
        where a.unit_id = co.unit_id
          and a.bi_atual
          and public.chat_phone_match_key(a.telefone) = k.key
      ) then 'relacionamento'
      else null
    end
  from public.conversations co
  join public.contacts ct on ct.id = co.contact_id
  cross join lateral (
    select public.chat_phone_match_key(ct.wa_id) as key
  ) k
  where co.id = any(p_conversation_ids)
    and k.key is not null
    and public.chat_user_has_unit(co.unit_id);
$$;

comment on function public.chat_conversation_trilhos(uuid[]) is
  'Trilho (cobranca|relacionamento|null) por conversa, em lote, para a coluna da inbox. Mesma regra de match da chat_debtor_context (0016).';

revoke all on function public.chat_conversation_trilhos(uuid[]) from public;
grant execute on function public.chat_conversation_trilhos(uuid[]) to authenticated;

-- C. chat_debtor_context: enriquecer relacionamento --------------------------
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
  v_rel      record;
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

  -- NÃO é devedor -> relacionamento se estiver na base de adimplentes ativa.
  -- 0019: devolve também matricula/name do cadastro de adimplente — antes o
  -- painel só tinha telefone+nome do WhatsApp para esses contatos.
  if not found then
    select a.matricula, a.nome, a.ultimo_pagamento
      into v_rel
    from public.adimplentes_base a
    where a.unit_id = v_unit
      and a.bi_atual
      and public.chat_phone_match_key(a.telefone) = v_key
    order by a.updated_at desc nulls last, a.matricula asc
    limit 1;

    if found then
      return jsonb_build_object(
        'matched',   false,
        'trilho',    'relacionamento',
        'matricula', v_rel.matricula,
        'name',      v_rel.nome,
        'ultimo_pagamento_rel', v_rel.ultimo_pagamento
      );
    end if;
    return jsonb_build_object('matched', false, 'trilho', null);
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
  'Contexto de cobrança/relacionamento (JSONB, somente leitura) de uma conversa, casado por telefone+unidade. Relacionamento inclui matricula/name de adimplentes_base (0019). Valores em REAIS. Gated por chat_user_has_unit.';

-- D. Templates de régua do motor n8n no histórico ----------------------------
-- Duas fontes, mesma timeline:
--   * message_log  — motor antigo (F0/F1); parou de disparar em 2026-06-05.
--   * disparos_log — motor v2 (assume daqui pra frente; vazio até o go-live).
-- 'example' = example.body_text do componente BODY — o app usa os padrões dos
-- valores de exemplo pra inferir o que cada {{n}} significa (nome/matrícula/
-- valor) e renderizar legível (os valores reais só existem no n8n no envio).
create or replace function public.chat_cadence_history(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_unit  uuid;
  v_wa    text;
  v_key   text;
  v_waba  text;
  v_out   jsonb;
begin
  select co.unit_id, ct.wa_id, w.waba_id
    into v_unit, v_wa, v_waba
  from public.conversations co
  join public.contacts ct on ct.id = co.contact_id
  left join public.chat_phone_numbers pn on pn.id = co.phone_number_id
  left join public.wabas w on w.id = pn.waba_id
  where co.id = p_conversation_id;

  if v_unit is null then return null; end if;
  if not public.chat_user_has_unit(v_unit) then return null; end if;

  v_key := public.chat_phone_match_key(v_wa);
  if v_key is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',            ml.id,
             'template_name', ml.template_name,
             'sent_at',       ml.sent_at,
             'status',        ml.status,
             'wa_message_id', ml.wa_message_id,
             'body',          ti.body_text,
             'example',       ti.example
           )
           order by ml.sent_at
         ), '[]'::jsonb)
    into v_out
  from (
    select * from (
      select 'ml-' || l.id::text as id, l.template_name, l.sent_at,
             l.status, l.wa_message_id
      from public.message_log l
      where l.unit_id = v_unit
        and public.chat_phone_match_key(l.to_whatsapp) = v_key
        and l.template_name is not null
        and (l.wa_message_id is null or not exists (
              select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.wa_message_id = l.wa_message_id
            ))
      union all
      select 'dl-' || d.id::text, d.template_name, d.sent_at,
             case
               when d.failed_at    is not null then 'failed'
               when d.read_at      is not null then 'read'
               when d.delivered_at is not null then 'delivered'
               else 'sent'
             end,
             d.wa_message_id
      from public.disparos_log d
      where d.unit_id = v_unit
        and public.chat_phone_match_key(d.telefone) = v_key
        and d.template_name is not null
        and d.sent_at is not null
        and (d.wa_message_id is null or not exists (
              select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.wa_message_id = d.wa_message_id
            ))
    ) u
    order by u.sent_at desc
    limit 50
  ) ml
  left join lateral (
    select coalesce(
             t.body_text,
             (select comp->>'text'
              from jsonb_array_elements(t.components) comp
              where comp->>'type' = 'BODY'
              limit 1)
           ) as body_text,
           (select comp->'example'->'body_text'->0
            from jsonb_array_elements(t.components) comp
            where comp->>'type' = 'BODY'
            limit 1) as example
    from public.template_inventory t
    where t.waba_id = v_waba
      and t.template_name = ml.template_name
    limit 1
  ) ti on true;

  return v_out;
end;
$$;

comment on function public.chat_cadence_history(uuid) is
  'Disparos de template do motor n8n (message_log) para o telefone+unidade da conversa, somente leitura, dedupados contra messages por wa_message_id. Corpo do template resolvido de template_inventory (BODY). Gated por chat_user_has_unit.';

revoke all on function public.chat_cadence_history(uuid) from public;
grant execute on function public.chat_cadence_history(uuid) to authenticated;
