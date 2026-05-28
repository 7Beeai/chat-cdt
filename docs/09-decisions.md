# 9. Decisões — ADR log

Formato leve. Uma decisão = uma seção. Data + status + contexto + decisão + consequências.

---

## ADR-001 — Segundo Meta App assinado nas mesmas WABAs

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Meta limita 1 webhook por App. O fluxo n8n existente já usa um App. Migrar tudo pro CHAT-CDT levaria semanas e quebraria a operação.

**Decisão**: Criar um Meta App paralelo ("CHAT-CDT") e assinar nele as mesmas WABAs via `POST /{waba_id}/subscribed_apps`. Cada app recebe sua cópia dos eventos no callback próprio. Outbound usa System User token + `phone_number_id`, independente de quem "é dono".

**Consequências**:
- ✅ Zero impacto no n8n.
- ✅ Webhook fail-isolated (problema num não afeta o outro).
- ⚠ Auditoria duplicada (cada app tem seu log de eventos) — aceitável.

---

## ADR-002 — Single Next.js (webhook + UI + API + cron)

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Plano original (`plano.md`) avaliou separação webhook/UI; rejeitada por aumentar superfície e tempo de bring-up.

**Decisão**: Tudo num único processo Node, deploy via PM2 + Caddy.

**Consequências**:
- ✅ Compartilha clientes Supabase/Graph. Menos código de cola.
- ✅ Uma URL pra TLS. Um log pra debugar.
- ⚠ Se webhook saturar, UI degrada junto. Mitigação: extrair `app/api/meta/webhook/route.ts` para serviço próprio sem refactor — código já é stateless.

---

## ADR-003 — Reuso de `units` como tenant, `profiles+user_units` como operadores

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Análise via MCP do banco vivo mostrou que o n8n já tem `units` (tenant de facto) + `profiles` (operadores) + `user_units` (atribuição). Criar tabelas paralelas duplicaria identidade e quebraria SSO.

**Decisão**: CHAT-CDT NÃO cria `tenants` nem `operators`. FK em `units.id` direto. RLS via helper `chat_user_has_unit(target)` que percorre `auth.uid() → profiles → user_units`.

**Consequências**:
- ✅ Operador cadastrado uma vez serve para n8n dashboards + CHAT-CDT.
- ⚠ Não controlamos o schema de `profiles`/`user_units`. Mudanças quebrariam o helper. Aceitável — schema é estável.

---

## ADR-004 — `conversations.routing` como fonte de verdade do handoff

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Duas alternativas avaliadas:
- (a) Reusar `clientes_cobranca_setembro.cadence_branch_state` (`em_conversa_ia`/etc).
- (b) Coluna nova `routing` em `conversations`.

**Decisão**: (b). `clientes_cobranca_setembro` é volátil (clientes entram/saem todo dia) e seu state machine pertence à cadência interna do n8n — não deve definir nossa modelagem.

**Consequências**:
- ✅ Modelo limpo e independente do churn da base.
- ⚠ Exige 2-3 ajustes SQL no fluxo n8n (gravar outbound, escrever routing, ler routing). Usuário confirmou aceite. Detalhe em `04-n8n-contract.md`.

---

## ADR-005 — Contacts por `wa_id`, matrícula opcional em jsonb

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Contato pode existir antes de virar devedor da base atual, ou continuar existindo depois do churn.

**Decisão**: `contacts` key por `(unit_id, wa_id)`. `profile jsonb` guarda matrícula e enriquecimento quando disponível. UI puxa contexto do débito via JOIN sob demanda.

**Consequências**:
- ✅ Robusto contra rotatividade da base.
- ⚠ Operador precisa de query extra para ver dados do débito. Aceitável.

---

## ADR-006 — Tabelas próprias do CHAT-CDT, não alterar tabelas do n8n

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: `message_log` (159k linhas) e `message_inbound` (11k) já existem com schema do n8n. Adicionar `conversation_id` neles seria invasivo.

**Decisão**: Tabela `messages` própria. n8n grava cópia do outbound da IA aqui via SQL (ajuste 1 do contrato).

**Consequências**:
- ✅ Zero risco no fluxo de cobrança.
- ⚠ Duplicação de dados de outbound (cópia em `message_log` + em `messages`). Volume aceitável; n8n grava ~150 outbound/dia.

---

## ADR-007 — Push fanout via trigger pg_net

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Operador precisa de notificação push em <1s do handoff. Opções: pg_notify (precisa listener Node), trigger pg_net (faz HTTP do banco), webhook do Realtime (sem garantia de entrega ao endpoint interno).

**Decisão**: Trigger `chat_notify_handoff` em UPDATE de `routing`. Usa `net.http_post()` para chamar `/api/internal/push/notify`, que faz fanout via `web-push`.

**Consequências**:
- ✅ Sem fila externa, sem listener Node, sem polling.
- ✅ Recupera-se sozinho se app reiniciar (Meta retenta + trigger é re-disparado em retry).
- ⚠ Depende de 2 GUCs (`app.app_origin`, `app.cron_secret`). Sem eles, no-op. Documentado em `06-setup.md`.

