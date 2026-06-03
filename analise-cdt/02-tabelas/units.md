# units

## Identificação
- **Nome:** `public.units`
- **Dono provável:** Compartilhada (criada pelo app de cobrança/n8n; reutilizada pelo CHAT-CDT como **tenant**). Não é criada por nenhuma migration do CHAT-CDT (grep em `infra/supabase/migrations/` não encontra `create table units`).
- **Linhas estimadas:** `linhas_estimadas = -1` e `n_live_tup = 0` (bloco-01) → **tabela nunca foi ANALYZE-ada** (`last_analyze = null`, `last_autoanalyze = null`). O número real é **≈ 8** unidades — *inferido* de `bloco-10a` (`select u.code ... from units u join adimplentes_base a ... group by u.code` retorna **8 rows**) e das views de comissão que listam 6 unidades de exceção. Confiança: inferido.
- **Tamanho:** 64 kB total / 8192 bytes heap (bloco-01).
- **Classificação:** **Compartilhada** (catálogo central de tenants; lido por cobrança, motor v2, edge functions e CHAT-CDT).
- **Bloat:** sem bloat (tabela minúscula). Alerta secundário: **nunca foi analisada**, então o planner não tem estatística — em joins grandes (adimplentes_base, message_log) isso pode degradar planos. `seq_scan = 6501` com `idx_scan = 289616` (bloco-01): a maioria dos acessos usa índice (PK), mas há 6,5k seq scans (tabela tão pequena que o planner às vezes prefere varrer).

## Finalidade
`units` é a tabela-tenant de toda a plataforma CDT. Cada unidade (filial/franquia) tem `id`, `name` (rótulo humano), `code` (slug usado em URLs/RPCs como `ibirite`, `pousoalegre001`), além de metadados operacionais: `bi_name` (nome no Power BI), `rabbitmq_queue` (fila de disparo do motor) e `whatsapp_phone`. Praticamente toda tabela transacional do banco referencia `units.id` via `unit_id` (28 FKs apontam para cá — ver bloco-03). No CHAT-CDT é o tenant do handoff (CLAUDE.md: "Tenant = `public.units`").

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NÃO | `gen_random_uuid()` | default do banco na inserção da unidade (cadastro manual/seed; nenhuma migration CHAT-CDT cria units) | Chave de tenant lida por ~tudo: `chat_my_units`, `chat_user_has_unit`, `get_all_units`, `route_inbound`, todos os `rpc_*` de relatório, edge functions de pagamento, motor v2, view `available_units`, e 28 FKs `*.unit_id` (bloco-03, functions-analysis, edge-functions, views-analysis) | confirmado |
| 2 | `name` | text | NÃO | — | app/seed de cadastro de unidade | Rótulo humano em seletores: `get_all_units`, `chat_my_units`, `get_unit_details`, `get_user_accessible_units`, view `available_units`, `chat_report_overview`, `ganhos_mes_atual`; motor v2 lê `units.name` p/ logs (edge-functions). Índice único `units_name_key` (idx_scan 794) | confirmado |
| 3 | `code` | text | NÃO | — | app/seed | Slug de roteamento: `get_pay_checkout`, `get_pay_receipt`, `get_unit_details`, `get_user_accessible_units`, `user_can_read_unit_code`, `has_unit_permission`, `can_access_unit`, `grant_unit_permission`, `revoke_unit_permission`, edge `create-admin-users`/`process-reembolso`/`process-payouts`/`generate-payment-link*` (functions-analysis, edge-functions). Único `units_code_key` (idx_scan 779) | confirmado |
| 4 | `created_at` | timestamptz | NÃO | `now()` | default na inserção | `get_all_units`, `available_units` (projeção); telemetria | inferido (lida por get_all_units/available_units, mas sem uso analítico claro) |
| 5 | `updated_at` | timestamptz | NÃO | `now()` | trigger `update_units_updated_at` (BEFORE UPDATE → `update_updated_at_column`) | `get_all_units`, `available_units` (projeção) | confirmado (origem = trigger, bloco-06) |
| 6 | `bi_name` | text | SIM | — | app/sync (importação Power BI) | n8n **Sync Planilha Power BI v3** lê `units.bi_name` no nó "Detectar e Normalizar" (n8n-workflows, confirmado); `rpc_inbound_summary`, views `v_message_perf_24h`, `v_phone_health_current`, `v_waba_*` usam `bi_name` p/ rótulo (functions-analysis, views-analysis) | confirmado |
| 7 | `rabbitmq_queue` | text | SIM | — | app/config da unidade | `route_inbound` lê `units.rabbitmq_queue` p/ devolver a fila de disparo (functions-analysis, confirmado); query ad-hoc em bloco-10a (`select u.rabbitmq_queue ... from units u join adimplentes_base`) | confirmado |
| 8 | `whatsapp_phone` | text | SIM | — | app/config da unidade | `get_pay_checkout` lê `units.whatsapp_phone` p/ a página de pagamento (functions-analysis, confirmado); docs/03-database lista a coluna | confirmado |

