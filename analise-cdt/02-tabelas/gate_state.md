# gate_state

## Identificação
- **Nome:** `public.gate_state`
- **Dono provável:** n8n / cobrança — **Motor v2** (estado do gate de saúde por unidade; ausente das migrations do CHAT-CDT).
- **Linhas estimadas:** **13** (real; ~1 por unidade/WABA). `n_live_tup=13`, `n_dead_tup=9`.
- **Tamanho:** 32 kB total, heap 8 kB.
- **Classificação:** **Cobrança** (estado / telemetria de saúde do gate).
- **Bloat:** leve — 9 dead tuples para 13 live (upserts frequentes). `last_autoanalyze` setado (2026-06-02). Autovacuum dá conta; sem alerta.
- **RLS:** ON, **0 policies** → só service_role/owner.
- **Tabela genuinamente ativa na janela:** `n_tup_upd=2016`, `idx_scan=2016` — ao contrário de disparos_log, aqui as estatísticas são representativas.

## Finalidade
Motor v2: **estado atual do gate de saúde por unidade** (comentário bloco-01). Guarda a cor de saúde calculada do número (`health_color_calc`), eventual override manual (`health_color_override`), a cor efetiva resultante (`health_color_efetivo` — a que o planejador realmente usa), as réguas liberadas para aquela cor (`reguas_efetivas`) e o multiplicador de relacionamento. Atualizado por `motor_v2_recalc_gate` (RPC) e, segundo o comentário, pelo `gate_consumer.py` externo.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | unit_id | uuid | NO | — | `motor_v2_recalc_gate` (upsert, ON CONFLICT unit_id) → FK `units.id` | edge planejador/sortear (select por unit), PK | confirmado (functions-analysis + edge) |
| 2 | health_color_calc | text | NO | — | `motor_v2_recalc_gate` (calcula de `phone_health`) | `health_color_efetivo` (deriva); event_log | confirmado (functions-analysis) |
| 3 | health_color_override | text | YES | — | `motor_v2_recalc_gate` (lê override de `system_state`) | `health_color_efetivo` (deriva); event_log | confirmado (functions-analysis: notes) |
| 4 | health_color_efetivo | text | NO | — | `motor_v2_recalc_gate` (resolve calc vs override) | **edge `motor-v2-planejador` (select)** e **`motor-v2-sortear-relacionamento` (select)** — a cor que o planejador usa | confirmado (edge cols) |
| 5 | reguas_efetivas | text[] | NO | — | `motor_v2_recalc_gate` (de `gate_config.reguas_ativas` + cap de `system_state`) | edge planejador (select); `motor_v2_get_disparos` (select) | confirmado (functions-analysis + edge) |
| 6 | relacionamento_ratio | numeric | NO | — | `motor_v2_recalc_gate` (de `gate_config`) | edge `motor-v2-sortear-relacionamento` (select — define N do sorteio) e planejador (select) | confirmado (edge cols) |
| 7 | worst_phone_id | text | YES | — | `motor_v2_recalc_gate` (pior phone do snapshot) | event_log (audit-only); diagnóstico | confirmado (functions-analysis) |
| 8 | worst_phone_color | text | YES | — | `motor_v2_recalc_gate` | event_log (audit-only) | confirmado (functions-analysis) |
| 9 | last_evaluated_at | timestamptz | NO | `now()` | `motor_v2_recalc_gate` (upsert) | event_log; observabilidade | confirmado (functions-analysis) |
| 10 | updated_at | timestamptz | NO | `now()` | `motor_v2_recalc_gate` (upsert) | event_log | confirmado (functions-analysis) |

## Relacionamentos (FKs)
- `gate_state.unit_id` → `units.id` (`gate_state_unit_id_fkey`, no action) — bloco-03.

## Índices
| índice | unique | idx_scan | bytes | nota |
|--------|--------|----------|-------|------|
| `gate_state_pkey` (unit_id) | sim | **2016** | 16 kB | quente — lookup/upsert por unidade |

### Índices nunca usados (idx_scan=0)
Nenhum. Único índice (PK) é o que serve tudo (upsert ON CONFLICT + selects das edges). **Desperdício = 0.**

## Triggers
- `trg_event_log_gate_state` — AFTER INSERT/UPDATE/DELETE FOR EACH ROW → `trg_log_event_changes()` → `event_log` evento `GATE_STATE_<OP>` com before/after JSONB completo (bloco-06 + def 05b). Captura toda coluna na auditoria (audit-only para `worst_phone_*`).

## RLS / Policies
RLS **ON**, `rls_forced=false`, **0 policies**. Só service_role/owner. As edges usam service_role → ok. Antipattern leve (RLS sem policy), mas hoje nenhum cliente não-privilegiado precisa ler.

## Quem escreve / Quem lê
- **Escreve:** `motor_v2_recalc_gate` (upsert de TODAS as 10 colunas; ON CONFLICT unit_id — functions-analysis, confiança confirmada). **Origem dupla declarada:** o comentário da tabela diz que o `gate_consumer.py` externo atualiza — provavelmente invoca a RPC `motor_v2_recalc_gate` (inferido; o writer SQL confirmado é a RPC).
- **Lê:** edge `motor-v2-planejador` (`unit_id,health_color_efetivo,reguas_efetivas,relacionamento_ratio`); edge `motor-v2-sortear-relacionamento` (`relacionamento_ratio,health_color_efetivo,unit_id`); função `motor_v2_get_disparos` (`reguas_efetivas,unit_id`); trigger event_log.

## Observações
- **Origem dupla** (`motor_v2_recalc_gate` confirmado + `gate_consumer.py` inferido): consistente, não contraditória — o consumer externo é o orquestrador que chama a RPC.
- `worst_phone_id`/`worst_phone_color` só têm consumidor de auditoria (event_log) — sem leitor funcional → contam como sem consumidor funcional.
- Estatísticas representativas (ao contrário de disparos_log): não há índice/coluna "morta" por artefato de janela.
