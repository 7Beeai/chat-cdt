# waba_health

## Identificação
- **Nome**: `public.waba_health`
- **Dono provável**: n8n / cobrança ("Strategic Swarm Health"). Sem DDL nas migrations do CHAT-CDT; `docs/03-database.md:24` lista como "telemetria que o n8n popula".
- **Classificação**: **Cobrança**
- **Linhas estimadas**: ~20.467 (`linhas_estimadas`/`reltuples`, bloco-01). ATENÇÃO: `n_live_tup`=1001 e `n_tup_ins`=1001 são contadores desde o último reset de stats, não a contagem real; `last_analyze`/`autoanalyze`/`vacuum`/`autovacuum` TODOS `null` (nunca analisada/aspirada).
- **Tamanho**: 35 MB total (31 MB heap, ~4 MB índices), bloco-01.
- **Bloat**: ~1,5–1,8 KB/linha de heap (31 MB / ~20.467) com duas colunas jsonb (`health_status`, `raw_response`). Não é bloat alarmante para o conteúdo. Alerta operacional real: **nunca-analisada/nunca-aspirada**.

## Finalidade
Log histórico (série temporal) de saúde por WABA (conta WhatsApp Business). Cada linha é um snapshot de review da conta, verificação do negócio e capacidade de envio, obtido por **polling da Graph API**. Alimenta `v_waba_health_current` (último snapshot por WABA, extrai `health_status->>'can_send_message'`) para monitorar risco de bloqueio de envio.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('waba_health_id_seq')` | sequence serial (default explícito) | PK; nenhum leitor de negócio | confirmado (default) |
| 2 | waba_id | text | NO | — | RPC `record_waba_health_snapshot` (polling), col escrita literalmente (functions-analysis) | `v_waba_health_current` (DISTINCT ON), índice | confirmado |
| 3 | unit_id | uuid | YES | — | RPC writer (resolvido a partir do waba) | `v_waba_health_current`, policy RLS, trigger `NEW.unit_id`, índice | confirmado (writer); FK→units |
| 4 | name | text | YES | — | RPC `record_waba_health_snapshot` | `v_waba_health_current` (nome do WABA; atenção: coexiste com u.name da unidade no JOIN) | confirmado |
| 5 | account_review_status | text | YES | — | RPC `record_waba_health_snapshot` | `v_waba_health_current` | confirmado |
| 6 | business_verification_status | text | YES | — | RPC `record_waba_health_snapshot` | `v_waba_health_current` | confirmado |
| 7 | status | text | YES | — | RPC `record_waba_health_snapshot` | sem consumidor identificado (view não seleciona) | confirmado (writer) / sem consumidor |
| 8 | country | text | YES | — | RPC `record_waba_health_snapshot` | sem consumidor identificado | confirmado (writer) / sem consumidor |
| 9 | currency | text | YES | — | RPC `record_waba_health_snapshot` | sem consumidor identificado | confirmado (writer) / sem consumidor |
| 10 | health_status | jsonb | YES | — | RPC `record_waba_health_snapshot` | `v_waba_health_current` extrai `health_status->>'can_send_message'` | confirmado |
| 11 | observed_at | timestamptz | NO | `now()` | default `now()` no INSERT | `v_waba_health_current` (ORDER BY observed_at DESC), índices | confirmado |
| 12 | raw_response | jsonb | YES | — | RPC writer; marca `raw_response._source='graph_polling'` (functions-analysis) | sem consumidor identificado | confirmado (writer) / sem consumidor |

Sem colunas com espaço no nome. Sem gaps de ordinal (1→12 contíguo).

## Relacionamentos (FKs)
- `waba_health_unit_id_fkey`: `unit_id → units.id` (NO ACTION/NO ACTION), bloco-03.
- Sem FK em `waba_id` (é texto solto, o ID da Meta).

## Índices
| índice | def | idx_scan | bytes | nota |
|--------|-----|----------|-------|------|
| `idx_waba_health_waba_at` | (waba_id, observed_at DESC) | 0 | 1,95 MB | **NUNCA USADO** |
| `idx_waba_health_unit_at` | (unit_id, observed_at DESC) | 0 | 1,62 MB | **NUNCA USADO** |
| `waba_health_pkey` | UNIQUE (id) | 0 | 0,53 MB | PK (estrutural) |

`seq_scan`=559, `idx_scan`=0 na tabela (bloco-01): **a view roda inteiramente por seq scan**. Nenhum índice é tocado.

### Índices nunca usados (idx_scan=0)
- `idx_waba_health_waba_at` (1,95 MB) e `idx_waba_health_unit_at` (1,62 MB) — ambos ociosos. O DISTINCT ON da view não está usando o índice `(waba_id, observed_at DESC)` esperado; faz full seq scan sobre ~20k linhas jsonb-pesadas.
- **Desperdício removível ≈ 3,41 MB** (os dois índices secundários). `waba_health_pkey` (0,53 MB) é estrutural — **excluído da conta**. (Atenção: se a view fosse re-planejada para usar `idx_waba_health_waba_at`, ele deixaria de ser desperdício — antes de dropar, avaliar por que não é usado.)

## Triggers
- `trg_motor_v2_gate_from_waba_health` — AFTER INSERT, ROW, função `trg_motor_v2_recalc_gate_from_health` (bloco-06). Lê `NEW.unit_id` e chama `motor_v2_recalc_gate()`. **Efeito cross-table**: inserir um snapshot de `waba_health` dispara um recálculo que lê `phone_health` (e não colunas desta tabela). Só grava em `event_log` no EXCEPTION.

## RLS / Policies
- `rls_on`=true, `rls_forced`=false.
- 1 policy: `health_select_waba_health` — SELECT, `authenticated`, `qual = user_can_read_unit(unit_id)` (helper da cobrança). Sem policies de escrita → INSERTs via RPC SECURITY DEFINER. Consistente, sem duplicação.

## Quem escreve / Quem lê
- **Escreve**: `record_waba_health_snapshot` (RPC SECURITY DEFINER, polling Graph API; RETURNS bigint; valida `p_waba_id`; marca `_source='graph_polling'`). Writer único e confirmado (functions-analysis). No snapshot de stat, a RPC paramétrica de waba health foi chamada **1014×** (bloco-10b, mean 5,36ms).
- **Upstream** (quem chama a RPC): provável n8n/cron de polling — **inferido** (edge/n8n grep vazio; apoiado por docs + COMMENT + marker `graph_polling`).
- **Lê**: `v_waba_health_current` via PostgREST — bloco-10a: 466 chamadas, mean **3.152ms**; variante filtrada por unit_id 42×, mean **3.658ms**. Policy RLS. Nenhuma função/edge lê diretamente.

## Observações
- **Performance crítica**: `v_waba_health_current` é o pior caso do conjunto — ~3,15s por chamada, **100% seq scan** (todos os índices ociosos) sobre ~20k linhas com 2 jsonb. DISTINCT ON + extração `health_status->>'can_send_message'`. Forte candidato a otimização (índice efetivo, view materializada ou snapshot corrente em tabela leve).
- **Stats stale**: nunca houve analyze/vacuum — o planner pode estar escolhendo seq scan por falta de estatística; rodar `ANALYZE waba_health` pode, por si só, melhorar o plano.
- 4 colunas **sem consumidor identificado**: `status`, `country`, `currency`, `raw_response`. Gravadas mas não projetadas por nenhuma view/função. NÃO são mortas.
- **Ambiguidade de `name`**: a view junta `waba_health.name` (nome do WABA) com `units.name` (nome da unidade) — fonte potencial de confusão de label no front (notes da view alertam).
