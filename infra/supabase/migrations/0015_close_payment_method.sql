-- 0015_close_payment_method.sql
-- Captures, on close, WHICH payment method the customer re-registered — but
-- only relevant for "Recadastro de pagamento" handoffs closed as "resolvido".
-- The UI shows the field conditionally; this column just stores the choice.
--
-- Additive, same pattern as the close_* columns from migration 0011. Free text
-- (not an enum) so the option list can evolve without a migration; the UI
-- constrains it to the canonical cobrança vocabulary (CARTÃO DE CRÉDITO, PIX,
-- …) so reports stay groupable and aligned with the n8n side.

alter table public.conversations
  add column if not exists close_payment_method text;

comment on column public.conversations.close_payment_method is
  'Forma de pagamento recadastrada, preenchida no encerramento apenas para handoff_reason=payment_re_register com close_outcome=resolvido. Valores canônicos espelham clientes_cobranca_dashboard."forma de pagamento".';
