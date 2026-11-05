-- 0034 — motivo real do repasse (04/11/2026, GO Victor)
-- `handoff_reason` tem 4 valores e 86% dos repasses caem em other_support; o `contexto` que a IA
-- manda em agent_transfer_human (edge agent-tools, repo CPT) era só logado. Agora fica na conversa:
-- o operador lê o resumo antes de abrir e a medição por motivo deixa de depender de regex.
-- Aditiva. Sobrescrito a cada novo repasse (o histórico da IA já está em messages).
alter table public.conversations add column if not exists handoff_context text;
comment on column public.conversations.handoff_context is
  'Texto que a IA passou no repasse (contexto da tool agent_transfer_human / ai_no_response). Gravado pela edge agent-tools. 04/11/2026.';
