-- 0017_close_card_reregistered.sql
-- Captura, no encerramento, se o cartão do cliente foi recadastrado com sucesso
-- — relevante apenas para handoffs de "Recadastro de pagamento"
-- (handoff_reason = payment_re_register). Obrigatório na UI para esse motivo.
--
-- Ortogonal ao close_outcome: o cartão pode ter sido recadastrado mesmo num
-- fechamento que não é "resolvido" (e vice-versa) — por isso é coluna própria,
-- não derivada do desfecho.
--
-- Aditiva, mesmo padrão das colunas close_* (0011) e close_payment_method
-- (0015). Nullable: null = não se aplica (fechamentos fora de cartão / linhas
-- antigas).

alter table public.conversations
  add column if not exists close_card_reregistered boolean;

comment on column public.conversations.close_card_reregistered is
  'Cartão recadastrado com sucesso, preenchido no encerramento apenas para handoff_reason=payment_re_register (toggle obrigatório na UI). Ortogonal a close_outcome.';
