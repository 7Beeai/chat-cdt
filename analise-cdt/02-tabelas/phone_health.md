# phone_health

## Identificação
- **Nome**: `public.phone_health`
- **Dono provável**: n8n / cobrança ("Strategic Swarm Health"). Não existe DDL nas migrations do CHAT-CDT (`infra/supabase/migrations/`, grep vazio); `docs/03-database.md:24` lista explicitamente como "telemetria que o n8n popula".
- **Classificação**: **Cobrança**
- **Linhas estimadas**: ~20.209 (`linhas_estimadas`/`reltuples`, bloco-01). ATENÇÃO: `n_live_tup`=1001 e `n_tup_ins`=1001 são contadores "desde o reset de stats", não a contagem real — `last_analyze`/`last_autoanalyze`/`last_vacuum`/`last_autovacuum` são TODOS `null`, ou seja a tabela nunca foi analisada nem aspirada.
- **Tamanho**: 20 MB total (12 MB heap, ~8 MB índices), bloco-01.
- **Bloat**: ~0,6 KB/linha de heap (12 MB / 20.209) com duas colunas potencialmente pesadas (`raw_response` jsonb). Não é bloat alarmante. O alerta operacional real é o **nunca-analisada/nunca-aspirada** (autovacuum nunca rodou).

