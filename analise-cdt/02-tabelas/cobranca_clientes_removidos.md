# cobranca_clientes_removidos

## Identificação
- **Nome**: `public.cobranca_clientes_removidos`
- **Dono provável**: n8n / cobrança (infra do sync; sem migration no repo CHAT-CDT). Confirmada como tabela n8n por `docs/03-database.md:27`.
- **Linhas estimadas**: ≈ 69 (`linhas_estimadas`). `n_live_tup=0` + `last_analyze=null` → **estatísticas nunca coletadas**, não está vazia.
- **Tamanho**: 104 kB total (heap 16 kB; resto = 3 índices de 16 kB).
- **Classificação**: **Cobrança** (trilha de auditoria do sync). Não é Morta.
- **RLS**: **OFF** (`rls_on=false`) — bate com a lista de RLS-OFF de `docs/03-database.md:27` (esta está documentada).

## Finalidade
Trilha de auditoria **append-only** de devedores que **saíram** da base viva (`clientes_cobranca_setembro`) num sync. Quando `sync_cobranca_v2` remove uma matrícula — porque sumiu da planilha ou porque foi marcada como paga — o `DELETE ... RETURNING` alimenta um INSERT aqui, congelando o estado do cliente no momento da saída (régua, status, valor, dias na base) e o `motivo`. Serve para histórico/relatório de saídas; o `sync_log_id` amarra cada registro ao sync que o gerou (e permite o rollback limpar).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('..._id_seq')` | sequence (default) | PK; sem leitor | confirmado (default) |
| 2 | matricula | text | NO | — | `sync_cobranca_v2` insert (do `RETURNING` de setembro) | sem consumidor identificado (índice `idx_removidos_matricula` sugere lookup, mas 0 scans e nenhum reader) | confirmado (writer); leitura **sem consumidor identificado** |
| 3 | name | text | YES | — | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |
| 4 | whatsapp | text | YES | — | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |
| 5 | unit_id | uuid | YES | — | `sync_cobranca_v2` insert; FK → `units.id` | sem consumidor identificado (índice `idx_removidos_unit_date` cobre, mas 0 scans) | confirmado (writer) |
| 6 | regua_no_momento | text | YES | — | `sync_cobranca_v2` insert (snapshot da `regua`) | sem consumidor identificado | confirmado (writer) |
| 7 | status_no_momento | text | YES | — | `sync_cobranca_v2` insert (snapshot do `status`) | sem consumidor identificado | confirmado (writer) |
| 8 | valor_no_momento | numeric | YES | — | `sync_cobranca_v2` insert (snapshot do valor) | sem consumidor identificado | confirmado (writer) |
| 9 | motivo | text | NO | — | `sync_cobranca_v2` insert (`'sumiu_da_planilha'` ou `'pagamento_feito'`, por notes) | sem consumidor identificado | confirmado (writer); valores **inferido** (notes mencionam os dois caminhos) |
| 10 | dias_na_base | integer | YES | — | `sync_cobranca_v2` insert (calculado de `entrou_em`) | sem consumidor identificado | confirmado (writer) |
| 11 | entrou_em | timestamptz | YES | — | `sync_cobranca_v2` insert (do `created_at` do registro removido) | sem consumidor identificado | confirmado (writer) |
| 12 | removido_em | timestamptz | NO | `now()` | default | sem consumidor identificado | confirmado (default) |
| 13 | sync_log_id | bigint | YES | — | `sync_cobranca_v2` insert; FK → `spreadsheet_sync_log.id` | **lido/filtrado por `rollback_sync`**: `DELETE FROM cobranca_clientes_removidos WHERE sync_log_id = p_sync_log_id` | confirmado (corpo de rollback_sync) |
| 14 | snapshot_date | date | NO | — | `sync_cobranca_v2` insert | sem consumidor identificado | confirmado (writer) |

Sem gaps de ordinal (1–14 contíguos).

## Relacionamentos (FKs)
- `cobranca_clientes_removidos_sync_log_id_fkey`: `sync_log_id` → `spreadsheet_sync_log.id`, **ON DELETE NO ACTION** (`on_delete='a'`).
- `cobranca_clientes_removidos_unit_id_fkey`: `unit_id` → `units.id`, ON DELETE NO ACTION.

## Índices
| índice | def | idx_scan | bytes | veredito |
|--------|-----|----------|-------|----------|
| cobranca_clientes_removidos_pkey | UNIQUE (id) | 0 | 16 kB | PK (zero scans, mas estrutural) |
| idx_removidos_matricula | (matricula) | 0 | 16 kB | nunca usado |
| idx_removidos_unit_date | (unit_id, snapshot_date) | 0 | 16 kB | nunca usado |

### Índices nunca usados (idx_scan=0)
- `idx_removidos_matricula` (16 kB) e `idx_removidos_unit_date` (16 kB): **desperdício** ≈ **32 kB**. Revelam a **intenção** de consulta (por matrícula / por unidade+data) que ainda não foi implementada por nenhum reader. O `pkey` é estrutural; não conta como desperdício removível.

## Triggers
Nenhum.

## RLS / Policies
- **RLS OFF**, sem policies. Documentado em `docs/03-database.md:27`.

## Quem escreve / Quem lê
- **Escreve**: `sync_cobranca_v2` — INSERT das 13 colunas de dados (functions-analysis, confirmado). É escrita **write-only de auditoria**.
- **Lê / consome**: apenas `rollback_sync`, e só a coluna `sync_log_id` no DELETE de limpeza do rollback (confirmado, corpo da função). **Nenhuma** outra coluna tem leitor.
- **Nenhum** edge/n8n/view/app referencia a tabela (scans vazios; grep no app vazio; sem hits em pg_stat_statements).

## Observações
- **Achado-título**: tabela **quase inteiramente write-only**. Das 14 colunas, **13 sem consumidor identificado** (todas menos `sync_log_id`). Isto **não é defeito** — é uma trilha de auditoria que ainda não tem leitor/relatório; é a correta caracterização "sem consumidor identificado", nunca "morta".
- Os dois índices secundários (`matricula`, `unit_id+date`) sinalizam um consumo planejado (ex.: tela/relatório de saídas, ou join com a dashboard) que **ainda não existe** — candidatos a remoção até que o leitor apareça.
- `last_analyze=null` em todas as colunas: `n_live_tup=0` é artefato de nunca-analisada, use `linhas_estimadas≈69`.