## Relacionamentos (FKs)
- **Saída:** nenhuma (units é raiz).
- **Entrada (28 FKs `*.unit_id → units.id`, bloco-03):** `adimplentes_base`, `adimplentes_import_log`, `cliente_cadencia`, `clientes_cobranca_dashboard`, `clientes_cobranca_setembro`, `cobranca_clientes_removidos`, `contacts` (ON DELETE CASCADE), `conversations` (CASCADE), `disparadores_whatsapp`, `disparos_log`, `fila_humana`, `gate_state`, `links_pagamentos_gerados`, `message_log`, `pagamentos`, `payment_gateway_configs`, `payouts`, `phone_health`, `sync_snapshots`, `user_unit_permissions` (CASCADE), `user_units` (CASCADE), `waba_health`, `wabas` (CASCADE) e outras. A maioria é `ON DELETE a` (no action) — apagar uma unit é bloqueado por dados de cobrança; só as tabelas de auth/chat (`contacts`, `conversations`, `user_units`, `user_unit_permissions`, `wabas`) cascateiam.

## Índices
| índice | único | idx_scan | bytes | nota |
|--------|-------|----------|-------|------|
| `units_pkey` (id) | sim/PK | 288043 | 16 kB | quente — chave de tenant |
| `units_code_key` (code) | sim | 779 | 16 kB | usado por lookups por slug |
| `units_name_key` (name) | sim | 794 | 16 kB | usado por seletores ordenados por nome |

### Índices nunca usados (idx_scan=0)
Nenhum. Todos os 3 índices têm uso. **Desperdício: 0 MB.**

## Triggers
- `update_units_updated_at` — BEFORE UPDATE, FOR EACH ROW → `update_updated_at_column()` (bloco-06). Mantém `updated_at`.

## RLS / Policies
RLS **ON** (não forçada). 2 policies (bloco-09):
- **`Authenticated users can view units`** — SELECT, role `authenticated`, `qual = true`. Qualquer usuário logado lê todas as unidades. (Catálogo público de tenants.)
- **`Only admins can modify units`** — ALL, `qual = has_role((SELECT auth.uid()), 'admin')`. Só admin escreve.

Observação: a policy de SELECT é `true` (sem filtro por unidade do operador) — o escopo por unidade é aplicado nas tabelas-filhas e nos RPCs (`chat_my_units`, `user_unit_permissions`), não em `units`.

## Quem escreve / Quem lê
- **Escreve:** cadastro manual/seed de unidade e config (não há writer no código CHAT-CDT; `units` é mantida fora deste repo). Trigger preenche `updated_at`. `created_at`/`id` por default.
- **Lê (alto volume):** praticamente todo o sistema. Núcleo: `chat_my_units` (inbox — 48 chamadas no snapshot, bloco-10b), `chat_user_has_unit`/`can_access_unit` (RLS), `route_inbound` (roteamento n8n), todos `rpc_*` de relatório, edge functions de pagamento, motor v2 (4 edge functions), views de comissão/saúde, n8n Sync Power BI (`bi_name`). PK `units_pkey` com 288k scans (bloco-04).

## Observações
- **Nunca analisada** (`last_analyze`/`last_autoanalyze` null; `n_live_tup 0`; `linhas_estimadas -1`). Sem estatística de planner. Em tabela de 8 linhas o impacto direto é baixo, mas joins grandes contra `units` (ex.: `message_log`, `adimplentes_base`) ficam sem estimativa de cardinalidade. Recomendação: `ANALYZE public.units` (barato).
- **6501 seq_scans** (bloco-01): esperado para tabela minúscula que o planner às vezes varre inteira; não é problema.
- **`whatsapp_phone` vs `wabas`/`disparadores_whatsapp`:** o telefone "oficial" da unidade vive em `units.whatsapp_phone` mas os números operacionais de disparo vivem em `disparadores_whatsapp` e `wabas`. Não confundir — `whatsapp_phone` aqui é só rótulo da página de pagamento (`get_pay_checkout`).
- Contradição doc↔banco: nenhuma relevante. docs/03-database descreve `units (id, code, name, whatsapp_phone)` corretamente, omitindo `bi_name`/`rabbitmq_queue` (campos de cobrança que o CHAT-CDT não usa diretamente).
