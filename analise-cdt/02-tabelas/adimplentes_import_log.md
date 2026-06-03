# adimplentes_import_log

## Identificação
- **Nome:** `public.adimplentes_import_log`
- **Dono provável:** n8n / Motor v2 (Cobrança). Não definida em migrations do CHAT-CDT (grep sem hits). Escrita por `motor_v2_adimplentes_finalize` (`functions-analysis.json`).
- **Linhas estimadas:** 9 live tuples (`bloco-01`, `n_live_tup`; `n_tup_ins=11`, `n_tup_del=2`, `n_dead_tup=2` → 9 vivas). `linhas_estimadas = -1` (nunca houve ANALYZE — `last_analyze`/`last_autoanalyze` nulos).
- **Tamanho:** 32 kB total / 8.192 bytes heap (`bloco-01`).
- **Classificação:** **Cobrança** (auditoria dos imports semanais de `adimplentes_base`).
- **Bloat:** desprezível (tabela mínima). Sem alerta.

## Finalidade
Trilha de auditoria dos imports semanais da base de adimplentes (`adimplentes_base`). Cada execução de finalização de import grava uma linha com o `batch_id`, a unidade, o arquivo de origem (Drive) e as contagens de linhas (total/novas/atualizadas/removidas). Serve para acompanhar a saúde e o histórico das importações que alimentam o sorteio de relacionamento do Motor v2.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | batch_id | uuid | NÃO | — | INSERT de `motor_v2_adimplentes_finalize` (PK; o `p_batch_id` do import) | PK `adimplentes_import_log_pkey` | confirmado (writer literal) |
| 2 | unit_id | uuid | SIM | — | INSERT de `motor_v2_adimplentes_finalize` (unidade do import) | FK→units | confirmado (FK + writer) |
| 3 | file_name | text | SIM | — | INSERT de `motor_v2_adimplentes_finalize` | sem consumidor identificado (display/auditoria) | confirmado (write) |
| 4 | file_id_drive | text | SIM | — | INSERT de `motor_v2_adimplentes_finalize` (id do arquivo no Google Drive) | sem consumidor identificado | confirmado (write) |
| 5 | rows_total | integer | SIM | — | INSERT (contagem total de linhas do arquivo) | sem consumidor identificado | confirmado (write) |
| 6 | rows_new | integer | SIM | — | INSERT (linhas novas inseridas) | sem consumidor identificado | confirmado (write) |
| 7 | rows_updated | integer | SIM | — | INSERT (linhas atualizadas) | sem consumidor identificado | confirmado (write) |
| 8 | rows_removed | integer | SIM | — | INSERT (linhas marcadas `bi_atual=false`) | sem consumidor identificado | confirmado (write) |
| 9 | error_message | text | SIM | — | **nenhum writer no corpus** — `motor_v2_adimplentes_finalize` insere só 9 das 11 colunas (não inclui esta). Preenchida em caminho de erro fora do corpus, ou desconhecida | sem consumidor identificado | inferido |
| 10 | raw_metadata | jsonb | SIM | — | **nenhum writer no corpus** (idem error_message) — payload extra do import, origem desconhecida | sem consumidor identificado | inferido |
| 11 | imported_at | timestamptz | NÃO | `now()` | default `now()` | sem consumidor identificado | confirmado (default) |

## Relacionamentos (FKs)
- `adimplentes_import_log_unit_id_fkey`: `unit_id → units.id` (`ON DELETE a` = NO ACTION). `bloco-03`. Única FK.

## Índices
| índice | uso (idx_scan) | bytes | nota |
|--------|----------------|-------|------|
| adimplentes_import_log_pkey | 0 | 16.384 | PK em `batch_id` |

### Índices nunca usados (idx_scan=0)
A PK `adimplentes_import_log_pkey` está com `idx_scan=0`, mas **não é desperdício acionável**: (a) não se dropa PK; (b) a tabela tem 9 linhas e a leitura na janela ~13h foi via `seq_scan` (5 seq_scans em `bloco-01`) — a 9 linhas o planner prefere seq scan e ignora o índice. Artefato de tamanho/janela, não índice morto. Desperdício efetivo: 0.

## Triggers
**Nenhum trigger** (`bloco-06` sem entradas). Inserção exclusiva pela função de finalização; sem auditoria automática em `event_log`.

## RLS / Policies
- `rls_on = false` (`bloco-01`), `n_policies = 0`.
- Efeito: **tabela genuinamente aberta** — qualquer role com GRANT lê/escreve; não há proteção de linha. É a **única das quatro** realmente sem RLS.
- **Contexto doc↔banco:** `docs/analise-banco.md` não cita esta tabela nominalmente, mas o alerta genérico de "tabelas expostas sem RLS efetiva" **aplica-se corretamente aqui** (`rls_on=false`), ao contrário de `event_log`/`blacklist_global`/`fila_humana`, onde o mesmo alerta do doc está invertido. Como contém só metadados de import (sem PII de devedor além de `unit_id`), o risco é baixo, mas a inconsistência de postura RLS entre tabelas-irmãs do Motor v2 vale registrar.

## Quem escreve / Quem lê
**Escrita:** `motor_v2_adimplentes_finalize` (secdef=**false**, sem search_path — `functions-analysis.json`) — único writer. Finaliza o import: marca `bi_atual=false` nas linhas da unidade fora do batch atual em `adimplentes_base` e grava 1 log aqui (INSERT de 9 colunas: `batch_id, unit_id, file_name, file_id_drive, rows_total, rows_new, rows_updated, rows_removed, imported_at`). `confidence: confirmado`.

**Leitura:** nenhum reader programático no corpus (funções/edge/n8n/views). `pg_stat` (~13h) não capturou SELECTs. Consumo é **out-of-band**: inspeção manual / dashboard de monitoramento de imports. **Não é tabela morta** — é log de auditoria de baixa cardinalidade, lido sob demanda.

## Observações
- **`sem_consumidor` = 11** (regra estrita: nenhuma coluna tem reader programático identificado; só `batch_id` é PK e `unit_id` participa de FK). Esperado para log de auditoria de import — lido por humanos. **Não é morta.**
- **2 colunas sem writer no corpus** (`error_message`, `raw_metadata`): o writer único insere 9 das 11. `error_message` quase certamente é preenchida no caminho de **falha** do import (que não passa pela função de finalização bem-sucedida analisada) — sua ausência aqui não significa que seja inútil, e sim que o corpus só mapeou o caminho de sucesso. Origem honesta: desconhecida no corpus.
- Sem colunas com espaço no nome.
- **Falta de ANALYZE:** `last_analyze` e `last_autoanalyze` nulos (e `linhas_estimadas=-1`). A 9 linhas é inofensivo, mas indica que a tabela nunca recebeu estatísticas — se crescer e ganhar índices secundários, o planner ficará cego até o primeiro ANALYZE.
- **Inconsistência de auditoria/segurança no Motor v2:** entre as 4 tabelas, três têm `rls_on=true` e esta tem `rls_on=false`; nenhuma das 3 tabelas de log/fila (esta, `blacklist_global`) tem trigger para `event_log`. Postura de RLS e de auditoria não é uniforme dentro do mesmo subsistema — vale padronizar.
