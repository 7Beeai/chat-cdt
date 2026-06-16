-- 0021_idx_conv_waiting.sql
--
-- Perf fix (2026-06-16): a inbox ("Aguardando") faz, a cada carregamento,
--   SELECT id FROM conversations
--    WHERE status='open' AND routing IN ('queued','human') AND assigned_operator_id IS NULL
-- + um COUNT exato (paginacao do PostgREST). Sem indice cobrindo esse predicado,
-- o planner fazia Seq Scan em ~23k linhas open e aplicava a RLS chat_user_has_unit()
-- por linha. Com varios operadores carregando a inbox ao mesmo tempo, dezenas dessas
-- execucoes empilhavam, saturavam a CPU da instancia e cada uma levava ~3 min
-- (efeito bola de neve). Latencia de qualquer query no projeto subia pra 4-18s,
-- derrubando dashboard E chat-cdt (mesmo Supabase).
--
-- Indice parcial que cobre filtro (status, routing) + ordenacao (priority, last_inbound_at)
-- da aba Aguardando, restrito a conversas sem dono. Index Only Scan no lugar do Seq Scan.
--
-- Aplicado em prod via CREATE INDEX CONCURRENTLY (online, sem lock). Aqui sem
-- CONCURRENTLY porque migrations rodam em transacao; em DB novo o build e instantaneo.

CREATE INDEX IF NOT EXISTS idx_conv_waiting
  ON public.conversations (status, routing, priority DESC, last_inbound_at DESC)
  WHERE assigned_operator_id IS NULL;
