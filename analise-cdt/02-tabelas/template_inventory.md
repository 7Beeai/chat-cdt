# template_inventory

## Identificação
- **Nome**: `public.template_inventory`
- **Dono provável**: **n8n / Sentinela (motor de cobrança)**. CHAT-CDT a trata **read-only** — confirmado por `infra/supabase/migrations/0001_init.sql` ("Templates Meta = public.template_inventory (já existe). Read-only.") e por `docs/03-database.md` ("Templates Meta sincronizados — **read-only** do CHAT-CDT").
- **Linhas estimadas**: 4.110 (`n_live_tup`, bloco-01). 786 `n_dead_tup`.
- **Tamanho**: 12 MB total (heap 9.496 kB; o resto é índice). `bytes_total` = 13.074.432.
- **Classificação**: **Compartilhada** (escrita pela Sentinela via funções `sentinel_*`; lida pelo motor de cobrança v2, pela IA n8n e por views). Observação importante: ao contrário da dica de contexto, **nenhum workflow n8n capturado *escreve* nesta tabela** — os dois fluxos Tatuapé apenas *leem* `template_name`/`body_text` (bloco n8n-workflows). Os writers reais são funções RPC `sentinel_apply_meta_event` e `sentinel_register_variation`.
- **Alerta de bloat**: ~3,18 kB/linha de total (13 MB / 4.110), mas só ~2,3 kB/linha de heap. Heap razoável dado o volume de JSONB (`raw_meta_response`, `meta_event_history`, payloads de variação). 786 dead tuples (~16% das live) com autovacuum recente (2026-06-01) — sob controle. Bloat real está nos **índices nunca usados** (ver abaixo), não no heap.

