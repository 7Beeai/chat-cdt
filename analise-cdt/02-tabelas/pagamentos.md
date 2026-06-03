# pagamentos

## Identificação

- **Nome**: `public.pagamentos`
- **Dono provável**: **n8n / domínio Cobrança**. Não é criada por nenhuma migration do CHAT-CDT (`infra/supabase/migrations/`); só aparece em `0008_debtor_context_enriched.sql`, e ali apenas como **leitura** dentro do RPC `chat_debtor_context`. As policies usam `user_has_access_to_unit` (não os helpers `chat_*`), reforçando origem fora do CHAT-CDT.
- **Linhas estimadas**: **≈ 22.662** (`linhas_estimadas`, bloco-01). Atenção: `n_live_tup=377`, `n_tup_ins=377`, `n_tup_upd=67`, `n_dead_tup=63` são números da **janela do snapshot (~13h)** e não refletem o regime permanente — `last_analyze`/`last_autoanalyze` estão **null**, então as estatísticas vivas estão desatualizadas. Use ~22,6k como proxy de tamanho real.
- **Tamanho**: 20 MB total (`bytes_total=20.529.152`); heap 7520 kB — o restante é índice (14 índices, ver seção). Bloat por linha não é alarmante (~906 bytes/linha sobre 22,6k), mas há **forte excesso de índices** (≈12,8 MB em índices vs 7,3 MB de heap).
- **Classificação**: **Cobrança** (confirmado).
- **Alerta de bloat**: heap saudável; o desperdício real é em **índices nunca usados** (≈4,08 MB, ver seção própria) e índices redundantes.

## Finalidade

