# cobranca_sync_backup

## Identificação
- **Nome**: `public.cobranca_sync_backup`
- **Dono provável**: n8n / cobrança (infra do sync da planilha; **não** é tabela do CHAT-CDT — não existe migration em `infra/supabase/migrations/` que a crie; fonte: grep vazio nas migrations).
- **Linhas estimadas**: ≈ 9.203 (`linhas_estimadas` em bloco-01). `n_live_tup=0` **não significa vazia**: `last_analyze`/`last_autoanalyze` são `null` → estatísticas **nunca coletadas**; o sinal real é `linhas_estimadas`.
- **Tamanho**: 24 MB total (heap 15 MB; o resto é índice — ver Índices). Bytes/linha ≈ 2.700 → coerente com `row_data jsonb` carregando a linha inteira do devedor; **não é bloat patológico**, é o custo natural de guardar a foto pré-sync.
- **Classificação**: **Cobrança** (plumbing transiente do sync). **NÃO é Morta/Backup** apesar do nome "backup" e de `n_live_tup=0`: é a foto reversível usada pelo `rollback_sync`.
- **RLS**: **OFF** (`rls_on=false`). Ver achado de segurança em Observações.

## Finalidade
Foto pré-sync ("ponto de restauração") das listas vivas de cobrança. Antes de aplicar insert/update/delete/upsert em `clientes_cobranca_setembro` e `clientes_cobranca_dashboard`, a função `sync_cobranca_v2` serializa cada linha afetada como `row_data jsonb` aqui, marcada com `sync_log_id`, `unit_id`, `snapshot_date` e `source_table`. Se o sync precisar ser desfeito, `rollback_sync(p_sync_log_id)` lê estas linhas e reconstrói o estado anterior. É **transiente**: a própria `sync_cobranca_v2` faz prune por `created_at` (retenção rolante), por isso o conjunto fica pequeno em "live tup" mas grande em bytes acumulados.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('cobranca_sync_backup_id_seq')` | sequence (default) | PK; sem leitor de coluna conhecido | confirmado (default literal) |
| 2 | sync_log_id | bigint | NO | — | escrito por `sync_cobranca_v2` (insert); FK → `spreadsheet_sync_log.id` | lido por `rollback_sync` (`WHERE sync_log_id = p_sync_log_id`) | confirmado (functions-analysis: writes/reads; corpo de rollback_sync) |
| 3 | unit_id | uuid | NO | — | escrito por `sync_cobranca_v2` | lido por `rollback_sync` (deriva `v_unit_id`) | confirmado (functions-analysis reads em rollback_sync) |
| 4 | snapshot_date | date | NO | — | escrito por `sync_cobranca_v2` | lido por `rollback_sync` (no read-set de rollback) | confirmado (functions-analysis reads) |
| 5 | source_table | text | NO | — | escrito por `sync_cobranca_v2` (`'clientes_cobranca_setembro'` / `'clientes_cobranca_dashboard'`) | lido por `rollback_sync` (`AND source_table = 'clientes_cobranca_setembro'/'...dashboard'`) | confirmado (corpo de rollback_sync) |
| 6 | row_data | jsonb | NO | — | escrito por `sync_cobranca_v2` via `to_jsonb(c.*)` / `to_jsonb(d.*)` (linha inteira) | lido por `rollback_sync` via `jsonb_populate_record(null::tabela, row_data).*` e `row_data->>'matricula'` | confirmado (notes de ambas as funções) |
| 7 | created_at | timestamptz | NO | `now()` | default | **lido/consumido por `sync_cobranca_v2`** no DELETE de retenção (`writes: delete columns:[created_at]`) | confirmado (functions-analysis writes) |

Sem gaps de ordinal (1–7 contíguos) → nenhuma coluna droppada.

## Relacionamentos (FKs)
- `cobranca_sync_backup_sync_log_id_fkey`: `sync_log_id` → `spreadsheet_sync_log.id`, **ON DELETE CASCADE** (`on_delete='c'`). Apagar o log do sync apaga em cascata o backup daquele sync. (bloco-03)
- Não há FK em `unit_id` (diferente de `cobranca_clientes_removidos`/`sync_snapshots`, que têm FK para `units`). Inconsistência de modelagem, não bug.

## Índices
| índice | def | idx_scan | bytes | veredito |
|--------|-----|----------|-------|----------|
| cobranca_sync_backup_pkey | UNIQUE (id) | 1 | 4,56 MB | usado; PK |
| idx_sync_backup_created | (created_at) | 1 | 1,43 MB | usado (suporta o DELETE de retenção por `created_at`) |
| idx_sync_backup_log | (sync_log_id) | 0 | 1,43 MB | **0 scans na janela, mas REQUERIDO** — é o índice do caminho de rollback (`WHERE sync_log_id`); zero só porque nenhum rollback rodou nas ~13h. **Manter.** |
| idx_sync_backup_unit_date | (unit_id, snapshot_date) | 0 | 1,43 MB | **candidato a remoção** — nenhum consumidor confirmado filtra por (unit_id, snapshot_date) nesta tabela; rollback filtra por sync_log_id. |

### Índices nunca usados (idx_scan=0)
- `idx_sync_backup_log` (1,43 MB) — **zero na janela, porém load-bearing** (caminho de rollback). Não contar como desperdício.
- `idx_sync_backup_unit_date` (1,43 MB) — **desperdício provável**: ~**1,43 MB** sem consumidor identificado.
- **Soma do desperdício real**: ≈ **1,43 MB** (apenas `idx_sync_backup_unit_date`).

## Triggers
Nenhum (bloco-06 vazio para esta tabela).

## RLS / Policies
- **RLS OFF**, sem policies (`n_policies=0`).

## Quem escreve / Quem lê
- **Escreve**: `sync_cobranca_v2` — INSERT das colunas `sync_log_id, unit_id, snapshot_date, source_table, row_data` (foto pré-sync) e DELETE de retenção filtrado por `created_at`. (functions-analysis, confidence=confirmado.)
- **Lê**: `rollback_sync` — todas as 5 colunas de dados (`unit_id, snapshot_date, sync_log_id, row_data, source_table`), confidence=confirmado. `created_at` é "lido" pelo predicado de retenção da própria `sync_cobranca_v2`.
- **Nenhum** edge function, workflow n8n, view ou query de produção do `pg_stat_statements` toca a tabela (scans em edge-functions/n8n-workflows/views-analysis vazios; o único hit em bloco-10a é introspecção PostgREST `select * ... limit $1 offset $2`, calls=1 — table-browser, não consumidor).
- App Next.js: grep em `app/`/`lib/`/`components/` = **nenhuma referência**.

## Observações
- **ACHADO DE SEGURANÇA (PII + RLS OFF, não documentado)**: `row_data` guarda a **linha inteira do devedor** (nome, whatsapp, valor, matrícula…) e a tabela está com **RLS OFF**. Esta tabela **NÃO** aparece na lista de "7 tabelas n8n com RLS OFF" de `docs/03-database.md:27` — ou seja, é uma exposição **maior** (PII completa) e **não flagada** pela doc. Contradição doc↔banco + risco real.
- **Transiência real**: é a única das quatro que é de fato transiente (prune por `created_at`). O nome "backup" + `n_live_tup=0` enganam: classificar como Morta seria erro.
- **`sem_consumidor`**: apenas `id` (PK, sem leitor de coluna). Todas as demais 6 colunas têm consumidor confirmado.
- Crítica ao COMMENT/stats: `last_analyze=null` em todas as colunas → não confie em `n_live_tup`; use `linhas_estimadas≈9203`.
