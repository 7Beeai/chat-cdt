-- 0023_close_no_reregister_reason.sql
-- Captura, no encerramento, o motivo estruturado quando o cartão NÃO foi
-- recadastrado (close_card_reregistered = false) — relevante apenas para
-- handoffs de "Recadastro de pagamento" (handoff_reason = payment_re_register).
--
-- Uma análise de junho/2026 mostrou que ~10 de 41 respostas "Não" eram na
-- verdade handoffs mal-classificados (não era recadastro) e ~5 eram
-- recadastro feito mas não marcado — por isso capturar o motivo em vez de
-- deixar o "Não" sem explicação.
--
-- Aditiva, nullable, idempotente — mesmo padrão de close_payment_method
-- (0015) e close_card_reregistered (0017). Free text (não enum) para o
-- picker evoluir sem migration.

alter table public.conversations
  add column if not exists close_no_reregister_reason text;

comment on column public.conversations.close_no_reregister_reason is
  'Motivo do não-recadastro, preenchido no encerramento apenas para handoff_reason=payment_re_register com close_card_reregistered=false. Valores canônicos: nao_era_recadastro | cliente_adiou | outro_canal | ja_regular | cliente_desistiu | pagou_avulso | outro. Texto livre para evoluir sem migration (mesmo padrão de close_payment_method).';
