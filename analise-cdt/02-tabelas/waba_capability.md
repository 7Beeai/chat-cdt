# waba_capability

## Identificação
- **Nome**: `public.waba_capability`
- **Dono provável**: n8n / cobrança ("Strategic Swarm Health"). Sem DDL nas migrations do CHAT-CDT; `docs/03-database.md:24` lista como "telemetria que o n8n popula".
- **Classificação**: **Cobrança** (dormant — ver abaixo)
- **Linhas estimadas**: `linhas_estimadas`=-1 e `n_live_tup`=0, `n_tup_ins`=**0** (bloco-01) → **tabela VAZIA / nunca populada**. O ramo `business_capability_update` da RPC `record_meta_account_event` aparentemente nunca disparou no período observado.
- **Tamanho**: 56 KB total (8 KB heap, ~48 KB índices). Praticamente só estrutura vazia.
- **Bloat**: N/A (vazia). `last_analyze`/`vacuum`/etc TODOS `null`.

## Finalidade
Snapshots de capacidade da WABA (`business_capability_update`): tier máximo de números de telefone e limite de conversas diárias. 1 linha por evento de webhook (COMMENT da tabela). Alimenta `v_waba_capability_current` (última capacidade observada por WABA).

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | — (NOT NULL sem default explícito) | provável GENERATED IDENTITY (extração não traz `is_identity`) | PK | inferido |
| 2 | waba_id | text | NO | — | RPC `record_meta_account_event` (webhook), col escrita literalmente (functions-analysis) | `v_waba_capability_current` (DISTINCT ON), índice | confirmado (writer) |
| 3 | unit_id | uuid | YES | — | RPC writer (resolvido via `disparadores_whatsapp`) | `v_waba_capability_current`, policy RLS | confirmado (writer) — **sem FK** |
| 4 | max_phone_numbers | integer | YES | — | RPC `record_meta_account_event` | `v_waba_capability_current` | confirmado (writer) |
| 5 | max_daily_conversations | integer | YES | — | RPC `record_meta_account_event` | `v_waba_capability_current` | confirmado (writer) |
| 6 | raw_value | jsonb | NO | — | RPC `record_meta_account_event` (payload completo do evento) | sem consumidor identificado (view não seleciona) | confirmado (writer) / sem consumidor |
| 7 | webhook_event_id | bigint | YES | — | RPC `record_meta_account_event` (id do log do webhook) | sem consumidor identificado | confirmado (writer) / sem consumidor |
| 8 | observed_at | timestamptz | NO | `now()` | default `now()` no INSERT | `v_waba_capability_current` (ORDER BY observed_at DESC), índices | confirmado |

Sem colunas com espaço no nome. Sem gaps de ordinal (1→8 contíguo). Tabela mais estreita do grupo (8 colunas vs 12 das demais).

## Relacionamentos (FKs)
- **Nenhuma FK** (bloco-03 não retornou nada para esta tabela).
- **Assimetria notável**: `unit_id` aqui é o MESMO conceito de `phone_health.unit_id`/`waba_health.unit_id`, que TÊM FK→`units`, mas aqui **não há FK**. `webhook_event_id` também sem FK (provavelmente → `webhook_events_log.id`, **inferido**).

## Índices
| índice | def | idx_scan | bytes | nota |
|--------|-----|----------|-------|------|
| `idx_waba_capability_waba` | (waba_id, observed_at DESC) | 0 | 16 KB | NUNCA USADO (tabela vazia) |
| `idx_waba_capability_waba_observed` | (waba_id, observed_at) ASC | 0 | 8 KB | NUNCA USADO |
| `waba_capability_pkey` | UNIQUE (id) | 0 | 16 KB | PK (estrutural) |

`idx_scan`=0 na tabela inteira; `seq_scan`=251 (a view varre a tabela vazia).

### Índices nunca usados (idx_scan=0)
- Todos os 3 com idx_scan=0, mas isso é **esperado numa tabela vazia** — não indica desperdício real de regime. Par DESC/ASC redundante (mesmo antipattern das irmãs), mas custo trivial (~24 KB nos dois secundários). PK excluída da conta. **Desperdício efetivo desprezível (~24 KB)**.

## Triggers
- **Nenhuma** (bloco-06 não retornou trigger para esta tabela). Diferente das irmãs `phone_health`/`waba_health`/`waba_violations`, que têm o `trg_motor_v2_gate_from_*`. Capacidade não realimenta o gate.

## RLS / Policies
- `rls_on`=true, `rls_forced`=false.
- 1 policy: `health_select_waba_capability` — SELECT, `authenticated`, `qual = user_can_read_unit(unit_id)` (helper da cobrança). Sem policies de escrita → INSERT via RPC SECURITY DEFINER.

## Quem escreve / Quem lê
- **Escreve**: `record_meta_account_event` (RPC SECURITY DEFINER), ramo `business_capability_update` — INSERT em (waba_id, unit_id, max_phone_numbers, max_daily_conversations, raw_value, webhook_event_id). functions-analysis "confirmado", mas dentro de bloco `BEGIN...EXCEPTION` protegido. **Na prática nunca executou** (`n_tup_ins`=0).
- **Upstream**: webhook da Meta `business_capability_update` via n8n/edge — **inferido** (grep edge/n8n vazio).
- **Lê**: `v_waba_capability_current` via PostgREST — bloco-10b: 229 chamadas, mean **0,36ms** (rápido porque a tabela está vazia). Policy RLS.

## Observações
- **Contradição doc/COMMENT↔banco**: o COMMENT descreve a tabela como populada ("snapshots de capacidade... 1 linha por evento"), mas ela está **vazia** (0 inserts). Tem writer confirmado E view consumidora (229 chamadas) → classificação **Cobrança + dormant/nunca populada**, NUNCA "morta". Investigar se o evento `business_capability_update` está habilitado no app da Meta / no fluxo n8n.
- 2 colunas **sem consumidor identificado**: `raw_value`, `webhook_event_id` (gravadas pela RPC, não projetadas pela view).
- `id` sem default explícito mas NOT NULL → quase certamente IDENTITY; marcado **inferido** (a extração não traz `is_identity`); NÃO classificar como "origem desconhecida".
- Sem FK em `unit_id` (assimetria com as irmãs) e sem trigger de gate — esta tabela é "mais solta" que as demais do grupo.