## Finalidade
Log histórico (série temporal, append-only) de saúde por `phone_number_id` (ID do número na Graph API da Meta). Cada linha é um snapshot de qualidade/status de um número WhatsApp, gravado tanto por **polling da Graph API** quanto por **eventos de webhook** da Meta. Alimenta a view `v_phone_health_current` (último snapshot por número) e é a fonte de verdade de cor de qualidade lida pelo motor de gate (`motor_v2_recalc_gate`).

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('phone_health_id_seq')` | sequence serial (default explícito) | PK; nenhum leitor de negócio | confirmado (default) |
| 2 | phone_number_id | text | NO | — | RPCs `record_phone_health_snapshot` (polling) e `record_meta_account_event` (webhook), col escrita literalmente (functions-analysis) | `v_phone_health_current`, `motor_v2_recalc_gate`, `rpc_phone_health_last_change` | confirmado |
| 3 | unit_id | uuid | YES | — | resolvido pelas RPCs writer (subselect em `disparadores_whatsapp` por waba/número) | `v_phone_health_current`, `motor_v2_recalc_gate` (DISTINCT ON), `rpc_phone_health_last_change`, policy RLS, trigger `NEW.unit_id` | confirmado (writer); FK→units |
| 4 | quality_rating | text | YES | — | RPCs writer (polling + webhook) | `v_phone_health_current`, `motor_v2_recalc_gate` (mapeia GREEN/YELLOW/RED), `rpc_phone_health_last_change` (LAG p/ transição) | confirmado |
| 5 | messaging_limit_tier | text | YES | — | **só** `record_phone_health_snapshot` (polling), functions-analysis | sem consumidor identificado (views não selecionam) | confirmado (writer) / sem consumidor |
| 6 | status | text | YES | — | RPCs writer (polling + webhook) | `v_phone_health_current` | confirmado |
| 7 | name_status | text | YES | — | RPCs writer (polling + webhook) | sem consumidor identificado | confirmado (writer) / sem consumidor |
| 8 | code_verification_status | text | YES | — | **só** `record_phone_health_snapshot` (polling) | sem consumidor identificado | confirmado (writer) / sem consumidor |
| 9 | observed_at | timestamptz | NO | `now()` | default `now()` no INSERT da RPC | `v_phone_health_current` (DISTINCT ON ... ORDER BY observed_at DESC), `motor_v2_recalc_gate`, `rpc_phone_health_last_change`, índices | confirmado |
| 10 | raw_response | jsonb | YES | — | RPCs writer; polling marca `raw_response._source='graph_polling'` (functions-analysis/notes) | sem consumidor identificado (nenhuma view/função lê) | confirmado (writer) / sem consumidor |
| 11 | event | text | YES | — | **só** `record_meta_account_event` (webhook `phone_number_quality_update`: FLAGGED/UNFLAGGED/ONBOARDING — COMMENT da coluna) | `v_phone_health_current` | confirmado (writer) |
| 12 | current_limit | text | YES | — | **só** `record_meta_account_event` (webhook; messaging_limit_tier informado no evento de qualidade — COMMENT da coluna) | `v_phone_health_current` | confirmado (writer) |

Sem colunas com espaço no nome. Sem gaps de ordinal (1→12 contíguo) — nenhuma coluna droppada.

## Relacionamentos (FKs)
- `phone_health_unit_id_fkey`: `unit_id → units.id` (ON DELETE NO ACTION, ON UPDATE NO ACTION), bloco-03.
- Não há FK de `phone_number_id` para `chat_phone_numbers`/`disparadores_whatsapp` (o n8n não tem `phone_number_id` da Graph API — `docs/03-database.md:22`).

## Índices
| índice | def | idx_scan | bytes | nota |
|--------|-----|----------|-------|------|
| `idx_phone_health_phone_observed` | (phone_number_id, observed_at) ASC | **2016** | 1,84 MB | ÚNICO realmente usado; PG o varre de trás p/ frente p/ atender o ORDER BY DESC da view |
| `idx_phone_health_unit_at` | (unit_id, observed_at DESC) | 560 | 1,63 MB | usado (filtro por unidade) |
| `idx_phone_health_phone_at` | (phone_number_id, observed_at DESC) | 0 | 1,97 MB | **NUNCA USADO** — duplicata DESC de baixo |
| `idx_phone_health_recent` | (phone_number_id, observed_at DESC) | 0 | 1,97 MB | **NUNCA USADO** — byte-idêntico ao anterior |
| `phone_health_pkey` | UNIQUE (id) | 0 | 0,53 MB | PK (necessário p/ unicidade, não conta como desperdício) |

### Índices nunca usados (idx_scan=0)
- `idx_phone_health_phone_at` (1,97 MB) e `idx_phone_health_recent` (1,97 MB) são **redundantes**: dois índices DESC byte-idênticos sobre `(phone_number_id, observed_at DESC)`, ambos ociosos, enquanto a variante ASC (`idx_phone_health_phone_observed`) é a que serve a view. Antipattern clássico de par DESC/ASC.
- **Desperdício removível ≈ 3,75 MB** (os dois DESC duplicados). O `phone_health_pkey` (0,53 MB) aparece com idx_scan=0 mas é estrutural — **excluído da conta**.

## Triggers
- `trg_motor_v2_gate_from_phone_health` — AFTER INSERT, ROW, função `trg_motor_v2_recalc_gate_from_health` (bloco-06). Lê `NEW.unit_id` e chama `motor_v2_recalc_gate()`, que por sua vez relê `phone_health` (snapshot mais recente por DISTINCT ON). Só grava em `event_log` no bloco EXCEPTION (falha não derruba o INSERT). Este é o caminho que recalcula a cor de qualidade do gate a cada novo snapshot de número.

## RLS / Policies
- `rls_on`=true, `rls_forced`=false (bloco-01).
- 1 policy: `health_select_phone_health` — SELECT, role `authenticated`, `qual = user_can_read_unit(unit_id)` (bloco-09). É o helper da cobrança (`user_can_read_unit`), não o `chat_user_has_unit` do CHAT-CDT.
- Sem policies de INSERT/UPDATE/DELETE → escritas só pelas RPCs SECURITY DEFINER (que ignoram RLS). Consistente, não há sobreposição/duplicação.

## Quem escreve / Quem lê
- **Escreve**: `record_phone_health_snapshot` (RPC SECURITY DEFINER, polling Graph API — insere phone_number_id, unit_id, quality_rating, messaging_limit_tier, status, name_status, code_verification_status, raw_response; functions-analysis "confirmado") e `record_meta_account_event` (RPC, webhook — insere phone_number_id, unit_id, quality_rating, status, name_status, event, current_limit, raw_response). No snapshot de stat (~13h), `record_phone_health_snapshot` foi chamada **1014×** (bloco-10b), mean 6,66ms — é o writer dominante.
- **Quem dispara as RPCs upstream**: provável n8n/cron (polling) e webhook da Meta. Meu grep em `edge-functions.json` e `n8n-workflows.json` retornou **vazio** para estas tabelas/RPCs — logo o autor upstream é **inferido** (apoiado por docs, COMMENT e o marker `_source='graph_polling'`), não confirmado.
- **Lê**: `v_phone_health_current` (REST/PostgREST — bloco-10a: 466 chamadas, mean **3.147ms**; variante filtrada por unit_id 42×, **3.654ms**); `motor_v2_recalc_gate` (DISTINCT ON do snapshot mais recente, functions-analysis "confirmado"); `rpc_phone_health_last_change` (query direta na tabela — bloco-10a: 507 chamadas, mean **1.008ms**); policy RLS.

## Observações
- **Performance crítica**: `v_phone_health_current` via PostgREST custa ~3,1–3,6s por chamada (centenas de chamadas/dia). DISTINCT ON sobre ~20k linhas com jsonb pesado. Vale índice/refatoração (materialização ou `chat_phone_numbers`-side cache).
- **Par de índices DESC redundantes** (3,75 MB ociosos) — candidatos a DROP.
- **Stats stale**: nunca houve analyze/vacuum/autovacuum nesta tabela — planner pode estar cego; risco de planos ruins (relevante dado o custo de 3s da view).
- **Origem split por writer**: `event`/`current_limit` só vêm do webhook; `messaging_limit_tier`/`code_verification_status` só do polling. Misturar as duas fontes na mesma tabela é intencional (snapshot unificado) mas significa que metade das colunas fica nula dependendo da fonte do evento.
- 4 colunas **sem consumidor identificado** (write-only): `messaging_limit_tier`, `name_status`, `code_verification_status`, `raw_response`. NÃO são "mortas" — são gravadas e a tabela é central; apenas nenhum leitor atual as projeta.
- Contradição leve doc↔banco: nenhuma. O COMMENT da tabela ("polling Graph API + eventos webhook") bate com os dois writers encontrados.
