# spreadsheet_sync_log

## Identificação
- **Nome**: `public.spreadsheet_sync_log`
- **Dono provável**: n8n / cobrança (infra do sync; sem migration no repo CHAT-CDT). É a **tabela-pai** das outras três (backup, removidos, snapshots referenciam `spreadsheet_sync_log.id`).
- **Linhas estimadas**: ≈ 176 (`linhas_estimadas`). `n_live_tup=0` + `last_analyze=null` → **estatísticas nunca coletadas**, não está vazia.
- **Tamanho**: 536 kB total (heap 224 kB; índices ~57 kB). Bytes/linha alto p/ um log (≈3 kB/linha) — explicado pelos jsonb `validation_errors`/`sanity_metrics`; não é bloat crítico no volume atual.
- **Classificação**: **Cobrança** (log/cabeçalho de cada execução do sync).
- **RLS**: **ON** (`rls_on=true`) com 1 policy de leitura para `authenticated` (ver RLS). É a **única** das quatro com RLS ligado.

## Finalidade
Cabeçalho/log de cada execução de sync de planilha de inadimplentes. `sync_cobranca_v2` cria a linha em `status='processing'` no início (com `file_id`/`file_name`/parâmetros de detecção), e a atualiza no fim com contadores (`records_*`), `status` final e `completed_at`. Serve de **idempotência/concorrência** (índice único em `file_id`, índice parcial em `status='processing'`) e de **âncora referencial**: backup, removidos e snapshots amarram cada registro ao `id` deste log via FK.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('..._id_seq')` | sequence | **FK-pai** de `cobranca_sync_backup`, `cobranca_clientes_removidos`, `sync_snapshots` (`sync_log_id`); usado por `rollback_sync` como `p_sync_log_id` | confirmado (bloco-03 FKs; corpo de rollback_sync) |
| 2 | file_id | text | NO | — | `sync_cobranca_v2` insert | **lido** por `sync_cobranca_v2` (read-set `file_id`; dedup/idempotência) + DELETE por `file_id` | confirmado (functions-analysis reads+writes) |
| 3 | file_name | text | YES | — | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |
| 4 | status | text | NO | `'processing'` | `sync_cobranca_v2` insert/update (`processing`→final) | **lido** por `sync_cobranca_v2` (read-set `status`; controle de concorrência) | confirmado (functions-analysis reads+writes) |
| 5 | records_in_sheet | integer | YES | `0` | `sync_cobranca_v2` insert+update | sem consumidor identificado | confirmado (writer) |
| 6 | records_created | integer | YES | `0` | `sync_cobranca_v2` update | sem consumidor identificado | confirmado (writer) |
| 7 | records_updated | integer | YES | `0` | `sync_cobranca_v2` update | sem consumidor identificado | confirmado (writer) |
| 8 | records_deleted | integer | YES | `0` | `sync_cobranca_v2` update | sem consumidor identificado | confirmado (writer) |
| 9 | records_paid_removed | integer | YES | `0` | `sync_cobranca_v2` update | sem consumidor identificado | confirmado (writer) |
| 10 | records_skipped | integer | YES | `0` | `sync_cobranca_v2` update | sem consumidor identificado | confirmado (writer) |
| 11 | validation_errors | jsonb | YES | `'[]'` | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |
| 12 | error | text | YES | — | `sync_cobranca_v2` (caminho de falha) | sem consumidor identificado | inferido (não listado explicitamente no insert/update de functions-analysis; provável path de exceção) |
| 13 | started_at | timestamptz | YES | `now()` | default / `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (default) |
| 14 | completed_at | timestamptz | YES | — | `sync_cobranca_v2` insert+update | sem consumidor identificado | confirmado (writer) |
| 15 | converted_file_id | text | YES | — | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |
| 16 | created_at | timestamptz | YES | `now()` | default | sem consumidor identificado | confirmado (default) |
| 17 | header_row_detected | integer | YES | — | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |
| 18 | abort_rule | text | YES | — | `sync_cobranca_v2` insert (`p_abort_rule`) | sem consumidor identificado | confirmado (writer) |
| 19 | abort_reason | text | YES | — | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |
| 20 | sanity_metrics | jsonb | YES | — | `sync_cobranca_v2` insert (foto de sanity/export parcial) | sem consumidor identificado | confirmado (writer) |

