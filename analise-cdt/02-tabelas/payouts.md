# payouts

## Identificação
- **Nome**: `public.payouts`
- **Dono provável**: Cobrança (ecossistema n8n/pagamentos). Ausente das migrations CHAT-CDT e do código local.
- **Linhas estimadas**: indeterminado (`linhas_estimadas=-1` = nunca analisada; `n_live_tup=0`, `n_tup_ins=0` na janela). Provavelmente poucas linhas (1 payout/unidade/dia no máximo, rate-limit Abacate 1/min).
- **Tamanho**: 48 kB total / 0 bytes heap (`tamanho_heap="0 bytes"`) → heap vazio no momento do snapshot; o peso é só dos 6 índices. **Tabela praticamente sem dados materializados ainda** (feature recente / cron pode não ter rodado).
- **Classificação**: **Cobrança** (repasses/saques PIX).
- **Bloat**: n/a (heap vazio).

## Finalidade
Registro de **repasses (payouts/saques PIX)** do saldo de cada franquia no gateway Abacate Pay. O cron `process-payouts` (chamado pelo n8n com `x-api-key`) percorre cada unidade com Abacate ativo + `payout_enabled`, atualiza o status de payouts `PENDING` e cria saques automáticos do saldo disponível, gravando uma linha por saque aqui. Quando um payout vira `COMPLETE`, a RPC `link_payout_charges` popula `payout_pagamentos` com as charges PIX que compõem aquele repasse.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | `process-payouts` (read/insert/update), `link_payout_charges` (read), FK de `payout_pagamentos.payout_id` | confirmado |
| 2 | unit_id | uuid | NO | — (FK→units.id) | `process-payouts` (insert) | `process-payouts`, `link_payout_charges` (filtra charges da unidade); índice `idx_payouts_unit_status` | confirmado |
| 3 | platform | text | NO | `'abacate'` | default | `process-payouts`, `link_payout_charges` (read) | confirmado |
| 4 | external_id | text | NO | — | `process-payouts` (`crypto.randomUUID()` — idempotência) | índice unique `payouts_external_id_key` (dedup) | confirmado (edge-functions notes) |
| 5 | abacate_id | text | YES | — | `process-payouts` (id retornado pela API Abacate no POST) | `process-payouts` (update status) | confirmado |
| 6 | amount_cents | bigint | NO | — | `process-payouts` (valor do saque) | `process-payouts` | confirmado |
| 7 | platform_fee_cents | bigint | YES | — | `process-payouts` (taxa do gateway) | `process-payouts` | confirmado |
| 8 | pix_key | text | NO | — | `process-payouts` (copiado de `payment_gateway_configs.payout_pix_key`) | `process-payouts` | confirmado |
| 9 | pix_key_type | text | NO | — | `process-payouts` (copiado de `payout_pix_key_type`) | `process-payouts` | confirmado |
| 10 | status | text | NO | `'PENDING'` | default; transições por `process-payouts` (PENDING→COMPLETE/FAILED) | `process-payouts` (read/update), `link_payout_charges` (filtra COMPLETE); índices `idx_payouts_status_pending`, `idx_payouts_unit_status` | confirmado |
| 11 | receipt_url | text | YES | — | `process-payouts` (comprovante do saque) | `process-payouts` (write); sem reader além do app | confirmado (write) |
| 12 | error_message | text | YES | — | `process-payouts` (motivo do FAILED) | `process-payouts` (write); sem reader além do app | confirmado (write) |
| 13 | raw_request | jsonb | YES | — | `process-payouts` (payload enviado à Abacate) | sem consumidor de leitura identificado (auditoria) | confirmado (write) |
| 14 | raw_response | jsonb | YES | — | `process-payouts` (resposta da Abacate) | sem consumidor de leitura identificado (auditoria) | confirmado (write) |
| 15 | created_at | timestamptz | NO | `now()` | default | `link_payout_charges` (janela entre payout anterior e atual); índice `idx_payouts_created_at` | confirmado |
| 16 | updated_at | timestamptz | NO | `now()` | default; tocado por `process-payouts` | `link_payout_charges` (read) | confirmado |
| 17 | completed_at | timestamptz | YES | — | `process-payouts` (marca COMPLETE) | `link_payout_charges` (delimita janela de charges) | confirmado |