Histórico completo e append-mostly de todos os pagamentos realizados pelos inadimplentes (PIX via Woovi/OpenPix, Abacate Pay e cartão via Stripe). Permite múltiplos pagamentos por `matricula`. É a fonte canônica de "quem pagou": alimenta as views de dashboard `*_mes_atual` (arrecadação, estornos, ganhos/comissão por unidade), os guards de trigger que marcam clientes de cobrança como pagos, a reconciliação de webhooks faltantes (crons `reconcile-*-pull`), o motor v2 (contagem de pagadores do dia) e o contexto de devedor exibido no CHAT-CDT. Escrita central pelo RPC idempotente `register_payment` (upsert por `correlation_id`); reembolsos por `mark_refund_by_correlation`.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('pagamentos_id_seq')` | sequence (default) | `link_payout_charges` (READ id→`payout_pagamentos`), `get_pay_receipt` lookup, FKs `pagamentos_orfaos.pagamento_id` e `payout_pagamentos.pagamento_id`, `register_payment` (checa `already_existed`), PostgREST UPDATE baixa (`WHERE id=$`) | confirmado (functions-analysis, bloco-03, bloco-10b) |
| 2 | matricula | text | NO | — | `register_payment` (upsert) | `get_pay_receipt`, `get_regua_totals`(via classified), guards `guard_recent_payment_dashboard`/`guard_recent_payment_setembro` (match por matricula), `motor_v2_get_disparos` (exists por matricula), `chat_debtor_context` (filtro), `link_payout_charges`; índice `idx_pagamentos_matricula` (156727 scans) | confirmado (functions-analysis, bloco-04) |
| 3 | name | text | YES | — | `register_payment` (upsert) | `get_pay_receipt` (READ `name`) | confirmado (functions-analysis) |
| 4 | whatsapp | text | YES | — | `register_payment` (upsert) | **sem consumidor identificado** (nenhuma função/edge/view/stat lê `whatsapp` de `pagamentos`) | inferido (ausência em todas as fontes de leitura) |
| 5 | data_pagamento | timestamptz | NO | — | `register_payment` (upsert) | views `cobranca_diaria_mes_atual`, `estornos_mes_atual`, `ganhos_mes_atual`; `get_regua_totals`, `get_pay_receipt`, `check_data_freshness`, guards; PostgREST/dashboard (milhares de calls filtrando por `data_pagamento`); `chat_debtor_context` (order by); índice `idx_pagamentos_data` (35067 scans) | confirmado (views-analysis, functions-analysis, bloco-10a/b) |
| 6 | valor | numeric(10) | NO | — | `register_payment` (upsert, vem do gateway) | views `*_mes_atual`, `get_regua_totals`, `get_pay_receipt`, `link_payout_charges` (`valor_bruto_cents`), `chat_debtor_context` (soma/total), PostgREST dashboard | confirmado (views-analysis, functions-analysis). **Armazenado em CENTAVOS** — ver Observações |
| 7 | regua | text | YES | — | `register_payment` (upsert) | `get_regua_totals` (bucketiza NR/1/2/demais), PostgREST (queries `SELECT regua,valor`) | confirmado (functions-analysis, bloco-10a/b) |
| 8 | forma_pagamento | text | YES | — | `register_payment` (upsert) | guards `guard_recent_payment_*` (preenchem `plataforma_pagamento_utilizada` na cobrança), `chat_debtor_context` (`forma`), `process-reembolso` edge (READ) | confirmado (functions-analysis, edge-functions, migration 0008) |
| 9 | comprovante | text | YES | — | `register_payment` (upsert); **stripe-webhook** UPDATE (op=update, cols inclui `comprovante`) | **sem consumidor identificado** (escrita por 2 writers, mas nenhuma leitura encontrada em func/edge/view/stat) | inferido (presente só em writes) |
| 10 | correlation_id | text | YES | — | `register_payment` (upsert; chave do ON CONFLICT) | chave de junção em quase tudo: `buscar_links_resgate`/`_pendente`, `cancel_pending_links_on_payment`, `cleanup_expired_links`, `get_pay_receipt`, `guard_recent_payment_dashboard`, `mark_refund_by_correlation` (lookup), `link_payout_charges`, edges stripe/abacate/woovi e crons `reconcile-*` (resolvem pagamento); índices `pagamentos_correlation_id_unique` (113010 scans) e `_key` (846) | confirmado (functions-analysis, edge-functions, bloco-04) |
| 11 | baixa_realizada | boolean | YES | `false` | **App via PostgREST** (UPDATE direto, calls=63) | `chat_debtor_context` (`baixa_realizada` no JSONB do CHAT-CDT) | confirmado (bloco-10b UPDATE, migration 0008) |
| 12 | baixa_realizada_at | timestamptz | YES | — | App via PostgREST (UPDATE junto de `baixa_realizada`) | **sem consumidor identificado** | inferido (presente só no UPDATE PostgREST) |
| 13 | baixa_realizada_by | uuid | YES | — | App via PostgREST (UPDATE) | **sem consumidor de leitura**; carrega FK→`users.id` (auditoria); índice `idx_pagamentos_baixa_by` **NUNCA USADO** | inferido (bloco-10b, bloco-03, bloco-04) |
| 14 | reembolso_realizado | boolean | YES | `false` | `mark_refund_by_correlation` (UPDATE) | views `estornos_mes_atual` (=true) e `cobranca_diaria`/`ganhos` (IS NOT TRUE), `get_regua_totals`, `check_data_freshness`, guards, `process-reembolso`/`generate-payment-link` edges, PostgREST | confirmado (functions-analysis, views, edge-functions) |
| 15 | reembolso_realizado_at | timestamptz | YES | — | `mark_refund_by_correlation` (UPDATE) | **sem consumidor identificado** | inferido (só write) |
| 16 | reembolso_realizado_by | uuid | YES | — | `mark_refund_by_correlation` (UPDATE) | **sem consumidor de leitura**; FK→`users.id`; índice `idx_pagamentos_reembolso_by` **NUNCA USADO** | inferido (functions-analysis, bloco-03/04) |
| 17 | reembolso_motivo | text | YES | — | `mark_refund_by_correlation` (UPDATE) | **sem consumidor identificado** | inferido (só write) |
| 18 | unit_id | uuid | NO | — | `register_payment` (upsert) | views `cobranca_diaria`/`ganhos` (group/join por unidade), `link_payout_charges`, `motor_v2_get_disparos`, `chat_debtor_context` (filtro), todas as policies RLS (`user_has_access_to_unit(unit_id)`), `process-reembolso`; FK→`units.id`; índice `idx_pagamentos_unit_data` (1643 scans) | confirmado (views, functions, policies, bloco-03) |
| 19 | created_at | timestamptz | NO | `now()` | default | `register_payment` (checa `already_existed`), `motor_v2_get_disparos` (`created_at::date = hoje`), `get_pay_receipt`, `mark_refund_by_correlation` (order by recente) | confirmado (functions-analysis, bloco-10a query motor v2) |
| 20 | updated_at | timestamptz | NO | `now()` | trigger `update_pagamentos_updated_at` (BEFORE UPDATE) | **sem consumidor identificado** | inferido (escrita por trigger, sem leitura nas fontes) |
| 21 | gateway_charge_id | text | YES | — | `register_payment` (upsert); **stripe-webhook** UPDATE | reconciliação `reconcile-stripe-pull` (READ p/ checar ingestão); índice parcial `idx_pagamentos_gateway_charge_id` (WHERE NOT NULL) **NUNCA USADO** | inferido (edge stripe READ/UPDATE; índice 0 scans) |

> Ordinais 1–21 contíguos: **nenhuma coluna droppada** (sem gaps).

## Relacionamentos (FKs)

Saindo de `pagamentos`:
- `baixa_realizada_by` → `users.id` (`pagamentos_baixa_realizada_by_fkey`, ON DELETE no action). Auditoria de quem deu baixa.
- `reembolso_realizado_by` → `users.id` (`pagamentos_reembolso_realizado_by_fkey`, ON DELETE no action). Auditoria de quem reembolsou.
- `unit_id` → `units.id` (`pagamentos_unit_id_fkey`, ON DELETE no action). Tenant/franquia.

Apontando para `pagamentos`:
- `pagamentos_orfaos.pagamento_id` → `pagamentos.id` (ON DELETE **SET NULL**) — pagamentos que viraram órfãos antes de resolver matrícula.
- `payout_pagamentos.pagamento_id` → `pagamentos.id` (ON DELETE **RESTRICT**) — vínculo de charge a um payout (taxa 80 centavos por charge, ver `link_payout_charges`).

## Índices

14 índices no total.

| índice | scans | bytes | papel |
|--------|-------|-------|-------|
| `pagamentos_pkey` (PK, id) | 2837 | 638976 | chave primária |
| `idx_pagamentos_matricula` | 156727 | 909312 | lookup por matrícula (guards, motor, debtor_context) — quente |
| `pagamentos_correlation_id_unique` (UNIQUE parcial, WHERE NOT NULL) | 113010 | 1892352 | idempotência do upsert — quente |
| `idx_pagamentos_data` (data_pagamento) | 35067 | 638976 | filtros de período do dashboard — quente |
| `idx_pagamentos_unit_data` (unit_id, data_pagamento DESC) | 1643 | 1720320 | views por unidade |
| `pagamentos_correlation_id_key` (UNIQUE full) | 846 | 2097152 | unique adicional (redundante, ver Observações) |
| `idx_pagamentos_unit_id` (unit_id) | 14 | 327680 | quase-redundante (prefixo de `unit_data`) |
| `idx_pagamentos_reembolso_realizado` | 4 | 286720 | pouco usado |

### Índices nunca usados (idx_scan=0) — desperdício ≈ 4,08 MB

| índice | bytes | observação |
|--------|-------|-----------|
| `idx_pagamentos_correlation_id` (plain) | 2.023.424 | redundante: já há 2 UNIQUE em `correlation_id` |
| `idx_pagamentos_gateway_charge_id` (parcial) | 712.704 | só haveria leitura via reconcile-stripe-pull, mas 0 scans na janela |
| `idx_pagamentos_data_pagamento` | 679.936 | **duplicata exata** de `idx_pagamentos_data` (que tem 35067 scans) |
| `idx_pagamentos_baixa_by` (baixa_realizada_by) | 294.912 | FK index sem leitura |
| `idx_pagamentos_baixa_realizada` | 294.912 | flag sem leitura indexada |
| `idx_pagamentos_reembolso_by` (reembolso_realizado_by) | 270.336 | FK index sem leitura |
| **Soma** | **4.276.224 B (≈4,08 MB)** | candidatos a DROP |

> Não incluídos na soma (near-dead, mas >0): `idx_pagamentos_reembolso_realizado` (4 scans) e `idx_pagamentos_unit_id` (14 scans).

## Triggers

- `update_pagamentos_updated_at` — BEFORE UPDATE, ROW, executa `update_updated_at_column()` (mantém `updated_at = now()`). Único trigger próprio.

> Observação: as funções `guard_recent_payment_dashboard`/`guard_recent_payment_setembro` e `cancel_pending_links_on_payment` são triggers, mas em **outras** tabelas (clientes_cobranca_*), que apenas **leem** `pagamentos`. Não há trigger AFTER INSERT na própria `pagamentos`.

## RLS / Policies

RLS habilitada (`rls_on=true`, `rls_forced=false`). 4 policies, **uma por comando, sem duplicação/sobreposição**:

| policy | cmd | regra |
|--------|-----|-------|
| Only admins can delete payments | DELETE | `user_roles.role = 'admin'` |
| Users can insert payments in their units | INSERT | `WITH CHECK user_has_access_to_unit(unit_id)` |
| Users can update payments from their units | UPDATE | `USING` e `WITH CHECK user_has_access_to_unit(unit_id)` |
| Users can view payments from their units | SELECT | `user_has_access_to_unit(unit_id)` |

As policies usam `user_has_access_to_unit` (helper do domínio Cobrança), **não** os helpers `chat_*` — coerente com a tabela ser de Cobrança. Como os writers principais (`register_payment`, `mark_refund_by_correlation`, edges de webhook) são **SECURITY DEFINER**, as policies governam de fato só o acesso via **PostgREST do app**: as leituras de dashboard (SELECT) e o UPDATE de baixa (`baixa_realizada*`, calls=63). `n_dead_tup=0` deleções na janela.

## Quem escreve / Quem lê

**Escreve:**
- `register_payment` (SECURITY DEFINER) — **writer central**. INSERT … ON CONFLICT (`correlation_id`) DO UPDATE → upsert das colunas: `correlation_id, matricula, name, whatsapp, valor, data_pagamento, regua, forma_pagamento, comprovante, unit_id, gateway_charge_id` (functions-analysis, confirmado). Chamado por edges `abacate-webhook`, `woovi-webhook`, `stripe-webhook` e crons `reconcile-abacate/woovi/stripe-pull`.
- `mark_refund_by_correlation` (SECURITY DEFINER) — UPDATE de `reembolso_realizado, reembolso_realizado_at, reembolso_motivo, reembolso_realizado_by` (functions-analysis). Chamado por `woovi-webhook`, `stripe-webhook`, `process-reembolso`. (A "dica" menciona `mark_refund`; o único writer de reembolso encontrado é `mark_refund_by_correlation` — não há função `mark_refund` separada nas fontes.)
- **App via PostgREST** — UPDATE direto de `baixa_realizada, baixa_realizada_at, baixa_realizada_by WHERE id=$` (bloco-10b, calls=63). É o registro de "baixa no sistema interno".
- **stripe-webhook** (edge) — UPDATE adicional de `correlation_id, gateway_charge_id, comprovante` (edge-functions).
- Trigger `update_updated_at_column` — escreve `updated_at`. Sequence escreve `id`; default escreve `created_at`.

**Lê:**
- **Views de dashboard** `cobranca_diaria_mes_atual`, `estornos_mes_atual`, `ganhos_mes_atual` (views-analysis) — fonte das métricas `*_mes_atual` (arrecadação, estornos, comissão por unidade). **Esta tabela é a fonte direta dessas views**, como indicado na dica.
- **Funções**: `get_regua_totals`, `get_pay_receipt`, `buscar_links_resgate(_pendente)`, `cancel_pending_links_on_payment`, `cleanup_expired_links`, `check_data_freshness`, `guard_recent_payment_dashboard`, `guard_recent_payment_setembro`, `link_payout_charges`, `motor_v2_get_disparos` (functions-analysis).
- **CHAT-CDT**: `chat_debtor_context(uuid)` (migration `0008`) lê `valor, data_pagamento, forma_pagamento, baixa_realizada` + filtra por `matricula/unit_id`; é o **único toque do CHAT-CDT** nesta tabela (read-only).
- **Edges**: `process-reembolso`, `generate-payment-link`, `generate-payment-link-abacate`, `reconcile-stripe/abacate/woovi-pull` (SELECT de `id, correlation_id, gateway_charge_id`, etc.).
- **PostgREST/dashboard** (bloco-10a/b): dezenas de assinaturas de query agregando `valor/data_pagamento/reembolso_realizado/regua/unit_id` — milhares de calls (ex.: 3230, 2117, 1061), os maiores consumidores de tempo da tabela na janela.

## Observações

- **Contradição doc↔banco (COMMENT errado)**: o COMMENT da coluna `valor` diz *"Valor do pagamento em reais"*, mas **todos** os leitores dividem por 100 (views `*_mes_atual`, `get_regua_totals`, `get_pay_receipt`, `chat_debtor_context`, dashboard). O valor está em **centavos**. A própria migration 0008 documenta "Valores em REAIS (origem em centavos)". O comentário da coluna é enganoso e deve ser corrigido — não tratar como fato.
- **Redundância de índices (headline)**:
  - `data_pagamento` está **duplicado**: `idx_pagamentos_data` (usado, 35067) vs `idx_pagamentos_data_pagamento` (0 scans). O segundo é puro desperdício.
  - `correlation_id` está **triplo-indexado**: duas UNIQUE (`_key` full 846 scans + `_unique` parcial 113010 scans) **mais** `idx_pagamentos_correlation_id` plain (0 scans). Duas UNIQUE na mesma coluna são redundantes para integridade (a full já proíbe duplicatas não-nulas); o plain é peso morto.
  - `unit_id` quase-redundante: `idx_pagamentos_unit_id` (14 scans) é prefixo do composto `idx_pagamentos_unit_data` (1643 scans).
- **8 colunas sem consumidor de leitura identificado**: `whatsapp`, `comprovante`, `baixa_realizada_at`, `reembolso_realizado_at`, `reembolso_motivo`, `updated_at` (6 puras) + `baixa_realizada_by`, `reembolso_realizado_by` (apenas FK/auditoria para `users.id`, sem query que as leia). Todas escritas por algum writer — não são "mortas", são **sem consumidor identificado** de leitura.
- **Estatísticas desatualizadas**: `last_analyze`/`last_autoanalyze`/`last_vacuum` todos null. Com ~22,6k linhas e `idx_scan=310133` (tabela quentíssima em leitura), vale rodar `ANALYZE public.pagamentos` para o planner não usar estatísticas estagnadas.
- **Sem coluna com espaço no nome.** Sem policies duplicadas.
- **Writers bypassam RLS** (SECURITY DEFINER), então o controle por unidade nas escritas é responsabilidade da lógica das funções/edges, não das policies.
