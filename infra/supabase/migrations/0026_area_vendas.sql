-- 0026_area_vendas.sql
-- ---------------------------------------------------------------------------
-- Área de Vendas (monitor ao vivo do trilho da Josi) — sessão 2026-08-10.
--
-- Contexto: as conversas de VENDAS acontecem em números próprios por unidade
-- (unit_sales_config.phone_number_id, roteadas por número de DESTINO no n8n).
-- Elas ficam 100% com a IA (routing='ai') e por design NUNCA aparecem na
-- inbox de handoffs. A Área de Vendas (/vendas) é um monitor: lista TODAS as
-- conversas dos números de vendas, em tempo real, somente leitura.
--
-- Pré-requisito de dados (aplicado direto em prod, 2026-08-10, fora desta
-- migration): as 6 linhas de chat_phone_numbers dos números de vendas
-- (SPB/VIT/PAT/CGT/MGC/TT) + 2 wabas novas (TT 4411556725747181,
-- MGC 1590169158752806 — WABAs pós-troca de 05/08). Sem esse cadastro o
-- webhook do chat descarta o inbound e chat_record_outbound_message lança
-- exceção (o nó do n8n tem onError=continue, então falhava em silêncio).
--
-- A. chat_vendas_phone_rows — quais linhas de chat_phone_numbers são números
--    de vendas. É o classificador da área: conversa de vendas = conversa cujo
--    conversations.phone_number_id (uuid) está neste conjunto. Devolve também
--    o `ativo` do unit_sales_config: o app filtra ativo=true, o que hoje
--    exclui Formiga (número compartilhado cobrança+relacionamento, vendas
--    desligada) — sem o filtro, as conversas de cobrança de Formiga vazariam
--    para a área de vendas.
--
-- B. chat_vendas_lead_estados — estado do funil (vendas_leads) por conversa,
--    em lote, casado por unidade + telefone normalizado (chat_phone_match_key
--    cobre o 9º dígito BR). Badge de funil na lista.
--
-- Tudo SECURITY DEFINER gated por chat_user_has_unit, somente leitura,
-- nenhuma tabela do n8n é alterada (mesmo padrão das migrations 0016/0019).
-- ---------------------------------------------------------------------------

-- A. Números de vendas visíveis para o usuário -------------------------------
create or replace function public.chat_vendas_phone_rows()
returns table (
  phone_row_id uuid,
  unit_id uuid,
  phone_number_id text,
  display_phone text,
  vendas_ativo boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pn.id, w.unit_id, pn.phone_number_id, pn.display_phone, usc.ativo
  from public.unit_sales_config usc
  join public.chat_phone_numbers pn on pn.phone_number_id = usc.phone_number_id
  join public.wabas w on w.id = pn.waba_id
  where public.chat_user_has_unit(w.unit_id);
$$;

comment on function public.chat_vendas_phone_rows() is
  'Linhas de chat_phone_numbers que são números de VENDAS (unit_sales_config), RLS-scoped por chat_user_has_unit. Classificador da Área de Vendas: conversa de vendas = phone_number_id neste conjunto. vendas_ativo espelha unit_sales_config.ativo (o app filtra true).';

revoke all on function public.chat_vendas_phone_rows() from public;
grant execute on function public.chat_vendas_phone_rows() to authenticated;

-- B. Estado do funil por conversa, em lote -----------------------------------
create or replace function public.chat_vendas_lead_estados(
  p_conversation_ids uuid[]
)
returns table (
  conversation_id uuid,
  estado text,
  matricula text,
  link_enviado_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, vl.estado, vl.matricula, vl.link_enviado_at
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  cross join lateral (
    select l.estado, l.matricula, l.link_enviado_at
    from public.vendas_leads l
    where l.unit_id = c.unit_id
      and public.chat_phone_match_key(l.wa_id)
        = public.chat_phone_match_key(ct.wa_id)
    order by l.updated_at desc
    limit 1
  ) vl
  where c.id = any(p_conversation_ids)
    and public.chat_user_has_unit(c.unit_id);
$$;

comment on function public.chat_vendas_lead_estados(uuid[]) is
  'Estado do funil de vendas (vendas_leads) por conversa, em lote via POST. Casa por unidade + chat_phone_match_key (9º dígito BR). Conversa sem lead simplesmente não retorna linha. Gated por chat_user_has_unit.';

revoke all on function public.chat_vendas_lead_estados(uuid[]) from public;
grant execute on function public.chat_vendas_lead_estados(uuid[]) to authenticated;