**Colunas com espaço no nome**: nenhuma.

## Relacionamentos (FKs)
- `payouts.unit_id` → `units.id` (`on_delete=a`, `on_update=a`). (bloco-03)
- **Referenciada por**: `payout_pagamentos.payout_id` → `payouts.id` (`on_delete=c` CASCADE — apagar um payout apaga seus vínculos de charges). (bloco-03)

## Índices
(bloco-04)

| índice | def | unique | idx_scan | bytes | papel |
|--------|-----|--------|----------|-------|-------|
| `payouts_pkey` | (id) | sim/PK | 2 | 8 kB | estrutural |
| `payouts_external_id_key` | (external_id) | sim | 0 | 8 kB | **idempotência** — arbiter do dedup (`externalId` randomUUID + UNIQUE); idx_scan=0 não é desperdício |
| `idx_payouts_created_at` | (created_at DESC) | não | 2 | 8 kB | listagem/janela; usado |
| `idx_payouts_status_pending` | (status) WHERE status='PENDING' | não | 0 | 8 kB | suporte ao `process-payouts` (varre PENDING); ocioso na janela de 13h |
| `idx_payouts_unit_status` | (unit_id, status) | não | 0 | 8 kB | suporte ao `process-payouts` (por unidade); ocioso na janela |

### Índices nunca usados (idx_scan=0)
3 com `idx_scan=0` na janela: `payouts_external_id_key` (arbiter de idempotência — essencial), `idx_payouts_status_pending` e `idx_payouts_unit_status` (alimentam o cron `process-payouts`, que pode não ter rodado na janela de ~13h). **Nenhum é desperdício real. Reclamável: 0 kB.**

## Triggers
Nenhuma (bloco-06). `updated_at` não tem trigger — é mantido pelo código de `process-payouts`.

## RLS / Policies
- `rls_on=true`, `rls_forced=false`, 1 policy (bloco-01/09):
  - `Authenticated read payouts` — SELECT, role `authenticated`, `qual=true`.
- **Alerta**: `qual=true` sem escopo de unidade → qualquer autenticado lê payouts de **todas** as franquias (valores, chave PIX `pix_key`). Não há policy de INSERT/UPDATE → escrita só via `service_role` (`process-payouts`), o que é correto. Mas a leitura ampla expõe chaves PIX e valores entre franquias.

## Quem escreve / Quem lê
- **Escreve**: edge `process-payouts` (cron via n8n `x-api-key`) — INSERT do payout PENDING **antes** do POST à Abacate (idempotência), depois UPDATE com `abacate_id`/`status`/`receipt_url`/`completed_at`/`error_message`. (edge-functions)
- **Lê**: `process-payouts` (status PENDING), RPC `link_payout_charges` (id, unit_id, status, platform, completed_at, updated_at, created_at — para delimitar a janela de charges). (functions-analysis)

## Observações
- **Heap vazio (0 bytes)** + `n_tup_ins=0` na janela → feature de payouts **recém-criada ou ainda sem volume**; gated por secret `PAYOUTS_ENABLED` + `payout_enabled` por unidade. Não confundir com tabela morta: é infraestrutura nova de repasse.
- **Estatísticas cegas**: `last_analyze`/`last_vacuum`=null, `linhas_estimadas=-1`.
- **Sem consumidor de leitura identificado** para `receipt_url`, `error_message`, `raw_request`, `raw_response` (escritas para auditoria/UI futura; nenhum reader programático capturado).
- **Idempotência bem desenhada**: `external_id` (UNIQUE) + insert-antes-do-POST + marca FAILED se o POST falhar (edge-functions notes). Rate-limit Abacate respeitado (sleep 65s entre criações).
