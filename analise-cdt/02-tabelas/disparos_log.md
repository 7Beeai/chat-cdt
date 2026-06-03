# disparos_log

## Identificação
- **Nome:** `public.disparos_log`
- **Dono provável:** n8n / cobrança — **Motor v2** (NÃO é tabela do CHAT-CDT; ausente das migrations `0001`–`0013`).
- **Linhas estimadas:** **desconhecida (nunca analisada)** — `linhas_estimadas=-1`, `last_analyze=null`, `n_live_tup=0`, `n_tup_ins=0`. NÃO é zero: é tabela recém-implantada e ainda sem `ANALYZE` (bloco-01).
- **Tamanho:** 56 kB total, `tamanho_heap=0 bytes` (heap ainda vazio/recém-criado).
- **Classificação:** **Cobrança** (Motor v2 — plano do dia + log de entrega).
- **Bloat:** não avaliável (heap 0). Sem alerta.
- **RLS:** ON, **0 policies** → com RLS ligada e sem policy, só service_role / owners enxergam (todos os escritores conhecidos usam service_role).

## Finalidade
Motor v2: **uma linha por mensagem programada/enviada** de cobrança WhatsApp. As edge functions de cron pré-populam linhas `PROGRAMADA` (plano do dia, `scheduled_for::date = today`) por unidade/slot; o sender externo + webhook da Meta transicionam `PROGRAMADA → ENVIADA → ENTREGUE/LIDA` (ou `FALHOU`) preenchendo os timestamps e o `wa_message_id`. Plano do dia = `SELECT WHERE scheduled_for::date = today` (comentário da tabela, bloco-01).

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('disparos_log_id_seq')` | sequence (default) | event_log (audit trigger); SELECT internos das edges | confirmado (default) |
| 2 | unit_id | uuid | NO | — | edge `motor-v2-planejador` / `motor-v2-sortear-relacionamento` (insert) → FK `units.id` | edges (WHERE/group), `motor_v2_cancel_future_disparos` (WHERE) | confirmado (edge-functions.json) |
| 3 | cliente_cadencia_id | bigint | YES | — | edges (insert) → FK `cliente_cadencia.id` | event_log; rastreio de origem | confirmado (FK bloco-03 + edge cols) |
| 4 | cliente_source | text | NO | — | edges (insert) — identifica a planilha/tabela de origem (ex.: `clientes_cobranca_setembro`) | event_log | confirmado (edge cols) |
| 5 | matricula | text | NO | — | edges (insert) | `motor_v2_cancel_future_disparos` (WHERE), `idx_disparos_log_matricula_scheduled` | confirmado (functions-analysis + edge) |
| 6 | telefone | text | NO | — | edges (insert) — telefone normalizado | sender externo (destino) | confirmado (edge cols) |
| 7 | nome | text | YES | — | edges (insert) | template Meta (params) | confirmado (edge cols) |
| 8 | trilho | text | NO | — | edges (insert) — trilha (cobrança vs relacionamento) | `idx_disparos_log_trilho_slot`; sortear filtra `trilho` | confirmado (edge cols + índice) |
| 9 | regua | text | YES | — | edge planejador (insert) ← `cadence_calendar.regua` / `gate_state.reguas_efetivas` | event_log | confirmado (edge cols) |
| 10 | dia_ciclo | integer | YES | — | edge planejador (insert) ← `cadence_calendar.dia_ciclo` | event_log | confirmado (edge cols) |
| 11 | slot_index | integer | NO | — | edges (insert) ← `cadence_calendar.slot_index` | `idx_disparos_log_trilho_slot`; sortear (slot 1 = contactados) | confirmado (edge cols) |
| 12 | action_type | text | NO | — | edges (insert) ← `cadence_calendar.action_type` | event_log | confirmado (edge cols) |
| 13 | intensity | text | YES | — | edges (insert) ← `cadence_calendar.intensity` | event_log | confirmado (edge cols) |
| 14 | template_name | text | YES | — | **sender externo / webhook Meta** (não capturado) — nome do template efetivamente enviado | event_log | inferido (comentário da tabela; sem writer nas fontes) |
| 15 | template_pool_tag | text | YES | — | edges (insert) ← `cadence_calendar.template_pool_tag` | sender (escolha de template) | confirmado (edge cols) |
| 16 | phone_number_id | text | NO | — | edge planejador (insert) — phone da Meta usado | sender; `health_color_no_envio` pareado | confirmado (edge cols) |
| 17 | health_color_no_envio | text | YES | — | edge planejador (insert) — snapshot da cor do gate no envio (← `gate_state.health_color_efetivo`) | event_log; auditoria de gate | confirmado (edge cols) |
| 18 | status | text | NO | `'PROGRAMADA'` | default na inserção; **transições (`ENVIADA`/`ENTREGUE`/`LIDA`/`FALHOU`/`PULADA`) por sender/webhook externo e `motor_v2_cancel_future_disparos` (→`PULADA`)** | `idx_disparos_log_status_scheduled` (parcial PROGRAMADA/ENVIADA, **único índice usado, 451 scans**); edges (replay/dedupe) | confirmado (default + functions-analysis) |
| 19 | status_detail | text | YES | — | `motor_v2_cancel_future_disparos` (escreve); sender/webhook (motivo) | event_log | confirmado p/ cancel (functions-analysis); inferido p/ webhook |
| 20 | scheduled_for | timestamptz | NO | — | edges (insert) — horário-alvo do slot | `idx_disparos_log_status_scheduled`, `_unit_scheduled`, `_matricula_scheduled`, `_trilho_slot`; plano do dia | confirmado (edge cols + índices) |
| 21 | sent_at | timestamptz | YES | — | **sender externo / webhook Meta** (não capturado) | event_log | inferido (comentário; sem writer nas fontes) |
| 22 | delivered_at | timestamptz | YES | — | **webhook Meta** (não capturado) | event_log | inferido (comentário; sem writer) |
| 23 | read_at | timestamptz | YES | — | **webhook Meta** (não capturado) | event_log | inferido (comentário; sem writer) |
| 24 | failed_at | timestamptz | YES | — | **webhook Meta** (não capturado) | event_log | inferido (sem writer) |
| 25 | failure_code | text | YES | — | **webhook Meta** (não capturado) | event_log; diagnóstico | inferido (sem writer) |
| 26 | failure_reason | text | YES | — | **webhook Meta** (não capturado) | event_log (audit-only) | inferido (sem writer) |
| 27 | wa_message_id | text | YES | — | **sender externo** (não capturado) | `idx_disparos_log_wa_id` (**ÚNICO parcial = chave de idempotência** do webhook; idx_scan=0 esperado nesta janela) | inferido (sem writer); índice confirma uso de idempotência |
| 28 | correlation_id | text | YES | — | edges (insert) — id de correlação do batch | event_log (audit-only) | confirmado (edge cols) |
| 29 | raw_response | jsonb | YES | — | **sender externo / webhook Meta** (não capturado) — payload bruto da resposta | event_log (audit-only) | inferido (sem writer) |
| 30 | created_at | timestamptz | NO | `now()` | default | event_log | confirmado (default) |
| 31 | updated_at | timestamptz | NO | `now()` | default na inserção; `motor_v2_cancel_future_disparos` (escreve); sender/webhook | event_log | confirmado (functions-analysis) |

> Origem por subtração: as listas de `insert` das duas edges são explícitas (edge-functions.json). Colunas que NÃO aparecem em nenhum writer capturado = **sender externo / webhook Meta** (`template_name, status_detail, sent_at, delivered_at, read_at, failed_at, failure_code, failure_reason, wa_message_id, raw_response` + as transições de `status`). `phone_number_id` e `health_color_no_envio` SÃO setadas pelo planejador no insert — não caem no balde do webhook.

## Relacionamentos (FKs)
- `disparos_log.unit_id` → `units.id` (`disparos_log_unit_id_fkey`, no action) — bloco-03.
- `disparos_log.cliente_cadencia_id` → `cliente_cadencia.id` (`disparos_log_cliente_cadencia_id_fkey`, no action) — bloco-03.

## Índices
| índice | unique | idx_scan | bytes | nota |
|--------|--------|----------|-------|------|
| `idx_disparos_log_status_scheduled` (parcial: status IN PROGRAMADA/ENVIADA) | não | **451** | 8 kB | **único usado** — alimenta o plano do dia / dedupe |
| `disparos_log_pkey` (id) | sim | 0 | 8 kB | PK; integridade |
| `idx_disparos_log_wa_id` (wa_message_id) parcial NOT NULL | sim | 0 | 8 kB | **chave de idempotência do webhook**; scan 0 esperado nesta janela |
| `idx_disparos_log_matricula_scheduled` | não | 0 | 8 kB | suporta `motor_v2_cancel_future_disparos` (matricula) |
| `idx_disparos_log_unit_scheduled` | não | 0 | 8 kB | suporta queries por unidade |
| `idx_disparos_log_trilho_slot` | não | 0 | 8 kB | suporta sortear (trilho/slot) |

### Índices nunca usados (idx_scan=0)
**CAVEAT FORTE:** os cinco `idx_scan=0` **NÃO são desperdício**. Evidência convergente de janela não-representativa: `n_tup_ins=0`, `tamanho_heap=0`, `last_analyze=null`, cron `runs=2`. A tabela praticamente não foi exercida no snapshot (~13h). O `idx_disparos_log_wa_id` é a chave de idempotência do webhook (scan 0 esperado). **Não recomendar drop.** Reavaliar após o motor rodar alguns dias.

## Triggers
- `trg_event_log_disparos_log` — AFTER INSERT/UPDATE/DELETE, FOR EACH ROW → `trg_log_event_changes()` (SECURITY DEFINER). Insere em `event_log` evento `DISPAROS_LOG_<OP>` com `before/after = to_jsonb(OLD/NEW)` (bloco-06 + def 05b). **Toda coluna é capturada na auditoria** — mas isso é leitura audit-only, não consumidor funcional.

## RLS / Policies
- RLS **ON**, `rls_forced=false`, **0 policies** (bloco-01/09). Sem policy + RLS on = leitura/escrita só por service_role e owner. Todos os escritores conhecidos (edges) usam service_role → ok. **Antipattern leve:** RLS ligada sem policy é frágil se algum dia um cliente anon/authenticated precisar ler — hoje ninguém precisa.

## Quem escreve / Quem lê
- **Escreve (insert/delete):** edge `motor-v2-planejador` (cron 08:50 BRT, `50 11 * * 1-5` UTC) e `motor-v2-sortear-relacionamento` (cron 11:45 BRT, `45 14` UTC) — edge-functions.json + bloco-11.
- **Escreve (update):** `motor_v2_cancel_future_disparos` (→ `PULADA` quando cliente bloqueado, functions-analysis). Sender externo + webhook Meta (timestamps/status) — **não capturado nas fontes**.
- **Lê:** edges (replay/dedupe/group); `motor_v2_cancel_future_disparos` (WHERE); trigger `event_log` (auditoria total).

## Observações
- **Falta no inventário um writer claro do webhook/sender** (`sent_at`…`raw_response`). É o maior gap de lineage desta tabela — provavelmente n8n ou função fora do snapshot. Marcado como `inferido` a partir do comentário da tabela.
- Não declarar nada "morto" aqui: janela não-representativa (`-1` linhas, heap 0, cron `runs=2`).
- Contradição doc↔banco: nenhuma — comentário da tabela bate com o comportamento observado (plano do dia + transição via webhook).
