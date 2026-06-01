-- 0013_crm_name_resolution.sql
-- ---------------------------------------------------------------------------
-- Resolve o NOME VALIDADO (tabela de cobrança) para exibição.
--
-- O nome exibido vinha de contacts.name (perfil do WhatsApp), que com frequência
-- é emoji/apelido/lixo ("um mano aí", "🇧🇷 Fulano", "KIBÃO Culinária…"). O nome
-- tratado — o mesmo que a IA usa para falar com o cliente — vive em
-- clientes_cobranca_dashboard.name, casado por unit_id + telefone normalizado
-- (chat_phone_match_key). Mesma regra que chat_debtor_context (0007/0008) já usa
-- para a conversa aberta; aqui é a versão EM LOTE, para a lista do inbox.
--
-- A formatação para "Primeiro Último" (Title Case) é feita no app
-- (lib/format/name.ts) — o banco devolve o nome cru.
-- ---------------------------------------------------------------------------

-- PASSO 1 (manual / fora de transação) — índice funcional na tabela do n8n.
-- A lista carrega ~400 conversas; sem índice o cruzamento com as ~96k linhas de
-- cobrança estoura (timeout). Este índice torna cada lookup um index scan
-- (~25ms para o lote de 396). É ADITIVO (só leitura fica mais rápida; nada de
-- schema/dado muda). Criado com CONCURRENTLY para NÃO travar as escritas que a
-- IA do n8n faz nesta tabela em produção. CONCURRENTLY não roda dentro de
-- transação — por isso fica fora da migration transacional, rodar uma vez:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ccd_unit_matchkey
--     ON public.clientes_cobranca_dashboard (unit_id, public.chat_phone_match_key(whatsapp));

-- PASSO 2 — RPC de leitura em lote (objeto nosso, transacional).
create or replace function public.chat_debtor_names(p_conversation_ids uuid[])
returns table (conversation_id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cv.conversation_id, d.name
  from (
    select co.id as conversation_id, co.unit_id,
           public.chat_phone_match_key(c.wa_id) as key
    from public.conversations co
    join public.contacts c on c.id = co.contact_id
    where co.id = any(p_conversation_ids)
      and public.chat_user_has_unit(co.unit_id)
  ) cv
  join lateral (
    select d.name
    from public.clientes_cobranca_dashboard d
    where d.unit_id = cv.unit_id
      and public.chat_phone_match_key(d.whatsapp) = cv.key
      and d.name is not null and length(trim(d.name)) > 0
    order by d.bi_atual desc nulls last, d.updated_at desc nulls last, d.matricula asc
    limit 1
  ) d on true
  where cv.key is not null;
$$;

comment on function public.chat_debtor_names(uuid[]) is
  'Nome validado (clientes_cobranca_dashboard.name) por conversa, em lote, para a lista do inbox. Casado por unit_id + chat_phone_match_key. Read-only, RLS-scoped via chat_user_has_unit.';

revoke all on function public.chat_debtor_names(uuid[]) from public;
grant execute on function public.chat_debtor_names(uuid[]) to authenticated, service_role;