## Finalidade
Registro local (espelho) dos templates de mensagem WhatsApp submetidos à Meta: nome, WABA, categoria, status de aprovação, quality score, corpo (`body_text`/`components`) e toda a auditoria da **Sentinela** (o "gate" que monitora eventos de webhook da Meta, pausa templates problemáticos na cadência e gera variações automáticas). É a fonte de verdade de *quais* templates o motor de cobrança v2 pode disparar e com que conteúdo. O comentário da tabela a descreve como "Strategic Swarm: registro local dos templates submetidos, status atual, gate da Sentinela, e auditoria de recategorização."

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('template_inventory_id_seq')` | sequence (default) | `sentinel_apply_meta_event` (WHERE id no UPDATE), `sentinel_register_variation` (v_parent.id); auto-ref FK `parent_template_inventory_id` | confirmado (functions-analysis) |
| 2 | template_name | text | NO | — | Sentinela: `sentinel_apply_meta_event` (insert), `sentinel_register_variation` (upsert) | motor_v2_get_disparos, motor_v2_pick_template (x2), motor_v2_relacionamento_get_disparos, picker_select_batch, sentinel_apply_meta_event, n8n Tatuapé (cobr+relac, filtro getAll), v_template_current | confirmado (functions-analysis, n8n, views) |
| 3 | waba_id | text | NO | — | Sentinela (`sentinel_apply_meta_event` insert, `sentinel_register_variation` upsert) | motor_v2_get_disparos, motor_v2_pick_template (x2), motor_v2_relacionamento_get_disparos, picker_select_batch, sentinel_apply_meta_event | confirmado (functions-analysis) |
| 4 | unit_code | text | YES | — | Sentinela (`sentinel_register_variation` upsert) | v_template_health (group by); **RLS** `health_select_template_inventory` (`user_can_read_unit_code(unit_code)`) | confirmado (functions-analysis, views, bloco-09) |
| 5 | category | text | YES | — | Sentinela (`sentinel_apply_meta_event` update, `sentinel_register_variation` upsert) | motor_v2_pick_template (x2), motor_v2_relacionamento_get_disparos, picker_select_batch, sentinel_apply_meta_event, v_template_health | confirmado (functions-analysis, views) |
| 6 | status | text | YES | — | Sentinela (`sentinel_apply_meta_event` update, `sentinel_register_variation` upsert) | motor_v2_pick_template (x2), motor_v2_relacionamento_get_disparos, picker_select_batch, sentinel_apply_meta_event, v_template_health | confirmado (functions-analysis, views) |
| 7 | quality_score | text | YES | — | Sentinela (`sentinel_apply_meta_event` update) | sentinel_apply_meta_event (read), v_template_current | confirmado (functions-analysis, views) |
| 8 | submitted_at | timestamptz | YES | — | desconhecida (não escrito por nenhuma função capturada; provável sync Sentinela/n8n não capturado) | **sem consumidor identificado** | inferido (ausência em writes/reads de functions-analysis) |
| 9 | approved_at | timestamptz | YES | — | **desconhecida** (nenhum writer identificado nas funções/n8n) | **sem consumidor identificado** | inferido (ausência em todos os blocos) |
| 10 | last_checked_at | timestamptz | YES | — | Sentinela (`sentinel_apply_meta_event` insert e update) | **sem consumidor identificado** (escrito p/ auditoria) | confirmado p/ origem (functions-analysis); sem reader |
| 11 | sentinel_pre_score | jsonb | YES | — | **desconhecida** (nenhum writer identificado) | **sem consumidor identificado** | inferido (ausência em todos os blocos) |
| 12 | sentinel_last_check | jsonb | YES | — | **desconhecida** (nenhum writer identificado) | **sem consumidor identificado** | inferido (ausência em todos os blocos) |
| 13 | paused_by_sentinel | boolean | YES | `false` | Sentinela (`sentinel_apply_meta_event` update) | motor_v2_pick_template (x2), motor_v2_relacionamento_get_disparos, picker_select_batch, v_template_health | confirmado (functions-analysis, views) |
| 14 | paused_at | timestamptz | YES | — | Sentinela (`sentinel_apply_meta_event` update) | **sem consumidor identificado** (auditoria) | confirmado p/ origem; sem reader |
| 15 | paused_reason | text | YES | — | Sentinela (`sentinel_apply_meta_event` update) | **sem consumidor identificado** (auditoria) | confirmado p/ origem; sem reader |
| 16 | body_text | text | YES | — | Sentinela (`sentinel_register_variation` upsert) | picker_select_batch, sentinel_apply_meta_event (read), n8n Tatuapé (cobr+relac, lido em "Render Prompt SS") | confirmado (functions-analysis, n8n) |
| 17 | raw_meta_response | jsonb | YES | — | **desconhecida** (nenhum writer identificado; provável dump do payload Meta no sync) | **sem consumidor identificado** | inferido (ausência em todos os blocos) |
| 18 | created_at | timestamptz | NO | `now()` | default | **sem consumidor identificado** | inferido (default; nenhum reader) |
| 19 | updated_at | timestamptz | NO | `now()` | default + Sentinela (`sentinel_apply_meta_event`/`sentinel_register_variation` setam explicitamente) | v_template_current (ORDER BY updated_at DESC na LATERAL) | confirmado (functions-analysis, views) |
| 20 | parent_template_inventory_id | bigint | YES | — | Sentinela (`sentinel_register_variation` upsert) | sentinel_apply_meta_event (WITH RECURSIVE conta gerações); auto-FK | confirmado (functions-analysis, bloco-03) |
| 21 | sentinel_generation | integer | YES | `0` | Sentinela (`sentinel_register_variation` upsert) | sentinel_apply_meta_event (read), sentinel_register_variation (incrementa) | confirmado (functions-analysis) |
| 22 | is_active_in_cadence | boolean | YES | `false` | Sentinela (`sentinel_apply_meta_event` update, `sentinel_register_variation` upsert) | **sem consumidor identificado entre as funções de cadência analisadas** (ver Observações: contradição COMMENT↔código) | confirmado p/ origem; sem reader |
| 23 | meta_template_id | text | YES | — | Sentinela (`sentinel_register_variation` upsert) | motor_v2_pick_template (x2), motor_v2_relacionamento_get_disparos, picker_select_batch | confirmado (functions-analysis) |
| 24 | meta_event_history | jsonb | YES | `'[]'::jsonb` | Sentinela (`sentinel_apply_meta_event` update — append cronológico) | **sem consumidor identificado** (auditoria) | confirmado p/ origem; sem reader |
| 25 | sentinel_variation_rationale | text | YES | — | Sentinela (`sentinel_register_variation` upsert) | **sem consumidor identificado** (auditoria/forense) | confirmado p/ origem; sem reader |
| 26 | sentinel_variation_input | jsonb | YES | — | Sentinela (`sentinel_register_variation` upsert) | **sem consumidor identificado** (auditoria/forense) | confirmado p/ origem; sem reader |
| 27 | sentinel_variation_output | jsonb | YES | — | Sentinela (`sentinel_register_variation` upsert) | **sem consumidor identificado** (auditoria/forense) | confirmado p/ origem; sem reader |
| 28 | submitted_to_meta_at | timestamptz | YES | — | Sentinela (`sentinel_register_variation` upsert) | **sem consumidor identificado** (auditoria) | confirmado p/ origem; sem reader |
| 29 | rejection_reason | text | YES | — | Sentinela (`sentinel_apply_meta_event` update — `reason` quando event=REJECTED) | v_template_current | confirmado (functions-analysis, views) |
| 30 | components | jsonb | YES | — | **ad-hoc**: UPDATE manual via PAT contra `database/query` (bloco-10a, calls=13: `update template_inventory ti set components = (m.data->ti.template_name)...`). NÃO escrito por função/n8n capturado. | motor_v2_get_disparos (monta payload Meta), motor_v2_relacionamento_get_disparos | confirmado (functions-analysis, bloco-10a) |

## Relacionamentos (FKs)
- **`template_inventory.parent_template_inventory_id` → `template_inventory.id`** (auto-referência; `template_inventory_parent_template_inventory_id_fkey`; ON DELETE/UPDATE = NO ACTION). Modela a **árvore de variações** da Sentinela: cada variação automática aponta para o template-pai; `sentinel_generation` indica a profundidade (0=original). `sentinel_apply_meta_event` percorre essa árvore via `WITH RECURSIVE` como guardrail anti-loop por profundidade de chain (bloco-03, functions-analysis).
- Nenhuma outra tabela referencia `template_inventory` por FK (bloco-03). O acoplamento com o motor de cobrança é por **valor** (`waba_id` + `template_name`), não por FK.

## Índices
| índice | tipo | idx_scan | bytes | nota |
|--------|------|----------|-------|------|
| `template_inventory_pkey` | UNIQUE/PK (id) | 192 | 204.800 | usado moderadamente |
| `template_inventory_template_name_waba_id_key` | UNIQUE (template_name, waba_id) | 6.383 | 385.024 | **chave de negócio**; sustenta o `ON CONFLICT (template_name, waba_id)` do upsert e os lookups do n8n |
| `idx_template_inventory_waba_status` | btree (waba_id, status) | **64.878** | 90.112 | índice mais quente — usado pelo picker/motor para filtrar pool por WABA+status |
| `idx_template_inventory_category` | btree (category) | 6.545 | 98.304 | usado |
| `idx_template_inventory_paused` | btree parcial (paused_by_sentinel) WHERE true | 1 | 73.728 | quase nunca usado (1 scan) |
| `idx_template_inventory_meta_id` | btree parcial (meta_template_id) WHERE not null | **0** | 294.912 | **NUNCA USADO** |
| `idx_template_inventory_parent` | btree (parent_template_inventory_id) | **0** | 114.688 | **NUNCA USADO** (a árvore é percorrida por RECURSIVE sem usar este índice) |
| `idx_template_inventory_active_cadence` | btree parcial (waba_id, is_active_in_cadence) WHERE is_active_in_cadence=true | **0** | 8.192 | **NUNCA USADO** — corrobora que `is_active_in_cadence` não tem reader (ver Observações) |

### Índices nunca usados (idx_scan=0)
- `idx_template_inventory_meta_id` — 294.912 bytes (~288 kB)
- `idx_template_inventory_parent` — 114.688 bytes (~112 kB)
- `idx_template_inventory_active_cadence` — 8.192 bytes (~8 kB)
- **Desperdício somado: ~417.792 bytes (~408 kB).** O `active_cadence` reforça o achado de que `is_active_in_cadence` é escrito mas não consultado.

## Triggers
Nenhum trigger nesta tabela (bloco-06 vazio para `template_inventory`). `created_at`/`updated_at` dependem do default e das funções `sentinel_*` setarem `updated_at` explicitamente — **não há trigger de `updated_at`**.

## RLS / Policies
- **RLS habilitado** (`rls_on=true`, não forçado).
- **1 policy** — `health_select_template_inventory` (SELECT, role `authenticated`, `qual = user_can_read_unit_code(unit_code)`). Restringe leitura por unidade do operador. Não há policy de INSERT/UPDATE/DELETE — escritas dependem das funções `sentinel_*` (SECURITY DEFINER) e de acesso `service_role`/PAT, que ignoram RLS.

## Quem escreve / Quem lê
**Escrevem:**
- `sentinel_apply_meta_event` (SECURITY DEFINER) — INSERT (template_name, waba_id, last_checked_at quando template novo) + UPDATE (status, quality_score, category, rejection_reason, last_checked_at, updated_at, meta_event_history, paused_by_sentinel, paused_at, paused_reason, is_active_in_cadence). Aplica eventos de webhook Meta (functions-analysis).
- `sentinel_register_variation` (SECURITY DEFINER) — UPSERT (`ON CONFLICT (template_name, waba_id)`) das colunas de variação (functions-analysis).
- **UPDATE manual ad-hoc** de `components` via PAT (`pat:3649374`) contra `database/query` (bloco-10a, calls=13). Caminho administrativo, não de app.
- Colunas sem writer identificado: `submitted_at`, `approved_at`, `sentinel_pre_score`, `sentinel_last_check`, `raw_meta_response` (origem desconhecida — provável sync da Sentinela/n8n não presente nos artefatos capturados).

**Leem:**
- `motor_v2_get_disparos` (waba_id, template_name, components) — monta payload de disparo (functions-analysis).
- `motor_v2_pick_template` 3-arg e 4-arg (template_name, meta_template_id, waba_id, status, category, paused_by_sentinel) — sorteia template aprovado/UTILITY.
- `motor_v2_relacionamento_get_disparos` (template_name, meta_template_id, category, components, waba_id, status, paused_by_sentinel) — relacionamento semanal.
- `picker_select_batch` (waba_id, status, category, template_name, paused_by_sentinel, meta_template_id, body_text) — seleção do pool de cobrança.
- `sentinel_apply_meta_event` / `sentinel_register_variation` (id, sentinel_generation, etc.) — leituras de auditoria/recursão.
- **n8n Tatuapé Cobrança e Relacionamento** (template_name, body_text) — node "Buscar Template Recebido"; `body_text` injetado no prompt do agente (n8n-workflows).
- Views `v_template_current` e `v_template_health`.
- **PostgREST**: `SELECT * FROM template_inventory WHERE template_name = $1` — 3.289 calls, mean 0,34 ms (bloco-10b). É o lookup do n8n; apesar do `SELECT *`, o consumo downstream é só `template_name`+`body_text` (n8n-workflows), então **não conta como reader de todas as colunas**.

## Observações
- **Contradição COMMENT↔código (relevante)**: o comentário de `is_active_in_cadence` afirma "SOMENTE este flag determina se o motor de cadência (F1) usa o template". Porém, **nenhuma das funções de cadência analisadas** (`motor_v2_pick_template`, `motor_v2_get_disparos`, `motor_v2_relacionamento_get_disparos`, `picker_select_batch`) lê `is_active_in_cadence` — todas filtram por `status` + `paused_by_sentinel`. O índice dedicado `idx_template_inventory_active_cadence` tem `idx_scan=0`. Conclusão: a coluna é **escrita** pela Sentinela mas **sem reader identificado**; tratar o COMMENT como intenção/design, não como comportamento atual verificado.
- **Smell de segurança (functions-analysis, notes)**: `sentinel_apply_meta_event` e `sentinel_register_variation` são **SECURITY DEFINER sem `SET search_path`** e referenciam `template_inventory` **sem qualificação de schema** — dependem do `search_path` do caller; risco de injeção de schema/shadowing. Vale endurecer (`SET search_path = public`).
- **Não é "n8n escreve"** (corrige a dica de contexto): nenhum workflow n8n capturado escreve aqui; os writers são as funções `sentinel_*`. O n8n apenas lê.
- **Cluster de auditoria/forense sem reader (15 colunas)**: `submitted_at`, `approved_at`, `last_checked_at`, `sentinel_pre_score`, `sentinel_last_check`, `paused_at`, `paused_reason`, `raw_meta_response`, `created_at`, `is_active_in_cadence`, `meta_event_history`, `sentinel_variation_rationale/input/output`, `submitted_to_meta_at`. Várias são **escritas para auditoria/observabilidade** (legítimo), não "mortas". As 4 verdadeiramente sem origem nem reader (`approved_at`, `sentinel_pre_score`, `sentinel_last_check`, `raw_meta_response`) são candidatas a investigar (sync externo não capturado?).
- **Bloat de índice**: ~408 kB em 3 índices nunca usados; `meta_id` (288 kB) é o maior. Como CHAT-CDT não é dono da tabela, qualquer drop deve ser coordenado com o time do n8n/Sentinela.