---

## ADR-008 — Race guard via UNIQUE INDEX parcial

**Data**: 2026-05-27
**Status**: Aceito (advisor flagou)
**Contexto**: n8n e CHAT-CDT podem receber o mesmo inbound ao mesmo tempo. Ambos tentariam criar conversation com `status='open'` para o mesmo contato.

**Decisão**: `CREATE UNIQUE INDEX uniq_open_conv_per_contact ON conversations (contact_id) WHERE status = 'open'`. Webhook trata `23505` (unique_violation) com re-SELECT.

**Consequências**:
- ✅ Coerência garantida no DB.
- ⚠ Apenas uma conversa "aberta" por contato. Para reabertura, precisa fechar a anterior. Match com o modelo de atendimento.

---

## ADR-009 — Schema com prefixo `chat_` quando há risco de colisão

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Banco vivo tem 40+ tabelas. `webhook_events_log` já existe (do n8n). Enums como `routing_state` poderiam colidir no futuro.

**Decisão**: Prefixo `chat_` em todos os enums + tabelas onde havia ou poderia haver colisão (`chat_phone_numbers`, `chat_push_subscriptions`, `chat_webhook_events`, todos os 6 enums). Tabelas com nomes não conflitantes (`wabas`, `contacts`, `conversations`, `messages`) ficaram sem prefixo.

**Consequências**:
- ✅ Convivência sem ambiguidade.
- ⚠ Inconsistência de naming. Aceitável — usabilidade dentro do CHAT-CDT é prioridade, e tabelas centrais (messages/conversations/contacts) leem natural sem prefixo.

---

## ADR-010 — Hardening: search_path fixo + EXECUTE revogado nas SECURITY DEFINER

**Data**: 2026-05-27
**Status**: Aceito (advisor flagou)
**Contexto**: Linter do Supabase sinalizou:
- 3 funções com `search_path` mutável (SQL injection via search_path hijack)
- 2 funções `SECURITY DEFINER` callable por `anon`/`authenticated` via `/rest/v1/rpc/...`

**Decisão**: `ALTER FUNCTION ... SET search_path = public, pg_temp` nas 3. `REVOKE EXECUTE ... FROM anon, authenticated, public` em `chat_notify_handoff` (função de trigger, jamais invocada via RPC). Para `chat_user_has_unit`: `REVOKE FROM anon, public` mas **GRANT EXECUTE TO authenticated** — esta função é invocada pelas RLS policies das nossas tabelas, e quando um operador `authenticated` faz SELECT, o Postgres avalia a policy usando os privilégios dele e precisa de EXECUTE na função.

**Consequências**:
- ✅ Funções de trigger continuam funcionando (são invocadas pelo sistema de triggers, sem EXECUTE check).
- ✅ RLS policies das nossas tabelas funcionam para operadores logados.
- ⚠ `chat_user_has_unit` continua flagada pelo `anon_security_definer_function_executable` advisor (é callable por `authenticated` via /rest/v1/rpc). Implicação real é mínima: ela só responde se o auth.uid() atual tem acesso à unit X — info que o próprio usuário deriva lendo `conversations`.
- ⚠ Correção tardia (sessão 2): o REVOKE original foi aplicado em todos os roles em 0001_init.sql, quebrando todas as queries em `/inbox` com `42501 permission denied for function chat_user_has_unit`. Migration `chat_cdt_rls_helper_grant` aplicada para corrigir, e o `0001_init.sql` no repo foi atualizado para refletir o estado final.

---

## ADR-011 — Documentação versionada + memórias persistentes para continuidade entre sessões

**Data**: 2026-05-27
**Status**: Aceito
**Contexto**: Usuário levantou risco de perda de contexto entre sessões Claude. Projeto tem decisões grandes que não devem se perder.

**Decisão**:
- `CLAUDE.md` na raiz (auto-load em sessões Claude Code) com orientação enxuta.
- `docs/` versionado no git com 9 capítulos: overview, architecture, database, n8n-contract, code-map, setup, deployment, status, decisions.
- Memórias em `~/.claude/projects/.../memory/` para fatos durables (user, project, schema, feedback).
- `docs/08-status.md` é atualizado ao fim de cada sessão.

**Consequências**:
- ✅ Sessão futura (humano ou Claude) lê CLAUDE.md → docs/README.md → status.md e em 5min sabe onde parou.
- ⚠ Custo de manutenção: documentação tem que acompanhar mudanças reais. Mitigação: status.md é o único arquivo que muda toda sessão; o resto muda em decisões grandes.

---

## Template para próximas decisões

```markdown
## ADR-XXX — <título curto>

**Data**: YYYY-MM-DD
**Status**: Proposto | Aceito | Rejeitado | Superado por ADR-YYY
**Contexto**: <o problema e as alternativas consideradas>
**Decisão**: <o que foi decidido, em uma ou duas frases>
**Consequências**:
- ✅ <ganho>
- ⚠ <custo / risco>
```
