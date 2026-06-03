# waba_violations

## Identificação
- **Nome**: `public.waba_violations`
- **Dono provável**: n8n / cobrança ("Strategic Swarm Health"). Sem DDL nas migrations do CHAT-CDT; `docs/03-database.md:24` lista como "telemetria que o n8n popula".
- **Classificação**: **Cobrança**
- **Linhas estimadas**: `linhas_estimadas`=-1, `n_live_tup`=1, `n_tup_ins`=1 (bloco-01) → **praticamente vazia** (1 evento registrado). `last_analyze`/`vacuum`/etc TODOS `null`.
- **Tamanho**: 80 KB total (8 KB heap, ~72 KB índices). Quase só estrutura.
- **Bloat**: N/A (1 linha).

## Finalidade
Feed cronológico de incidentes/violações de política das contas WABA: tipo de violação, restrição, expiração da restrição, estado de banimento e número afetado. 1 linha por evento, vindo do webhook `account_update` da Meta; `raw_value` guarda o payload completo (COMMENT da tabela). Alimenta `v_waba_violations_recent` (lista sem deduplicação, mais recente primeiro) para alerta/acompanhamento de restrições e banimentos.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | — (NOT NULL sem default explícito) | provável GENERATED IDENTITY (extração não traz `is_identity`) | PK; `v_waba_violations_recent` (projeta id) | inferido (origem) |
| 2 | waba_id | text | NO | — | RPC `record_meta_account_event` (webhook), col escrita literalmente | `v_waba_violations_recent`, índice | confirmado (writer) |
| 3 | unit_id | uuid | YES | — | RPC writer (resolvido via `disparadores_whatsapp`) | `v_waba_violations_recent`, policy RLS, trigger `NEW.unit_id`, índice | confirmado (writer) — **sem FK** |
| 4 | event | text | YES | — | RPC `record_meta_account_event` | `v_waba_violations_recent` | confirmado (writer) |
| 5 | violation_type | text | YES | — | RPC `record_meta_account_event` | `v_waba_violations_recent` | confirmado (writer) |
| 6 | restriction_type | text | YES | — | RPC `record_meta_account_event` | `v_waba_violations_recent` | confirmado (writer) |
| 7 | restriction_expires_at | timestamptz | YES | — | RPC `record_meta_account_event` | `v_waba_violations_recent` | confirmado (writer) |
| 8 | ban_state | text | YES | — | RPC `record_meta_account_event` | `v_waba_violations_recent` | confirmado (writer) |
| 9 | affected_phone_number | text | YES | — | RPC `record_meta_account_event` | `v_waba_violations_recent` | confirmado (writer) |
| 10 | raw_value | jsonb | NO | — | RPC `record_meta_account_event` (payload completo do account_update) | sem consumidor identificado (view não seleciona) | confirmado (writer) / sem consumidor |
| 11 | webhook_event_id | bigint | YES | — | RPC `record_meta_account_event` (id do log do webhook) | sem consumidor identificado | confirmado (writer) / sem consumidor |
| 12 | observed_at | timestamptz | NO | `now()` | default `now()` no INSERT | `v_waba_violations_recent` (ORDER BY observed_at DESC), índices | confirmado |

Sem colunas com espaço no nome. Sem gaps de ordinal (1→12 contíguo).

## Relacionamentos (FKs)
- **Nenhuma FK** (bloco-03 não retornou nada).
- **Assimetria**: `unit_id` é o mesmo conceito de `phone_health`/`waba_health` (que têm FK→`units`), mas aqui **sem FK** — igual à `waba_capability`. `webhook_event_id` provavelmente → `webhook_events_log.id` (**inferido**, sem FK).

## Índices
| índice | def | idx_scan | bytes | nota |
|--------|-----|----------|-------|------|
| `idx_waba_violations_observed` | (observed_at) | **516** | 16 KB | usado (a view ordena por observed_at DESC) |
| `idx_waba_violations_unit` | (unit_id, observed_at DESC) | 44 | 16 KB | usado (filtro por unidade) |
| `idx_waba_violations_waba` | (waba_id, observed_at DESC) | 0 | 16 KB | **NUNCA USADO** |
| `waba_violations_pkey` | UNIQUE (id) | 0 | 16 KB | PK (estrutural) |

`seq_scan`=0 na tabela: tudo via índice (tabela minúscula, mas o planner usa `idx_waba_violations_observed`).

### Índices nunca usados (idx_scan=0)
- `idx_waba_violations_waba` (16 KB) — único secundário ocioso. **Desperdício removível ~16 KB** (trivial). `waba_violations_pkey` (16 KB) é estrutural — excluído da conta.

## Triggers
- `trg_motor_v2_gate_from_waba_violations` — AFTER INSERT, ROW, função `trg_motor_v2_recalc_gate_from_health` (bloco-06). Lê `NEW.unit_id` e chama `motor_v2_recalc_gate()`. **Efeito cross-table**: registrar uma violação dispara recálculo do gate que lê `phone_health` (não colunas desta tabela). Só grava `event_log` no EXCEPTION. Faz sentido: uma violação deve reavaliar a saúde de envio da unidade.

## RLS / Policies
- `rls_on`=true, `rls_forced`=false.
- 1 policy: `health_select_waba_violations` — SELECT, `authenticated`, `qual = user_can_read_unit(unit_id)` (helper da cobrança). Sem policies de escrita → INSERT via RPC SECURITY DEFINER.

## Quem escreve / Quem lê
- **Escreve**: `record_meta_account_event` (RPC SECURITY DEFINER), ao processar `account_update` — INSERT em (waba_id, unit_id, event, violation_type, restriction_type, restriction_expires_at, ban_state, affected_phone_number, raw_value, webhook_event_id). functions-analysis "confirmado"; dentro de bloco `BEGIN...EXCEPTION` protegido. Só 1 INSERT no histórico observado.
- **Upstream**: webhook da Meta `account_update` via n8n/edge — **inferido** (grep edge/n8n vazio; apoiado por docs + COMMENT da tabela que cita explicitamente "webhook account_update").
- **Lê**: `v_waba_violations_recent` via PostgREST — bloco-10a/b: 516 chamadas, mean **5,93ms** (rápido; tabela minúscula + índice `observed_at`). Policy RLS.

## Observações
- Tabela **append-only de incidentes**, hoje quase vazia (1 evento) — esperado: violações são eventos raros. NÃO é morta; tem writer e consumidor ativos (516 leituras no snapshot).
- 2 colunas **sem consumidor identificado**: `raw_value`, `webhook_event_id` (gravadas, não projetadas pela view; `raw_value` é deliberadamente o payload bruto p/ auditoria, conforme COMMENT).
- `id` sem default explícito mas NOT NULL → IDENTITY provável; **inferido**, não "desconhecida".
- Sem FK em `unit_id` (assimetria com `phone_health`/`waba_health`) — mesma característica da `waba_capability`. As duas tabelas alimentadas pelo webhook (`account_update`/`business_capability_update`) não têm FK; as duas de polling (`phone_health`/`waba_health`) têm. Padrão consistente por caminho de escrita.
- A view NÃO deduplica (sem DISTINCT ON) — é log cronológico puro, ao contrário das `v_*_current` das irmãs.
