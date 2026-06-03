# pagamentos_orfaos

## Identificação
- **Nome**: `public.pagamentos_orfaos`
- **Dono provável**: Cobrança (ecossistema n8n/pagamentos). **Não pertence ao CHAT-CDT** — nenhuma menção nas migrations `infra/supabase/migrations/` nem no código local (grep vazio em `*.ts/*.tsx/*.sql`).
- **Linhas estimadas**: ~97 (bloco-01 `linhas_estimadas=97`; PK `idx_tup_read=97`). Atenção: `n_live_tup=0` e `last_analyze=null` → estatísticas **nunca coletadas**, o planner está cego (não é tabela vazia).
- **Tamanho**: 456 kB total / 56 kB heap (bloco-01 `bytes_total=466944`). ~4,8 kB/linha sobre o heap real — bloat **moderado-alto**, esperado por `raw_payload jsonb` (payload bruto do gateway por linha) + 4 índices.
- **Classificação**: **Cobrança**.
- **Alerta de bloat**: o peso vem majoritariamente de `raw_payload` (jsonb completo do webhook). Aceitável para tabela de auditoria/reconciliação, mas cresce sem TTL conhecido.

## Finalidade
Caixa de entrada de pagamentos **não vinculáveis automaticamente** a uma matrícula/unidade. Quando um webhook (Woovi/Stripe) ou um cron de reconciliação (pull) recebe um pagamento cujo `correlation_id` não bate com nenhum link gerado e o telefone do pagador não resolve, o pagamento é gravado aqui (via `upsert onConflict source,gateway_correlation_id`) para **reconciliação manual ou automática posterior**. Um trigger dispara e-mail de alerta. As RPCs `auto_reconcile_orfaos`/`reconcile_orfao`/`descartar_orfao` resolvem ou descartam cada órfão.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('pagamentos_orfaos_id_seq')` | sequence (default) | `reconcile_orfao`, `descartar_orfao`, `auto_reconcile_orfaos` (filtro/PK), `notify-orphan-email` (count), Table Editor (bloco-10a) | confirmado (functions-analysis: reads `id`) |
| 2 | source | text | NO | — | writer: woovi-webhook / stripe-webhook / reconcile-woovi-pull / reconcile-stripe-pull (upsert) | `auto_reconcile_orfaos` (filtro `source`), `reconcile_orfao` (normaliza woovi/abacate→pix), `notify-orphan-email` (`.eq('source')` + burst), índice `_unique` | confirmado (edge-functions write/read; functions-analysis) |
| 3 | gateway_correlation_id | text | NO | — | writer: webhooks/pulls (upsert) | `reconcile_orfao` (register_payment), índice `_unique` (dedup) | confirmado (edge-functions; functions-analysis reads) |
| 4 | gateway_charge_id | text | YES | — | writer: webhooks/pulls (upsert) | `reconcile_orfao` (passa a register_payment) | confirmado (functions-analysis reads `gateway_charge_id`) |
| 5 | valor | numeric | NO | — | writer: webhooks/pulls (upsert) | `reconcile_orfao` (register_payment); `notify_orphan_payment_created` (payload NEW.valor) | confirmado (functions-analysis reads) |
| 6 | data_pagamento | timestamptz | NO | — | **Woovi**: do payload; **Stripe**: `new Date().toISOString()` (hora de ingestão, NÃO hora real do pagamento — caveat de qualidade) | `reconcile_orfao` (register_payment); `notify_orphan_payment_created` (NEW) | confirmado (edge-functions notes: stripe usa toISOString) |
| 7 | payer_name | text | YES | — | writer: webhooks/pulls (upsert) | `reconcile_orfao`; `notify_orphan_payment_created` (NEW) | confirmado |
| 8 | payer_phone | text | YES | — | writer: webhooks/pulls (upsert) | `reconcile_orfao`; `auto_reconcile_orfaos` (read); índice `idx_pagamentos_orfaos_payer`; `notify_orphan_payment_created` (NEW) | confirmado |
| 9 | payer_taxid | text | YES | — | writer: webhooks/pulls (upsert) | índice `idx_pagamentos_orfaos_payer` (CPF/CNPJ) | inferido (escrito por upsert; leitura só via índice parcial, sem consumidor de SELECT capturado) |
| 10 | matricula_informada | text | YES | — | writer: **apenas paths Stripe** (stripe-webhook, reconcile-stripe-pull) — em órfãos Woovi fica NULL | sem consumidor de leitura identificado nas fontes | inferido (edge-functions: só upserts Stripe listam a coluna) |
| 11 | raw_payload | jsonb | NO | — | writer: webhooks/pulls (upsert; payload bruto do gateway) | sem consumidor programático identificado (auditoria/inspeção manual) | inferido (escrito por todos os upserts; nenhum reader o desserializa) |
| 12 | reconciliado | boolean | NO | `false` | default; flip por `reconcile_orfao`/`descartar_orfao` | `auto_reconcile_orfaos` (filtro `=false`), índices parciais `_payer`/`_pendentes` | confirmado (functions-analysis read/write) |
| 13 | reconciliado_at | timestamptz | YES | — | `reconcile_orfao`, `descartar_orfao` (write `now()`) | sem consumidor de leitura identificado (auditoria) | confirmado (write); leitura inferida |
| 14 | reconciliado_by | uuid | YES | — | `reconcile_orfao`, `descartar_orfao` (write) | sem consumidor de leitura identificado (rastreabilidade do operador) | confirmado (write) |
| 15 | matricula_reconciliada | text | YES | — | `reconcile_orfao` (write matrícula final vinculada) | sem consumidor de leitura identificado | confirmado (functions-analysis write) |
| 16 | pagamento_id | bigint | YES | — (FK→pagamentos.id) | `reconcile_orfao` (write após register_payment) | `reconcile_orfao` (read/write); FK | confirmado (functions-analysis read+write) |
| 17 | motivo_descarte | text | YES | — | `descartar_orfao` (write motivo do descarte) | sem consumidor de leitura identificado | confirmado (functions-analysis write) |
| 18 | created_at | timestamptz | NO | `now()` | default | `auto_reconcile_orfaos` (filtro), índice `_pendentes` (ORDER BY DESC), `notify-orphan-email` (`.gte` janela burst) | confirmado |
| 19 | updated_at | timestamptz | NO | `now()` | default; tocado por `reconcile_orfao`/`descartar_orfao` | sem consumidor de leitura identificado | confirmado (write) |

**Colunas com espaço no nome**: nenhuma.

## Relacionamentos (FKs)
- `pagamentos_orfaos.pagamento_id` → `pagamentos.id` (`on_delete=NO ACTION`, `on_update=a`). Liga o órfão ao pagamento real criado na reconciliação. (bloco-03)
- Não há FK em `source`/`gateway_correlation_id`/`reconciliado_by` (este último deveria idealmente referenciar `auth.users`/`profiles`, mas não há FK).

## Índices
(bloco-04)

| índice | def | unique | idx_scan | bytes | papel |
|--------|-----|--------|----------|-------|-------|
| `pagamentos_orfaos_pkey` | (id) | sim/PK | 1 | 16 kB | estrutural |
| `pagamentos_orfaos_unique` | (source, gateway_correlation_id) | sim | 0 | 16 kB | **arbiter de `ON CONFLICT`** (dedup de upsert nos 4 webhooks/pulls) — idx_scan=0 porque o caminho de arbiter não conta como scan, **não é desperdício** |
| `idx_pagamentos_orfaos_payer` | (payer_phone, payer_taxid) WHERE reconciliado=false | não | 0 | 16 kB | suporte ao match por telefone (`auto_reconcile_orfaos`); ocioso na janela de 13h do snapshot |
| `idx_pagamentos_orfaos_pendentes` | (created_at DESC) WHERE reconciliado=false | não | 0 | 16 kB | suporte ao dashboard de pendentes + cron; ocioso na janela |

### Índices nunca usados (idx_scan=0)
3 índices com `idx_scan=0` na janela (~13h): `pagamentos_orfaos_unique`, `idx_pagamentos_orfaos_payer`, `idx_pagamentos_orfaos_pendentes`. **Nenhum é desperdício real**: o `_unique` é arbiter de ON CONFLICT (essencial à dedup), e os dois parciais alimentam reconciliação automática/dashboard que pode não ter rodado na janela curta do snapshot. **Desperdício reclamável: 0 kB.**

## Triggers
- `trg_orphan_email` — `AFTER INSERT FOR EACH ROW` → `notify_orphan_payment_created()`. (bloco-06)
  - A função lê `NOTIFY_ORPHAN_INTERNAL_KEY` de `app_internal_config` e dispara `net.http_post` (pg_net) para a edge `notify-orphan-email` com `NEW.*` (id, source, gateway_correlation_id, valor, data_pagamento, payer_name, payer_phone). Falha é capturada (`EXCEPTION WHEN OTHERS → WARNING`) para **não bloquear o INSERT** do webhook. (functions-analysis)

## RLS / Policies
- `rls_on=true`, `rls_forced=false`, 2 policies (bloco-01/09):
  - `Authenticated read pagamentos_orfaos` — SELECT, role `authenticated`, `qual=true`.
  - `Authenticated update pagamentos_orfaos` — UPDATE, role `authenticated`, `qual=true`.
- **Alerta de segurança**: ambas usam `qual=true` (sem escopo de unidade). Qualquer usuário autenticado lê/atualiza **órfãos de todas as franquias**, incluindo PII do pagador (`payer_name`, `payer_phone`, `payer_taxid`). Diverge do padrão `chat_user_has_unit(...)` que o CLAUDE.md exige para tabelas CHAT-CDT — mas esta é tabela de cobrança, fora desse padrão. Escritas reais dos webhooks/pulls usam `SERVICE_ROLE_KEY` (ignoram RLS).

## Quem escreve / Quem lê
- **Escrevem (INSERT/upsert)**: `woovi-webhook`, `stripe-webhook`, `reconcile-woovi-pull`, `reconcile-stripe-pull` (edge-functions; `onConflict source,gateway_correlation_id`).
- **Escrevem (UPDATE)**: RPC `reconcile_orfao` (marca reconciliado + vincula matrícula/pagamento), RPC `descartar_orfao` (marca descartado + motivo). (functions-analysis)
- **Leem**: RPC `auto_reconcile_orfaos` (batch loop pendentes), RPC `reconcile_orfao` (SELECT %ROWTYPE), edge `notify-orphan-email` (count para burst), **Table Editor do Supabase** (bloco-10a: `with _base_query ... select * from public.pagamentos_orfaos order by id ... octet_length(...)` = grade de dados do Dashboard, 1 call/364ms na janela).
- **Trigger**: `notify_orphan_payment_created` (e-mail best-effort via pg_net).

## Observações
- **Estatísticas cegas**: `last_analyze`/`last_autoanalyze`/`last_vacuum` todos `null` e `n_live_tup=0` apesar de ~97 linhas reais. O planner não tem estatísticas — recomendável um `ANALYZE`.
- **Qualidade de `data_pagamento`**: nos órfãos Stripe é a hora de ingestão (`toISOString()`), não a hora real do pagamento. Cuidado em relatórios temporais.
- **`raw_payload` sem TTL** identificado → fonte do bloat; nenhuma rotina de retenção encontrada (diferente de `webhook_events_log` que tem `0004_webhook_events_retention.sql` no repo CHAT-CDT — mas essa migration é do outro domínio).
- **`matricula_informada`** só é populada por Stripe; em órfãos Woovi é sempre NULL — assimetria entre gateways.
- **Sem consumidor de leitura identificado** para: `payer_taxid`, `raw_payload`, `reconciliado_at`, `reconciliado_by`, `matricula_reconciliada`, `motivo_descarte`, `updated_at` (todas escritas; leitura provável só por inspeção manual/Table Editor, não capturada nas fontes programáticas).
