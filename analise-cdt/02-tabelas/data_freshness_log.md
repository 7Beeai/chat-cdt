# data_freshness_log

## Identificação
- **Nome**: `public.data_freshness_log`
- **Dono provável**: Cobrança / telemetria (heartbeat de frescor sobre as tabelas do fluxo n8n/cobrança).
- **Linhas**: estimadas **2.775** (reltuples); `n_live_tup = 255` — divergência por estatísticas obsoletas (`last_analyze`/`last_autoanalyze` = null). 255 inserts na janela de ~13h batem com o cron de 15min escrevendo 5 linhas/execução (~5×4×13 ≈ 260). Fonte: bloco-01 + functions-analysis.
- **Tamanho**: 880 KB total / 360 KB heap. Fonte: bloco-01.
- **Classificação**: **Cobrança** (telemetria/observabilidade do pipeline de cobrança).
- **Bloat**: 880 KB para ~2,7k linhas — aceitável, mas cresce ~25 linhas/h sem TTL (ver Observações).

## Finalidade
Heartbeat de frescor de dados. O cron `data-freshness-check` (15min) chama a função `check_data_freshness`, que calcula o `MAX()` de timestamps em várias tabelas-fonte do fluxo de cobrança (dashboard, setembro, links de pagamento, pagamentos), classifica cada fonte como `ok`/`stale`/`no_data` (considerando horário comercial em America/Sao_Paulo) e insere 1 linha por fonte. Objetivo declarado no COMMENT: **detectar paradas silenciosas** em colunas populadas só por sistemas externos (n8n, edge functions).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval(data_freshness_log_id_seq)` | sequence/default | PK | confirmado |
| 2 | checked_at | timestamptz | NO | `now()` | default (momento do check) | sem consumidor identificado (índice `(source,checked_at)` nunca usado) | inferido (escrito pelo cron; sem leitor) |
| 3 | source | text | NO | — | `check_data_freshness` (insert; nome da tabela-fonte) | sem consumidor identificado | confirmado p/ escrita (functions-analysis); sem leitor |
| 4 | last_write | timestamptz | YES | — | `check_data_freshness` (MAX(ts) da tabela-fonte) | sem consumidor identificado | confirmado p/ escrita |
| 5 | age_minutes | integer | YES | — | `check_data_freshness` (now − last_write, em min) | sem consumidor identificado | confirmado p/ escrita |
| 6 | status | text | NO | — | `check_data_freshness` (`ok`/`stale`/`no_data`) | sem consumidor identificado | confirmado p/ escrita |
| 7 | notes | text | YES | — | `check_data_freshness` (observação textual) | sem consumidor identificado | confirmado p/ escrita |

7 colunas contíguas, sem gaps.

## Relacionamentos (FKs)
Nenhuma FK (bloco-03 sem linhas). Tabela de telemetria standalone.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| data_freshness_log_pkey | UNIQUE btree(id) | 1 | 88 KB |
| idx_data_freshness_log_source_checked | btree(source, checked_at DESC) | **0** | 400 KB |

### Índices nunca usados (idx_scan=0)
- `idx_data_freshness_log_source_checked` (400 KB) — criado claramente para "última checagem por fonte" (`source, checked_at DESC`), mas **nunca usado** porque nenhuma consulta lê esta tabela na janela capturada. **Desperdício: ~400 KB.** É maior que o heap (360 KB) — o índice de leitura custa mais que os próprios dados, e ninguém lê.

## Triggers
Nenhum trigger (bloco-06 sem linhas).

## RLS / Policies
RLS **OFF**, 0 policies. ⚠ **Surpresa de segurança herdada**: `docs/03-database.md:27` lista explicitamente `data_freshness_log` entre as "7 tabelas do n8n com RLS OFF" — flagged mas fora do escopo do CHAT-CDT. Contraste direto com `app_internal_config` (RLS ON deny-all): aqui qualquer role com grant lê tudo. Conteúdo é só telemetria (sem PII), então impacto baixo, mas a inconsistência de postura é real.

## Quem escreve / Quem lê
- **Escreve**: exclusivamente `check_data_freshness` (SECURITY DEFINER), insert de `source/last_write/age_minutes/status/notes`, 5 linhas por execução — functions-analysis, `confirmado`. Disparada pelo cron `data-freshness-check` (15min).
- **Lê**: **nenhum consumidor identificado** em funções, edge functions, n8n, views ou stat. `seq_scan=0`, `idx_scan=1` (só a PK, provavelmente housekeeping).

## Observações
- **Write-only na evidência capturada**: o COMMENT promete "permite detectar paradas silenciosas", mas **nenhum consumidor automatizado lê** esta tabela (nenhum alerta/dashboard/cron de leitura nas fontes). O sinal de "parada silenciosa" é, ele próprio, lido em silêncio — provável consulta humana ad-hoc, ou leitor fora da janela de 13h do snapshot. **Contradição COMMENT↔realidade**: a detecção prometida não está fiada em nada capturado.
- O índice de leitura (`source, checked_at`) nunca usado reforça que ninguém consulta "última checagem por fonte" programaticamente.
- Sem TTL: cresce ~480 linhas/dia. Em meses vira ruído; vale política de retenção (ex.: manter 30-90 dias).
- Estatísticas obsoletas (reltuples 2.775 vs n_live_tup 255): rodar ANALYZE.
