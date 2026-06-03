# message_log

## Identificação

- **Nome:** `public.message_log`
- **Dono provável:** n8n / Cobrança (régua de disparos). Escrita também por RPCs da camada de cobrança (`advance_cadence_state`, `record_message_status`).
- **Linhas estimadas:** 259.699 (analyze) / `n_live_tup` 262.047, `n_dead_tup` 27.921 (~10,7% mortas). (bloco-01)
- **Tamanho:** 291 MB total / heap 170 MB (~121 MB em índices). (bloco-01)
- **Classificação:** **Cobrança.**
- **Bloat / densidade:** ~1.166 bytes/linha total (305.389.568 / 262.047). O heap dá ~648 bytes/linha — alto, puxado pela coluna `raw_response` (jsonb com o payload bruto da Meta). Índices somam ~121 MB e, destes, ~62 MB nunca foram usados (ver seção Índices). `last_vacuum`/`last_autovacuum` ambos `null` apesar de 24.858 updates e ~28k tuplas mortas — **a tabela nunca passou por VACUUM** na janela observada; só `autoanalyze` rodou (2026-06-01). (bloco-01)

## Finalidade

Auditoria 1-para-1 de cada **envio outbound** de mensagem WhatsApp da régua de cobrança (templates disparados pelo "Send Executor" do n8n). Cada linha = uma tentativa de envio de template para um devedor, com o contexto da cadência (fase/dia/slot/variante), o identificador do WhatsApp da Meta (`wa_message_id`), o ciclo de status de entrega (sent → delivered → read → failed) e os dados de precificação que a Meta retorna no callback (categoria/billable/modelo). O `UNIQUE(wa_message_id)` garante idempotência contra reprocessamento de webhooks. (bloco-01 comentário; functions-analysis `advance_cadence_state`, `record_message_status`)

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('message_log_id_seq')` | sequence (default) | PK `message_log_pkey`; sem leitor aplicativo conhecido (idx_scan do PK = 1) | confirmado (default visível) |
| 2 | matricula | text | NO | — | App/n8n no INSERT (PostgREST e `advance_cadence_state` escrevem `matricula`) | trigger `sync_data_ultimo_disparo_from_message_log` lê `NEW.matricula` para casar em `clientes_cobranca_*` | confirmado (functions-analysis: write em ambos os writers; read no trigger — read marcado 'inferido' via NEW) |
| 3 | unit_id | uuid | NO | — | App/n8n no INSERT; FK → `units.id` | RPCs de relatório (`rpc_dispatches_hourly`, `rpc_failure_codes`, `rpc_inbound_summary`, `rpc_message_cost`); view `v_message_perf_24h`; policy `user_can_read_unit(unit_id)`; query PostgREST do stat | confirmado (writers + readers literais em functions/views) |
| 4 | phone_number_id | text | NO | — | App/n8n no INSERT (número de origem WABA) | índice `idx_message_log_phone_sent` (nunca usado, idx_scan=0); sem leitor de query/função identificado | inferido (escrito por ambos writers; nome ≠ genérico mas sem leitor confirmado) |
| 5 | to_whatsapp | text | NO | — | App/n8n no INSERT (telefone destino do devedor) | sem consumidor de leitura identificado | inferido (writer confirmado; nenhum reader nos artefatos) |
| 6 | template_name | text | NO | — | App/n8n no INSERT (nome do template Meta disparado) | índice `idx_message_log_template` (nunca usado, idx_scan=0); candidato a cruzamento com `template_inventory.category` (ver pricing_category) | inferido (writer confirmado; sem reader de função/view; índice ocioso) |
| 7 | cadence_fase | text | YES | — | `advance_cadence_state` (write) e PostgREST INSERT | sem leitor identificado (campo de contexto/auditoria) | confirmado como escrita; **sem consumidor de leitura identificado** |
| 8 | cadence_dia_ciclo | integer | YES | — | `advance_cadence_state` (write) e PostgREST INSERT | sem leitor identificado | confirmado como escrita; sem consumidor de leitura identificado |
| 9 | cadence_slot | integer | YES | — | `advance_cadence_state` (write) e PostgREST INSERT | sem leitor identificado | confirmado como escrita; sem consumidor de leitura identificado |
| 10 | cadence_variante | integer | YES | — | **desconhecida** — NÃO aparece na lista de colunas escritas por `advance_cadence_state` nem no INSERT do PostgREST do stat (que insere `cadence_dia_ciclo/fase/slot` mas não `variante`) | sem leitor identificado | inferido (coluna de contexto A/B; nenhum writer/reader nos artefatos analisados → provavelmente populada por outra ramificação do n8n ou sempre NULL) |
| 11 | wa_message_id | text | YES | — | `advance_cadence_state` (write, em ON CONFLICT) e `record_message_status` (UPDATE/WHERE). **Não** está no INSERT do PostgREST do stat | `record_message_status` localiza a linha por `wa_message_id` (WHERE); índice único `idx_message_log_wa_id` (idx_scan=90.124, o mais usado) | confirmado (writer + WHERE literal + índice único dedicado) |
| 12 | sent_at | timestamptz | NO | `now()` | default `now()` no INSERT (writers não setam explicitamente, exceto `advance_cadence_state` que lista `sent_at`) | RPCs de relatório filtram por janela `sent_at >= …`; view `v_message_perf_24h`; trigger lê `NEW.sent_at`; índices `idx_message_log_sent_at` (idx_scan=3.343) e `idx_message_log_unit_sent` (44); query PostgREST do stat (781 calls) filtra `sent_at BETWEEN $1 AND $2` | confirmado (reader literal em múltiplas funções/views/stat) |
| 13 | status | text | NO | `'sent'::text` | default `'sent'` no INSERT; `record_message_status` faz UPDATE | `rpc_failure_codes` (filtra `'failed'`), `rpc_inbound_summary`, `v_message_perf_24h` (FILTER por status); | confirmado (default + writer + readers literais) |
| 14 | status_updated_at | timestamptz | YES | — | `record_message_status` (UPDATE) | sem leitor identificado | confirmado como escrita; sem consumidor de leitura identificado |
| 15 | failure_code | text | YES | — | `record_message_status` (UPDATE); também no INSERT do PostgREST do stat | `rpc_failure_codes` agrega `failure_code` (status='failed', 7 dias) | confirmado (writer + reader literal) |
| 16 | failure_reason | text | YES | — | `record_message_status` (UPDATE); também no INSERT do PostgREST do stat | `rpc_failure_codes` agrega `failure_reason` | confirmado (writer + reader literal) |
| 17 | raw_response | jsonb | YES | — | `advance_cadence_state` (INSERT) e `record_message_status` (UPDATE); também no INSERT do PostgREST do stat (payload bruto da Meta) | sem leitor estruturado identificado (auditoria/forense) | confirmado como escrita; **sem consumidor de leitura identificado**. Maior contribuinte do bloat de heap |
| 18 | delivered_at | timestamptz | YES | — | `record_message_status` (UPDATE, do callback Meta) | `v_message_perf_24h` calcula latência `delivered_at - sent_at` | confirmado (writer + reader literal) |
| 19 | read_at | timestamptz | YES | — | `record_message_status` (UPDATE) | `v_message_perf_24h` (latência de leitura) | confirmado (writer + reader literal) |
| 20 | failed_at | timestamptz | YES | — | `record_message_status` (UPDATE) | sem leitor identificado (RPCs de falha usam `status`/`sent_at`, não `failed_at`) | confirmado como escrita; sem consumidor de leitura identificado |
| 21 | conversation_category | text | YES | — | `record_message_status` (UPDATE; de `statuses[].pricing.category` ou `conversation.origin.type`) | sem leitor identificado (relatórios de custo usam `pricing_category`) | confirmado como escrita (comentário da coluna + writer); sem consumidor de leitura identificado |
| 22 | pricing_billable | boolean | YES | — | `record_message_status` (UPDATE) | `rpc_message_cost` agrega volume cobrável | confirmado (writer + reader literal) |
| 23 | pricing_model | text | YES | — | `record_message_status` (UPDATE) | sem leitor identificado | confirmado como escrita; sem consumidor de leitura identificado |
| 24 | pricing_category | text | YES | — | `record_message_status` (UPDATE; categoria cobrada pela Meta) | `rpc_message_cost` (volume por categoria). Comentário sugere cruzar com `template_inventory.category` p/ detectar reclassificação de billing — cruzamento NÃO implementado em nenhuma função observada | confirmado como escrita + reader literal em `rpc_message_cost` |

**Gaps de ordinal:** nenhum. `pos` vai de 1 a 24 sem buraco → nenhuma coluna foi droppada. (bloco-02)

## Relacionamentos (FKs)

- `message_log.unit_id` → `units.id` (`message_log_unit_id_fkey`, ON DELETE `a` = NO ACTION, ON UPDATE `a`). (bloco-03)
- **Sem** FK em `matricula` para `clientes_cobranca_*` (o casamento é por texto no trigger, não por integridade referencial). Isso é coerente com a coexistência com o n8n. (bloco-03 — só 1 FK)
- Nenhuma tabela referencia `message_log` (não é alvo de FK de ninguém). (bloco-03)

## Índices

| índice | único | idx_scan | bytes | nota |
|--------|-------|----------|-------|------|
| `idx_message_log_wa_id` (UNIQUE, partial WHERE wa_message_id IS NOT NULL) | sim | 90.124 | 30,1 MB | **mais quente**; sustenta idempotência e o WHERE de `record_message_status` |
| `idx_message_log_sent_at` (sent_at) | não | 3.343 | 6,6 MB | janelas temporais dos relatórios |
| `idx_message_log_unit_sent` (unit_id, sent_at DESC) | não | 44 | 20,9 MB | filtros por unidade+tempo (uso baixo) |
| `message_log_pkey` (id) | sim | 1 | 7,0 MB | PK; quase não usado em SELECT |
| `idx_message_log_matricula` (matricula) | não | **0** | 3,7 MB | **NUNCA USADO** |
| `idx_message_log_phone_sent` (phone_number_id, sent_at DESC) | não | **0** | 24,9 MB | **NUNCA USADO** |
| `idx_message_log_template` (template_name, sent_at DESC) | não | **0** | 33,5 MB | **NUNCA USADO** |

(bloco-04)

### Índices nunca usados (idx_scan=0)

- `idx_message_log_template` — 33.497.088 bytes (~31,9 MB)
- `idx_message_log_phone_sent` — 24.928.256 bytes (~23,8 MB)
- `idx_message_log_matricula` — 3.661.824 bytes (~3,5 MB)

**Desperdício total: ~62.087.168 bytes ≈ 59,2 MB** parados (≈ metade do volume de índices da tabela). Atenção à janela: o snapshot de `pg_stat` cobre ~13h e o `idx_scan` é acumulado desde o último reset de stats — se as stats foram resetadas recentemente, idx_scan=0 pode subestimar uso real. Ainda assim, com a tabela viva e os relatórios filtrando por `unit_id`/`sent_at`/`status`, esses três índices (matrícula, phone, template) não têm consumidor de query identificado e são fortes candidatos a `DROP` — mas só após confirmar que nenhum workflow do n8n faz lookup por `matricula`/`template_name` fora da janela. (bloco-04)

## Triggers

- `trg_sync_data_ultimo_disparo` — `AFTER INSERT FOR EACH ROW`, executa `sync_data_ultimo_disparo_from_message_log()`. (bloco-06)
  - **Efeito:** ao registrar um disparo, propaga `sent_at` (convertido para BRT, idempotente) para `clientes_cobranca_setembro.data_ultimo_disparo` e `clientes_cobranca_dashboard.data_ultimo_disparo`, casando por `matricula`. Atualiza só se a data atual for nula ou mais antiga. (functions-analysis: `sync_data_ultimo_disparo_from_message_log`)
  - **Implicação de carga:** todo INSERT em `message_log` dispara 2 UPDATEs em tabelas de cobrança. Isso explica parte dos `n_tup_upd` cruzados na régua.

## RLS / Policies

- RLS **habilitado** (`rls_on=true`), **não forçado** (`rls_forced=false`) → o `service_role`/owner contorna RLS; só usuários `authenticated` são filtrados. (bloco-01)
- Policy única `health_select_message_log`: `PERMISSIVE`, role `authenticated`, `SELECT`, `qual = user_can_read_unit(unit_id)`. (bloco-09)
  - Apenas leitura, escopada por unidade do usuário. **Não há policy de INSERT/UPDATE/DELETE** → escrita só por `service_role` (n8n/PostgREST) ou por RPCs `SECURITY DEFINER` (`advance_cadence_state`, `record_message_status`). Consistente: a app não escreve direto.
  - **Sem policies duplicadas/sobrepostas** (n_policies=1).

## Quem escreve / Quem lê

**Escreve (INSERT):**
- **PostgREST direto (writer `inferido` = n8n)** — caminho dominante no snapshot: 371 INSERTs na janela (bloco-10). Insere `matricula, unit_id, phone_number_id, to_whatsapp, template_name, status, cadence_fase/dia_ciclo/slot, failure_code/reason, raw_response`. **Não** seta `wa_message_id`, `sent_at` (usa default `now()`), nem `cadence_variante`. (bloco-10a/b). **Atribuição a n8n por eliminação**, não por evidência direta: `n8n-workflows.json` tem **0** menções a `message_log`; a app própria não pode escrever (policy só de SELECT); nenhuma edge function menciona a tabela (edge-functions.json = 0 hits). Logo, sobra o `service_role` usado pelo n8n via PostgREST — provável, não comprovado no export de workflows.
- **`advance_cadence_state`** (RPC SECURITY DEFINER) — INSERT idempotente com `ON CONFLICT (wa_message_id)`, incluindo `wa_message_id` e `sent_at`. (functions-analysis)

**Escreve (UPDATE):**
- **`record_message_status`** (RPC SECURITY DEFINER) — atualiza o ciclo de status/pricing a partir do callback da Meta, localizando por `wa_message_id`: `status, status_updated_at, failure_code, failure_reason, delivered_at, read_at, failed_at, conversation_category, pricing_billable, pricing_model, pricing_category, raw_response`. (functions-analysis). Sem `SET search_path` — apontado nas notas como ponto de atenção de segurança.

**Lê (SELECT):**
- View `v_message_perf_24h` — `unit_id, status, delivered_at, sent_at, read_at` (entregabilidade 24h por unidade). (views-analysis)
- `rpc_dispatches_hourly` — `sent_at, unit_id` (distribuição horária). (functions-analysis)
- `rpc_failure_codes` — `failure_code, failure_reason, status, sent_at, unit_id` (falhas 7d). (functions-analysis)
- `rpc_inbound_summary` — `unit_id, status, sent_at` (resumo diário, FULL OUTER JOIN com `message_inbound`/`clientes_cobranca_dashboard`). (functions-analysis)
- `rpc_message_cost` — `pricing_category, pricing_billable, sent_at, unit_id` (custo Meta 7d). (functions-analysis)
- Trigger `sync_data_ultimo_disparo_from_message_log` — lê `NEW.sent_at, NEW.matricula`. (functions-analysis)
- Query PostgREST do stat (781 calls) — `SELECT unit_id WHERE sent_at BETWEEN`. (bloco-10) — provável feed de algum painel/cron.

## Observações

1. **Contradição doc↔COMMENT (importante).** O COMMENT da tabela diz *"Não inclui inbound (esse fica no Chatwoot)"*, mas `docs/03-database.md` afirma que o inbound vive em `message_inbound` (tabela do n8n, ~27k linhas) e a app própria do CHAT-CDT guarda inbound em `messages`. **Não há evidência de Chatwoot** em nenhum artefato analisado (migrations, docs, n8n-workflows). O COMMENT parece desatualizado/herdado de uma arquitetura anterior; a verdade operacional é `message_log` (outbound) ⟷ `message_inbound` (inbound), confirmada por `rpc_inbound_summary` que faz JOIN entre as duas. Tratar a menção a Chatwoot como **legado de comentário**, não como fato.

2. **Duas populações de linhas distintas (não uma linha mutada no tempo).** Os dois caminhos de escrita gravam conjuntos de colunas diferentes:
   - **PostgREST direto** insere `failure_code`/`failure_reason` e **sem `wa_message_id`** → coerente com registro de **falhas terminais** (envios que nunca receberam um message id da Meta).
   - **`advance_cadence_state`** insere envios bem-sucedidos **com `wa_message_id`** + `ON CONFLICT (wa_message_id)`, que `record_message_status` depois atualiza casando por `wa_message_id`.

   O ponto-chave: `record_message_status` localiza a linha **pelo `wa_message_id` (WHERE)**, então ele **nunca** toca as linhas sem wamid inseridas pelo PostgREST — não há "backfill" do wamid nessas linhas. **Corroboração no dado:** `n_tup_upd = 24.858` (bloco-01) é **exatamente igual** a `idx_message_log_wa_id.idx_tup_fetch = 24.858` (bloco-04) → todo o caminho de UPDATE passa pelo índice de wamid, nunca pelas linhas sem wamid. A divisão exata entre linhas de sucesso (com wamid) e de falha (sem wamid) fica **não confirmada** (análise read-only, sem query ao dado); recomenda-se `COUNT(*) FILTER (WHERE wa_message_id IS NULL)` para quantificar.

3. **`cadence_variante` órfã.** Nenhum dos dois writers observados popula `cadence_variante`, e nenhum reader a consome. Origem **desconhecida** — ou é preenchida por uma ramificação do n8n não capturada, ou está sempre NULL (coluna de A/B testing planejada e não usada). Vale uma verificação de dados (`COUNT(*) WHERE cadence_variante IS NOT NULL`).

4. **Colunas escritas mas não lidas (auditoria/forense, OK):** `phone_number_id`, `to_whatsapp`, `cadence_fase/dia_ciclo/slot`, `status_updated_at`, `failed_at`, `conversation_category`, `pricing_model`, `raw_response`. Não são "mortas" — servem auditoria/debug; apenas **sem consumidor de leitura identificado** nos artefatos. `raw_response` (jsonb) é o maior custo de armazenamento e candidato a política de retenção/arquivamento.

5. **Manutenção (bloat).** ~28k tuplas mortas, `last_vacuum`/`last_autovacuum` nulos, 24.858 updates acumulados (`record_message_status` atualiza cada linha 1+ vez ao longo do ciclo sent→delivered→read). Sem VACUUM, o heap tende a inchar com tuplas mortas dos UPDATEs. Recomendável avaliar `autovacuum` mais agressivo nesta tabela e/ou `VACUUM` manual pontual. (bloco-01)

6. **Desperdício de índice ~59 MB** (3 índices idx_scan=0) — ver seção Índices. Maior ganho rápido de espaço se confirmada a ausência de uso fora da janela.

7. **Tabela do n8n — não alterar estrutura.** Em linha com o CLAUDE.md, qualquer mudança (drop de índice, ajuste de autovacuum, retenção de `raw_response`) deve ser coordenada com a equipe do n8n; o CHAT-CDT só lê (policy SELECT) e escreve via RPCs já existentes.
