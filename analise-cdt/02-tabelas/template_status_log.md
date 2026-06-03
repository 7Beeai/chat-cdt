# template_status_log

## Identificação
- **Nome**: `public.template_status_log`
- **Dono provável**: **n8n / Sentinela**. Log de transições de status de template Meta. CHAT-CDT só consome via view `v_template_current`.
- **Linhas estimadas**: `n_live_tup=0` e `linhas_estimadas=-1`. **`-1` = nunca analisada** (`last_analyze`/`last_autoanalyze` null), **não** "vazia". Há forte evidência de que **tem linhas**: 241 `seq_scan`/`idx_scan` e 241 calls PostgREST (bloco-10b) que retornam dados, mais a dependência de `v_template_current`. O `n_live_tup=0` é stale por falta de ANALYZE.
- **Tamanho**: 48 kB total (heap apenas 8.192 bytes).
- **Classificação**: **Compartilhada** (escrita presumivelmente pela Sentinela/webhook Meta — writer não capturado; lida pela view `v_template_current` do CHAT-CDT e por uma query PostgREST recorrente).
- **Alerta de bloat**: nenhum (tabela pequena).

## Finalidade
Trilha de auditoria (append-only) das mudanças de status/categoria/qualidade de cada template: a cada evento, registra `status` novo, `previous_status`, `category`, `quality_score` e `changed_at`. Serve de histórico cronológico que a view `v_template_current` consulta via `DISTINCT ON (template_name) ORDER BY changed_at DESC` para derivar o **estado corrente** de cada template (views-analysis). É o complemento "log" do espelho de estado em `template_inventory`.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('template_status_log_id_seq')` | sequence (default) | **sem consumidor identificado** (PK; não usada em joins capturados) | inferido |
| 2 | template_name | text | NO | — | desconhecida (writer Sentinela/webhook não capturado) | v_template_current (DISTINCT ON / chave); índice `idx_template_status_name` | confirmado p/ leitura (views); origem inferida |
| 3 | status | text | NO | — | desconhecida (writer não capturado) | v_template_current | confirmado p/ leitura (views); origem inferida |
| 4 | category | text | YES | — | desconhecida (writer não capturado) | v_template_current; PostgREST `SELECT template_name,category,created_at WHERE created_at >= $1` (bloco-10b, 241 calls) | confirmado p/ leitura; origem inferida |
| 5 | quality_score | text | YES | — | desconhecida (writer não capturado) | **sem consumidor identificado** (v_template_current puxa quality_score de `template_inventory`, não daqui) | inferido |
| 6 | previous_status | text | YES | — | desconhecida (writer não capturado) | **sem consumidor identificado** | inferido |
| 7 | changed_at | timestamptz | YES | `now()` | default (writer pode sobrescrever) | v_template_current (ORDER BY ... changed_at DESC); índice `idx_template_status_name` | confirmado p/ leitura (views) |
| 8 | created_at | timestamptz | YES | `now()` | default | PostgREST `... WHERE created_at >= $1 ORDER BY template_name, created_at` (bloco-10b, 241 calls); v_template_current expõe como `observed_at` | confirmado (bloco-10b, views) |

Sem gaps de ordinal (1..8 contíguos). Nenhuma coluna com espaço no nome.

## Relacionamentos (FKs)
Nenhuma FK de ou para esta tabela (bloco-03). Liga-se a `template_inventory` apenas por **valor** (`template_name`), explorado na view `v_template_current` (LATERAL por `template_name`).

## Índices
| índice | tipo | idx_scan | bytes | nota |
|--------|------|----------|-------|------|
| `template_status_log_pkey` | UNIQUE/PK (id) | **0** | 16.384 | NUNCA USADO (id não entra em lookup) |
| `idx_template_status_name` | btree (template_name, changed_at DESC) | 241 | 16.384 | usado — sustenta o DISTINCT ON da view / lookups por template |

### Índices nunca usados (idx_scan=0)
- `template_status_log_pkey` — 16.384 bytes. É o PK (estrutural, garante unicidade de `id`), então não é "desperdício" removível, apenas nunca serviu a uma busca. **Desperdício removível efetivo: 0 kB.**

## Triggers
Nenhum (bloco-06 vazio). Confirma que `template_status_log` **não é populada por trigger** — quem grava é um processo externo (Sentinela/webhook Meta) não presente nos artefatos analisados.

## RLS / Policies
- **RLS habilitado** (`rls_on=true`, não forçado).
- **1 policy** — `"Authenticated users can read template status"` (SELECT, role `authenticated`, **`qual = true`**). Qualquer usuário autenticado lê **todas as linhas, sem escopo de unidade**.
- **Inconsistência de modelo de acesso**: `template_inventory` é escopado por unidade (`user_can_read_unit_code(unit_code)`), mas este log é aberto (`true`). Como o log não tem `unit_code`, não há como escopar sem alterar o schema — mas vale notar o vazamento cross-unit de histórico de templates a qualquer autenticado.

## Quem escreve / Quem lê
- **Escreve**: **writer não identificado** nos artefatos (sem trigger, sem função em functions-analysis, sem n8n, sem stat de INSERT). Origem das linhas presumivelmente a Sentinela ou um handler de webhook Meta fora do escopo capturado. Origem de cada coluna marcada "desconhecida" por isso.
- **Lê**:
  - View `v_template_current` (template_name, status, category, created_at→observed_at; ORDER BY changed_at DESC) — consumidor primário do CHAT-CDT (views-analysis).
  - PostgREST recorrente: `SELECT template_name, category, created_at WHERE created_at >= $1 ORDER BY template_name, created_at` — 241 calls, mean 0,03 ms (bloco-10b). Provável materialização/monitoramento de status.

## Observações
- **`linhas_estimadas=-1`/`n_live_tup=0` são stale** (nunca houve ANALYZE). A tabela claramente tem dados (241 scans + 241 calls + dependência da view). Não classificar como vazia/morta. Recomendar `ANALYZE`.
- **Writer ausente dos artefatos**: a gravação do log é feita por componente externo (Sentinela/webhook) não coberto pela extração — lacuna de lineage a documentar, não dado morto.
- **`quality_score` e `previous_status` sem reader identificado**: `v_template_current` busca `quality_score` em `template_inventory`, não neste log; `previous_status` não é lido por nenhum consumidor capturado. São colunas de auditoria/histórico — registradas, mas sem consumo atual conhecido.
- **Policy `qual=true`** (acesso aberto a autenticados) contrasta com a policy unit-scoped de `template_inventory` — inconsistência de governança de leitura.
- O PK nunca usado em busca é normal para tabela de log append-only consultada por `(template_name, changed_at)`.
