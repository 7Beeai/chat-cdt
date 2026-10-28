-- 0032_patrocinio_pool_sem_trilho.sql
-- Patrocínio (28/10/2026, pedido da unidade via Victor): rodízio igual para
-- todo mundo, independente do assunto. Remove a separação por trilho da 0030
-- (Melyna/Kamila = cobrança, Neuber = relacionamento): trilho NULL = atende
-- cobrança E relacionamento. Funções da 0030 ficam como estão (NULL já era o
-- comportamento "atende tudo"). Efeito colateral: o SLA de 30 min passa a
-- devolver também as conversas do Neuber (grupo deixa de ser de 1).
-- Aplicada ao vivo pela Management API em 28/10/2026.
update public.chat_auto_assign_pool
   set trilho = null
 where unit_id = 'd6e66926-c42c-4ec6-970b-c38d3642fa59';
