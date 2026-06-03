# chat_conversation_events

## Identificação
- **Nome**: `public.chat_conversation_events`
- **Dono provável**: CHAT-CDT (prefixo `chat_`; criada em `migrations/0011_conversation_lifecycle.sql`).
- **Linhas estimadas**: ~393 (`n_live_tup=393`; `linhas_estimadas=370`; `n_tup_ins=171` na janela). `last_autoanalyze=2026-06-01`.
- **Tamanho**: 248 kB total (heap 104 kB) — o restante é índice (3 índices secundários, todos zerados).
- **Classificação**: **CHAT-CDT** (log de auditoria do ciclo de vida de atendimento).
- **Bloat**: sem alerta. `n_dead_tup=0`. Tabela append-only pequena. Os 3 índices secundários (114 kB somados) é que estão desperdiçados — ver seção de índices.

## Finalidade
Log append-only (event-sourcing leve) das transições de roteamento/status de cada `conversation`: enfileiramento (handoff), atribuição/reatribuição a operador, retorno à IA e encerramento com desfecho. Alimentado exclusivamente pelo trigger `chat_log_conversation_transition` disparado em `UPDATE` na tabela `conversations`. A documentação (`docs`, MEMORY `project_attendance_lifecycle`) descreve essa tabela como "log de eventos (0011)".

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default do banco no INSERT do trigger | PK; nenhum leitor de aplicação identificado | confirmado (origem) |
| 2 | conversation_id | uuid | NO | — | trigger `chat_log_conversation_transition` (`new.id`) | FK→`conversations.id`; policy `chat_conv_events_select` usa para RLS | confirmado (`functions-analysis` write columns; def da função) |
| 3 | event_type | USER-DEFINED `chat_conv_event_type` | NO | — | trigger: literais `'queued'`,`'returned_to_ai'`,`'assigned'`/`'reassigned'`,`'closed'` | sem consumidor identificado | confirmado (def do trigger) |
| 4 | actor_id | uuid | YES | — | trigger: `auth.uid()` ou `coalesce(new.closed_by, auth.uid())` | FK→`auth.users.id`; índice `chat_conv_events_actor_idx` (NUNCA USADO) | confirmado (def do trigger) |
| 5 | from_routing | USER-DEFINED `chat_routing_state` | YES | — | trigger: `old.routing` | sem consumidor identificado | confirmado (def do trigger) |
| 6 | to_routing | USER-DEFINED `chat_routing_state` | YES | — | trigger: `new.routing` | sem consumidor identificado | confirmado (def do trigger) |
| 7 | from_status | USER-DEFINED `chat_conversation_status` | YES | — | trigger: `old.status` (só no evento `closed`) | sem consumidor identificado | confirmado (def do trigger) |
| 8 | to_status | USER-DEFINED `chat_conversation_status` | YES | — | trigger: `new.status` (só no evento `closed`) | sem consumidor identificado | confirmado (def do trigger) |
| 9 | outcome | USER-DEFINED `chat_close_outcome` | YES | — | trigger: `new.close_outcome` (só `closed`) | sem consumidor identificado | confirmado (def do trigger) |
| 10 | note | text | YES | — | trigger: `new.close_note` (só `closed`) | sem consumidor identificado | confirmado (def do trigger) |
| 11 | created_at | timestamptz | NO | `now()` | default do banco | índices `_conv_idx`/`_created_idx` (ambos NUNCA USADOS) | confirmado (origem) |

`pos` 1..11 contínuos — **nenhuma coluna droppada**. **Nenhuma coluna com espaço no nome.**

## Relacionamentos (FKs)
- `conversation_id` → `conversations.id` (`ON DELETE CASCADE`). Apaga eventos junto da conversa.
- `actor_id` → `users.id` (`auth.users`) (`ON DELETE NO ACTION`).

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| `chat_conversation_events_pkey` | `(id)` | 3 | 40 kB |
| `chat_conv_events_conv_idx` | `(conversation_id, created_at DESC)` | **0** | 40 kB |
| `chat_conv_events_created_idx` | `(created_at DESC)` | **0** | 16 kB |
| `chat_conv_events_actor_idx` | `(actor_id)` | **0** | 16 kB |

### Índices nunca usados (idx_scan=0)
`chat_conv_events_conv_idx` + `chat_conv_events_created_idx` + `chat_conv_events_actor_idx` = **~72 kB desperdiçados**. Foram criados em 0011 prevendo leitura por timeline (por conversa, por data, por operador), mas **nenhum leitor existe ainda** — coerente com a tabela ser write-only no estado atual. Manter se a UI de timeline for entregar em breve; caso contrário, candidatos a drop.

## Triggers
Nenhum trigger **nesta** tabela (bloco-06 vazio). O writer é o trigger `chat_log_conversation_transition` (`AFTER UPDATE`) **na tabela `conversations`**, não aqui.

## RLS / Policies
- RLS **ON** (não forçada). 1 policy, **sem duplicação/sobreposição**.
- `chat_conv_events_select` (SELECT, public): `EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND chat_user_has_unit(c.unit_id))`. Operador só lê eventos de conversas da própria unidade (cadeia RLS padrão via `chat_user_has_unit`).
- **Não há policy de INSERT** — escrita ocorre só pelo trigger `SECURITY DEFINER`, que contorna RLS. Correto por design.

## Quem escreve / Quem lê
- **Escreve**: única origem é o trigger `chat_log_conversation_transition` (`functions-analysis.json`: write insert, `confidence:confirmado`; def em 0011 e em `bloco-05b`). 4 ramos de INSERT (queued, returned_to_ai, assigned/reassigned, closed).
- **Lê**: **nenhum consumidor identificado** em app (`app/`,`lib/`,`components/` — só a migration 0011 cita o nome), edge-functions, n8n, views (`views-analysis`), nem em `pg_stat_statements` (10a/10b = 0 hits). A policy SELECT existe para uma futura tela de timeline ainda não construída.

## Observações
- **Tabela de auditoria write-only no estado atual**: todas as 11 colunas têm origem confirmada mas **nenhuma tem leitor identificado**. Não é "morta" — é provisão para timeline de atendimento (UI pendente). Classificar como `sem consumidor identificado`, não morta.
- **3 índices secundários NUNCA USADOS (~72 kB)**: provisionados para a leitura futura; só fazem sentido quando a timeline existir.
- Sem antipatterns de schema. Tipos enum corretos (`chat_conv_event_type` = {queued, assigned, reassigned, returned_to_ai, closed}).
