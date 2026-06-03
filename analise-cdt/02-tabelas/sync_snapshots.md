# sync_snapshots

## Identificação
- **Nome**: `public.sync_snapshots`
- **Dono provável**: n8n / cobrança (infra do sync; sem migration no repo). Confirmada como tabela n8n por `docs/03-database.md:27`.
- **Linhas estimadas**: `linhas_estimadas = -1` → **nunca analisada** (`last_analyze=null`, `last_autoanalyze=null`); contagem **desconhecida**, não zero.
- **Tamanho**: 64 kB total (heap 8 kB; 3 índices de 16 kB).
- **Classificação**: **Cobrança** (snapshot diário de métricas do sync). Não é Morta nem transiente — **persiste histórico** (ver Observações).
- **RLS**: **OFF** (`rls_on=false`) — documentado em `docs/03-database.md:27`.

## Finalidade
Uma linha por **(unit_id, snapshot_date)** com o **resumo agregado** de cada dia de sync de cobrança: quantos entraram/saíram, total de clientes e valor, aging médio, e a distribuição/transição de réguas (jsonb). É **upsert** por `sync_cobranca_v2` com chave única `(unit_id, snapshot_date)`. A própria `sync_cobranca_v2` lê a linha do dia anterior (`SELECT * INTO v_prev`) para calcular os **deltas** (`valor_total_delta`, `total_clientes_delta`) — portanto o histórico **precisa sobreviver** entre syncs. Aparenta ser um feed de analytics (para `/reports`), mas hoje **nenhum RPC de relatório o lê** (ver Observações).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('..._id_seq')` | sequence | PK; sem leitor | confirmado (default) |
| 2 | unit_id | uuid | NO | — | `sync_cobranca_v2` upsert; FK → `units.id` | **chave do upsert** + **lido** (read-set `unit_id`); filtro do rollback (`WHERE sync_log_id`) via PK lógica | confirmado (functions-analysis reads+writes) |
| 3 | snapshot_date | date | NO | — | `sync_cobranca_v2` upsert | **chave do upsert** + lido (`SELECT v_prev`) | confirmado (functions-analysis reads+writes) |
| 4 | sync_log_id | bigint | YES | — | `sync_cobranca_v2` upsert; FK → `spreadsheet_sync_log.id` | **lido/filtrado por `rollback_sync`** (`DELETE FROM sync_snapshots WHERE sync_log_id = p_sync_log_id`) | confirmado (corpo de rollback_sync) |
| 5 | entradas | integer | NO | `0` | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 6 | saidas | integer | NO | `0` | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 7 | saidas_pagamento | integer | NO | `0` | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 8 | saidas_sumiu | integer | NO | `0` | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 9 | atualizados | integer | NO | `0` | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 10 | total_clientes | integer | NO | `0` | `sync_cobranca_v2` upsert | **lido** por `sync_cobranca_v2` (read-set `total_clientes`) p/ delta | confirmado (functions-analysis reads) |
| 11 | valor_total | numeric | NO | `0` | `sync_cobranca_v2` upsert | **lido** por `sync_cobranca_v2` (read-set `valor_total`) p/ delta | confirmado (functions-analysis reads) |
| 12 | aging_medio_dias | numeric | YES | — | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 13 | regua_distribuicao | jsonb | NO | `'{}'` | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 14 | regua_transicao | jsonb | NO | `'{}'` | `sync_cobranca_v2` upsert | sem consumidor identificado | confirmado (writer) |
| 15 | valor_total_delta | numeric | YES | — | `sync_cobranca_v2` (calculado de `v_prev.valor_total`) | sem consumidor identificado | confirmado (writer; derivado da leitura própria) |
| 16 | total_clientes_delta | integer | YES | — | `sync_cobranca_v2` (calculado de `v_prev.total_clientes`) | sem consumidor identificado | confirmado (writer) |
| 17 | created_at | timestamptz | NO | `now()` | default | sem consumidor identificado | confirmado (default) |

Sem gaps de ordinal (1–17 contíguos).

## Relacionamentos (FKs)
- `sync_snapshots_sync_log_id_fkey`: `sync_log_id` → `spreadsheet_sync_log.id`, ON DELETE NO ACTION (`'a'`).
- `sync_snapshots_unit_id_fkey`: `unit_id` → `units.id`, ON DELETE NO ACTION.

## Índices
| índice | def | idx_scan | bytes | veredito |
|--------|-----|----------|-------|----------|
| sync_snapshots_pkey | UNIQUE (id) | 0 | 16 kB | PK (estrutural) |
| sync_snapshots_unit_date_key | UNIQUE (unit_id, snapshot_date) | 0 | 16 kB | **0 scans, mas REQUERIDO** — backa o `ON CONFLICT (unit_id, snapshot_date)` do upsert. **Manter.** |
| idx_snapshots_unit_date | (unit_id, snapshot_date DESC) | 0 | 16 kB | **redundante/candidato** — duplica a chave única acima só com ordem DESC; sem consumidor confirmado. |

### Índices nunca usados (idx_scan=0)
- `sync_snapshots_unit_date_key` (16 kB): **zero scans porém load-bearing** (upsert key) — não é desperdício.
- `idx_snapshots_unit_date` (16 kB): **desperdício provável** ≈ **16 kB** (sobrepõe a chave única; serviria para "último snapshot por unidade", mas nenhum reader o usa).
- `pkey` é estrutural.

## Triggers
Nenhum.

## RLS / Policies
- **RLS OFF**, sem policies. Documentado em `docs/03-database.md:27`.

## Quem escreve / Quem lê
- **Escreve**: `sync_cobranca_v2` — UPSERT das 15 colunas (functions-analysis, confirmado).
- **Lê**:
  - `sync_cobranca_v2` (auto-leitura do dia anterior): `unit_id, snapshot_date, valor_total, total_clientes` para computar os deltas — confirmado (functions-analysis reads; notes "SELECT * INTO v_prev").
  - `rollback_sync`: `sync_log_id` no DELETE de limpeza — confirmado.
- **Nenhum** RPC de `/reports`, edge, n8n, view ou query de app o consome (functions-analysis sem reader de relatório; grep app vazio; pg_stat_statements sem hit de produção).

## Observações
- **Correção da dica de contexto**: a dica diz que `sync_snapshots` é "truncada entre syncs (transiente)". **Isso está errado** — a evidência própria contradiz: `sync_cobranca_v2` lê a linha do dia anterior para os deltas e faz **upsert** por `(unit_id, snapshot_date)`. Histórico **persiste**; só `cobranca_sync_backup` é de fato transiente. Flag de contradição.
- **Write-only analytics**: parece um feed para a tela `/reports`, mas **nenhum reader de relatório existe** hoje. Das 17 colunas, **12 sem consumidor identificado** (entradas/saidas/saidas_pagamento/saidas_sumiu/atualizados/aging_medio_dias/regua_distribuicao/regua_transicao/valor_total_delta/total_clientes_delta/created_at/id). As 5 consumidas são `unit_id, snapshot_date, valor_total, total_clientes, sync_log_id`.
- `linhas_estimadas=-1` + `last_analyze=null`: nunca analisada; não inferir tamanho a partir das stats.