Sem gaps de ordinal (1–20 contíguos) → nenhuma coluna droppada.

## Relacionamentos (FKs)
Esta tabela é **referenciada por** (é o lado pai):
- `cobranca_sync_backup.sync_log_id` → `id` (**ON DELETE CASCADE**).
- `cobranca_clientes_removidos.sync_log_id` → `id` (ON DELETE NO ACTION).
- `sync_snapshots.sync_log_id` → `id` (ON DELETE NO ACTION).

Não tem FK de saída (não referencia `units` — diferente das filhas; o vínculo com unidade vive nas filhas).

## Índices
| índice | def | idx_scan | bytes | veredito |
|--------|-----|----------|-------|----------|
| spreadsheet_sync_log_pkey | UNIQUE (id) | 1 | 16 kB | usado; PK + alvo das FKs filhas |
| idx_sync_log_file_id | UNIQUE (file_id) | 0 | 40 kB | **0 scans, mas REQUERIDO** — garante dedup por `file_id` (idempotência); `sync_cobranca_v2` faz upsert/lookup por file_id. **Manter.** |
| idx_sync_log_status | (status) WHERE status='processing' (parcial) | 0 | 16 kB | **0 scans, mas funcional** — índice parcial p/ achar sync em andamento (lock de concorrência). Custo mínimo; manter. |

### Índices nunca usados (idx_scan=0)
- `idx_sync_log_file_id` (40 kB) e `idx_sync_log_status` (16 kB): **zero na janela mas ambos load-bearing** (unicidade de file_id e detecção de concorrência). **Não são desperdício** — são restrições/guardas que raramente fazem scan mas previnem duplicidade e syncs concorrentes.
- **Desperdício removível**: **0 MB** (nenhum índice secundário inútil aqui).

## Triggers
Nenhum.

## RLS / Policies
- **RLS ON**. 1 policy:
  - `"Authenticated users can read sync logs"` — `SELECT`, role `authenticated`, `qual = true` (leitura **ampla** para qualquer autenticado, sem filtro por unidade). Não há policy de INSERT/UPDATE/DELETE → escrita só via funções `SECURITY DEFINER` (`sync_cobranca_v2`) ou service-role.
- **Sem policies duplicadas/sobrepostas** (apenas uma).

## Quem escreve / Quem lê
- **Escreve**: `sync_cobranca_v2` — INSERT (cabeçalho + parâmetros), UPDATE (contadores + status final), DELETE por `file_id`. confidence=confirmado (functions-analysis).
- **Lê / consome**:
  - `sync_cobranca_v2`: `file_id` e `status` (dedup + concorrência) — confirmado.
  - `rollback_sync`: usa `id` como parâmetro de entrada (`p_sync_log_id`); FKs filhas resolvem contra `id`.
- **App Next.js**: grep em `app/`/`lib/`/`components/` = **nenhuma referência** — a tela `/upload` é frontend-only (backend pendente), então ainda **não** lê este log. A policy de SELECT é forward-looking/herdada.
- **pg_stat_statements**: único hit é introspecção PostgREST `select * ... limit $1 offset $2` (calls=1) — table-browser, não consumidor de produção.

## Observações
- **`sem_consumidor`**: 16 das 20 colunas sem consumidor identificado. As 4 com consumidor: `id` (FK-pai/rollback), `file_id` (dedup), `status` (concorrência) e — indiretamente — as referências via `sync_log_id` das filhas. Os contadores `records_*`, jsonb (`validation_errors`, `sanity_metrics`) e timestamps existem para **observabilidade/relatório**, mas nenhum reader confirmado os consome hoje → "sem consumidor identificado", não "morta".
- A presença da policy `SELECT true` para `authenticated` indica intenção de um painel de status de sync (provável tela `/upload`), ainda não implementado no app.
- `error` (col 12): marcada **inferido** porque não aparece nominalmente nos insert/update mapeados de `sync_cobranca_v2` — é o campo de mensagem do caminho de exceção; origem provável mas não literalmente comprovada na functions-analysis.
- `last_analyze=null`: use `linhas_estimadas≈176`, não `n_live_tup`.
