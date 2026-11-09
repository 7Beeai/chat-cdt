-- 0036_patrocinio_eunice_relacionamento.sql
-- Patrocínio (09/11/2026, pedido via Victor): volta a separar o rodízio por trilho.
--   * Eunice entra no pool SOMENTE relacionamento (grupo de 1: SLA não devolve,
--     a conversa fica com ela).
--   * Melyna, Kamila e Neuber = SOMENTE cobrança (inclui trilho desconhecido,
--     que já cai no grupo de cobrança pela 0030).
-- Funções da 0030 ficam como estão. Sabrina segue is_active=false.
-- Aplicada ao vivo pela Management API em 09/11/2026 (GO Victor). Na mesma hora, 4 conversas
-- abertas de relacionamento da Melyna passaram para a Eunice (evento reassigned, actor NULL).

insert into public.chat_auto_assign_pool (unit_id, operator_id, sort_order, is_active, trilho)
values ('d6e66926-c42c-4ec6-970b-c38d3642fa59', 'f7bb144c-e2aa-40df-ab14-3f191af5de43', 4, true, 'relacionamento')
on conflict (unit_id, operator_id) do update set is_active = true, trilho = 'relacionamento';

update public.chat_auto_assign_pool
   set trilho = 'cobranca'
 where unit_id = 'd6e66926-c42c-4ec6-970b-c38d3642fa59'
   and operator_id in (
     'de3203d6-a309-461d-9679-b6c29ecd853a',  -- Melyna
     'f73133d6-3610-4214-9677-187d9db2f548',  -- Kamila Silva
     '0fe48726-b987-4952-a571-208c8c8b58b3'   -- Neuber
   );
