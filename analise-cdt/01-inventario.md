# 01 — Inventário completo do banco (project ref `ubwcxktaruxqacxltovq`)

> Escopo: schema `public`. Inventário enumerativo (lista, não análise em profundidade). Cada seção cita a fonte bruta em `analise-cdt/raw/`. Snapshot dos blocos: `2026-06-02`. Janela de `pg_stat` para colunas de uso: ~13h14 (reset `2026-06-01 14:11` UTC → snapshot `2026-06-02 03:25` UTC, `bloco-10c-stat-janela.json`) — números de `idx_scan` refletem essa janela, não o histórico total.
>
> **Vocabulário de classificação** (consistente com `02-tabelas/*`): **Cobrança** (domínio n8n / Motor v2 de cobrança e relacionamento — inclui tabelas que o CLAUDE.md chama de "do n8n"), **CHAT-CDT** (criadas/escritas pelo CHAT-CDT), **Compartilhada** (escrita ou lida por ambos os lados, fronteira), **Morta/Backup** (backup datado, teste ou vestigial).
>
> `n/a¹` = `linhas_estimadas` veio negativo no `pg_class.reltuples` (`-1`), sinal de tabela **nunca analisada/vacuumada** — contagem real desconhecida (ver o `.md` da tabela para `n_live_tup`).

---

## 1. Tabelas (59) — `bloco-01-tabelas.json` + `02-tabelas/*`

Ordenadas por tamanho total decrescente. RLS = estado de `rls_on`.

**Resumo de classificação:** Cobrança **37** · Compartilhada **12** · CHAT-CDT **6** · Morta/Backup **4**.
**RLS OFF em 13 tabelas** (todas Cobrança/Backup): `cobranca_sync_backup`, `data_freshness_log`, `cadence_calendar`, `agents_bak_*` (2), `cobranca_clientes_removidos`, `template_master`, `sync_snapshots`, `cadence_slot_config`, `gate_config`, `log_limpeza_links`, `adimplentes_import_log`, `system_state`.

| tabela | linhas (est.) | tamanho | RLS | classificação |
|--------|--------------:|---------|-----|---------------|
| `clientes_cobranca_dashboard` | 95.685 | 1793 MB | on | Cobrança |
| `message_log` | 259.699 | 291 MB | on | Cobrança |
| `adimplentes_base` | 157.213 | 234 MB | on | Cobrança |
| `webhook_events_log` | 20.111 | 53 MB | on | Compartilhada² |
| `event_log` | 41.208 | 49 MB | on | Cobrança |
| `clientes_cobranca_setembro` | 49.633 | 43 MB | on | Cobrança |
| `waba_health` | 20.467 | 35 MB | on | Cobrança |
| `links_pagamentos_gerados` | 42.508 | 32 MB | on | Cobrança |
| `message_inbound` | 26.235 | 26 MB | on | Compartilhada |
| `cobranca_sync_backup` | 9.203 | 24 MB | **OFF** | Cobrança |
| `phone_health` | 20.209 | 20 MB | on | Cobrança |
| `pagamentos` | 22.662 | 20 MB | on | Cobrança |
| `chat_webhook_events` | 16.849 | 19 MB | on | CHAT-CDT |
| `messages` | 22.203 | 16 MB | on | Compartilhada |
| `template_inventory` | 4.110 | 12 MB | on | Compartilhada |
| `cliente_cadencia` | 22.771 | 9040 kB | on | Cobrança |
| `blacklist_global` | 3.546 | 1776 kB | on | Cobrança |
| `conversations` | 4.157 | 1744 kB | on | Compartilhada |
| `contacts` | 4.188 | 1224 kB | on | Compartilhada |
| `data_freshness_log` | 2.775 | 880 kB | **OFF** | Cobrança |
| `spreadsheet_sync_log` | 176 | 536 kB | on | Cobrança |
| `agents` | 13 | 504 kB | on | Cobrança |
| `pagamentos_orfaos` | 97 | 456 kB | on | Cobrança |
| `fila_humana` | 324 | 296 kB | on | Cobrança |
| `chat_conversation_events` | 370 | 248 kB | on | CHAT-CDT |
| `cadence_calendar` | 262 | 192 kB | **OFF** | Cobrança |
| `agents_bak_20260601_precancel` | n/a¹ | 144 kB | **OFF** | Morta/Backup |
| `disparadores_whatsapp` | 21 | 144 kB | on | Cobrança |
| `agents_bak_20260601_prerename` | n/a¹ | 128 kB | **OFF** | Morta/Backup |
| `user_unit_permissions` | 61 | 104 kB | on | Compartilhada |
| `cobranca_clientes_removidos` | 69 | 104 kB | **OFF** | Cobrança |
| `template_master` | n/a¹ | 104 kB | **OFF** | Cobrança |
| `waba_violations` | n/a¹ | 80 kB | on | Cobrança |
| `faturamento_baixas` | n/a¹ | 80 kB | on | Cobrança |
| `sync_snapshots` | n/a¹ | 64 kB | **OFF** | Cobrança |
| `units` | n/a¹ | 64 kB | on | Compartilhada |
| `sales_leads` | n/a¹ | 64 kB | on | Morta/Backup |
| `cadence_slot_config` | 17 | 64 kB | **OFF** | Cobrança |
| `user_units` | 53 | 56 kB | on | Compartilhada |
| `waba_capability` | n/a¹ | 56 kB | on | Cobrança |
| `disparos_log` | n/a¹ | 56 kB | on | Cobrança |
| `chat_push_subscriptions` | n/a¹ | 48 kB | on | CHAT-CDT |
| `template_status_log` | n/a¹ | 48 kB | on | Compartilhada |
| `payment_gateway_configs` | n/a¹ | 48 kB | on | Cobrança |
| `profiles` | n/a¹ | 48 kB | on | Compartilhada |
| `wabas` | n/a¹ | 48 kB | on | CHAT-CDT |
| `chat_phone_numbers` | n/a¹ | 48 kB | on | CHAT-CDT |
| `payouts` | n/a¹ | 48 kB | on | Cobrança |
| `user_roles` | 7 | 40 kB | on | Compartilhada |
| `gate_config` | n/a¹ | 32 kB | **OFF** | Cobrança |
| `log_limpeza_links` | n/a¹ | 32 kB | **OFF** | Cobrança |
| `gate_state` | 13 | 32 kB | on | Cobrança |
| `webhook_configs` | n/a¹ | 32 kB | on | Cobrança³ |
| `adimplentes_import_log` | n/a¹ | 32 kB | **OFF** | Cobrança |
| `app_internal_config` | n/a¹ | 32 kB | on | Cobrança |
| `system_state` | n/a¹ | 32 kB | **OFF** | Cobrança |
| `chat_config` | n/a¹ | 32 kB | on | CHAT-CDT |
| `payout_pagamentos` | n/a¹ | 24 kB | on | Cobrança |
| `todos` | n/a¹ | 8192 bytes | on | Morta/Backup |

> ² `webhook_events_log` — classificada **Compartilhada** (rótulo primário): audit transversal que cobre webhooks de pagamento (Cobrança) **e** eventos Meta/WhatsApp; o `.md` registra a natureza dupla "Cobrança / Compartilhada".
> ³ `webhook_configs` — candidata a **Morta/vestigial** (estrutura de config planejada, sem writer claro); mantida em Cobrança por domínio.

---

## 2. Views (11) — `bloco-07-views.json` + `views-analysis.json`

Todas são views simples (não materializadas). Predominam dashboards de cobrança e o "current state" do Strategic Swarm (saúde de WABA/phone/template).

| view | tabelas-fonte | finalidade (resumo) |
|------|---------------|---------------------|
| `available_units` | `units` | Catálogo público de unidades; fonte de seletores/filtros. |
| `cobranca_diaria_mes_atual` | `pagamentos`, `units` | Série diária de arrecadação do mês corrente (centavos→reais) p/ dashboard. |
| `estornos_mes_atual` | `pagamentos` | Reembolsos agregados do mês corrente p/ dashboard. |
| `ganhos_mes_atual` | `pagamentos`, `units` | Ranking de arrecadação/comissão por unidade no mês. |
| `v_message_perf_24h` | `message_log`, `units` | Saúde de envio WhatsApp por unidade na janela 24h. |
| `v_phone_health_current` | `phone_health`, `units` | Estado corrente (DISTINCT ON) de cada phone number. |
| `v_template_current` | `template_status_log`, `template_inventory` | Status corrente de cada template + qualidade/categoria. |
| `v_template_health` | `template_inventory` | Contagem de templates por status/unidade (inclui pausados pela Sentinela). |
| `v_waba_capability_current` | `waba_capability`, `units` | Limites de capacidade correntes por WABA/unidade. |
| `v_waba_health_current` | `waba_health`, `units` | Estado corrente (review/verificação) de cada WABA. |
| `v_waba_violations_recent` | `waba_violations`, `units` | Feed cronológico de violações de política das WABAs. |

---

## 3. Funções (115) — `bloco-05a-funcoes-meta.json` + `functions-analysis.json`

**SECURITY DEFINER:** 96 de 115 funções (`SD`). Destas, **11 estão sem `search_path` configurado** — vetor de risco de hijacking de `search_path` em função `SECURITY DEFINER`. Cross-check confirmado contra o campo `config`/`proconfig` autoritativo do banco (`bloco-05a`): 96 SD, 85 com `search_path` no `config`, 11 sem — bate com `functions-analysis.json`.

**As 11 SECURITY DEFINER sem `search_path` (corrigir):**
`add_to_blacklist`, `can_access_unit`, `get_all_units`, `get_unit_details`, `get_user_accessible_units`, `record_inbound_message`, `record_message_status`, `record_meta_account_event`, `sentinel_apply_meta_event`, `sentinel_register_variation`, `user_has_access_to_unit`.
*(Há ainda 13 funções `SECURITY INVOKER` sem search_path — não-SD, risco menor; total 24 funções sem search_path.)*

Agrupadas por domínio (`SD` = SECURITY DEFINER; `‡` = SD **sem** search_path):

### 3.1 Auth / RLS / permissões / unidades (23)
`assign_admin_role_by_email`ᴿ, `can_access_unit`‡, `chat_admin_list_users`ᴿ, `chat_is_admin`ᴿ, `chat_my_units`ᴿ, `chat_operator_names`ᴿ, `chat_user_has_unit`ᴿ, `create_admin_user`ᴿ, `create_emergency_admin`ᴿ, `ensure_admin_permissions`ᴿ, `get_all_units`‡, `get_unit_details`‡, `get_user_accessible_units`‡, `get_users_with_emails`ᴿ, `grant_multiple_permissions`ᴿ, `grant_unit_permission`ᴿ, `handle_new_user`ᴿ, `has_role`ᴿ, `has_unit_permission`ᴿ, `revoke_unit_permission`ᴿ, `user_can_read_unit`ᴿ, `user_can_read_unit_code`ᴿ, `user_has_access_to_unit`‡. (`ᴿ` = SD)

### 3.2 Cobrança / Motor v2 — cadência, sync, gate (24)
`advance_cadence_state`ᴿ, `batch_update_disparo_outcomes`ᴿ, `cron_clear_expired_pause`ᴿ, `cron_unblock_expired`ᴿ, `get_pausas_vencidas`ᴿ, `motor_v2_adimplentes_finalize`, `motor_v2_adimplentes_upsert`, `motor_v2_avancar_dia`ᴿ, `motor_v2_build_components`, `motor_v2_cancel_future_disparos`ᴿ, `motor_v2_finalizar_dia22`ᴿ, `motor_v2_get_disparos`, `motor_v2_inicio_semana_sp`, `motor_v2_invoke_edge`ᴿ, `motor_v2_pick_template` *(overload ×2: com e sem `p_nonce`)*, `motor_v2_recalc_gate`ᴿ, `motor_v2_relacionamento_get_disparos`ᴿ, `motor_v2_relacionamento_stats`ᴿ, `picker_select_batch`ᴿ, `rollback_sync`ᴿ, `sync_cobranca_batch`ᴿ, `sync_cobranca_v2`ᴿ, `isa_registrar_opt_out`ᴿ.

### 3.3 Pagamentos / links / reconciliação / payouts (20)
`auto_reconcile_orfaos`ᴿ, `buscar_links_resgate`ᴿ, `buscar_links_resgate_pendente`ᴿ, `call_reconcile_function`ᴿ, `cleanup_expired_links`ᴿ, `descartar_orfao`ᴿ, `get_open_payment_links`ᴿ, `get_pay_checkout`ᴿ, `get_pay_receipt`ᴿ, `limpar_links_pagamento_expirados`, `link_payout_charges`ᴿ, `mark_refund_by_correlation`ᴿ, `reconcile_orfao`ᴿ, `register_payment`ᴿ, `resolve_orfao_matricula`ᴿ, `upsert_payment_link`ᴿ, `cancel_pending_links_on_payment`ᴿ, `guard_recent_payment_dashboard`ᴿ, `guard_recent_payment_setembro`ᴿ, `notify_orphan_payment_created`ᴿ.

### 3.4 Relatórios / agregações de cobrança e pagamento (11)
`get_cobranca_aggregates`ᴿ, `get_cobranca_by_regua`, `get_cobranca_kpis`, `get_cobranca_metrics`ᴿ, `get_daily_payment_counts`ᴿ, `get_daily_payments`, `get_daily_payments_multi`, `get_pagamentos`ᴿ, `get_regua_totals`ᴿ, `get_phone_pending_debts`ⁱ *(ⁱ = invoker, sem search_path)*, `rpc_message_cost`ᴿ.

### 3.5 Mensageria / inbound / roteamento (7)
`record_inbound_message`‡, `record_message_status`‡, `route_inbound`ᴿ, `rpc_inbound_summary`ᴿ, `rpc_dispatches_hourly`ᴿ, `rpc_failure_codes`ᴿ, `sync_data_ultimo_disparo_from_message_log`ᴿ.

### 3.6 WhatsApp health / Sentinela / templates Meta (8)
`record_meta_account_event`‡, `record_phone_health_snapshot`ᴿ, `record_waba_health_snapshot`ᴿ, `rpc_phone_health_last_change`ᴿ, `sentinel_apply_meta_event`‡, `sentinel_register_variation`‡, `trg_motor_v2_recalc_gate_from_health`ᴿ, `mirror_disparo_fields_to_dashboard`ᴿ.

### 3.7 Blacklist / opt-out / bloqueio (4)
`add_to_blacklist`‡, `agent_block_customer`ᴿ, `agent_pause_customer`ᴿ, `is_blacklisted`ⁱ.

### 3.8 CHAT-CDT — atendimento humano / push / contexto (10)
`chat_bump_conversation_window`ⁱ, `chat_debtor_context`ᴿ, `chat_debtor_names`ᴿ, `chat_log_conversation_transition`ᴿ, `chat_notify_handoff`ᴿ, `chat_phone_match_key`ⁱ, `chat_purge_webhook_events`ᴿ, `chat_record_outbound_message`ᴿ, `chat_report_attendance`ᴿ, `chat_report_overview`ᴿ, `chat_stamp_conversation_transition`ⁱ. *(11 nomes — `chat_stamp_conversation_transition` é invoker sem search_path.)*

### 3.9 Utilitárias / genéricas / triggers de auditoria (7)
`update_updated_at_column`, `set_user_tracking`ᴿ, `log_event`ᴿ, `trg_log_event_changes`ᴿ, `trg_motor_v2_bloqueio_cliente`ᴿ, `check_data_freshness`ᴿ, `norm_phone_br`.

> Os agrupamentos são uma classificação por finalidade (inferida das `purpose` em `functions-analysis.json`); a soma das colunas pode divergir de 115 porque algumas funções servem a mais de um domínio e o overload de `motor_v2_pick_template` conta como 2 entradas (mesma assinatura-base, args distintos). Total autoritativo de objetos: **115** (`bloco-05a`).

---

## 4. Triggers (27) — `bloco-06-triggers.json`

Todos `enabled`. Por tabela:

| tabela | trigger | timing/evento | função |
|--------|---------|---------------|--------|
| `cliente_cadencia` | `trg_event_log_cliente_cadencia` | AFTER I/U/D | `trg_log_event_changes` |
| `clientes_cobranca_dashboard` | `set_user_tracking_trigger` | BEFORE I/U | `set_user_tracking` |
| `clientes_cobranca_dashboard` | `trg_cancel_pending_links_on_payment` | AFTER U | `cancel_pending_links_on_payment` |
| `clientes_cobranca_dashboard` | `trg_guard_recent_payment_dashboard` | BEFORE I/U | `guard_recent_payment_dashboard` |
| `clientes_cobranca_setembro` | `cancel_links_on_regua_valor_update` | AFTER U | `http_request`⁴ |
| `clientes_cobranca_setembro` | `mirror_disparo_fields` | AFTER U | `mirror_disparo_fields_to_dashboard` |
| `clientes_cobranca_setembro` | `trg_guard_recent_payment_setembro` | BEFORE I/U | `guard_recent_payment_setembro` |
| `clientes_cobranca_setembro` | `trg_motor_v2_bloqueio_cliente` | AFTER U | `trg_motor_v2_bloqueio_cliente` |
| `conversations` | `trg_chat_log_transition` | AFTER U | `chat_log_conversation_transition` |
| `conversations` | `trg_chat_notify_handoff` | AFTER U | `chat_notify_handoff` |
| `conversations` | `trg_chat_stamp_transition` | BEFORE U | `chat_stamp_conversation_transition` |
| `disparos_log` | `trg_event_log_disparos_log` | AFTER I/U/D | `trg_log_event_changes` |
| `fila_humana` | `trg_event_log_fila_humana` | AFTER I/U/D | `trg_log_event_changes` |
| `gate_state` | `trg_event_log_gate_state` | AFTER I/U/D | `trg_log_event_changes` |
| `links_pagamentos_gerados` | `update_links_pagamentos_gerados_updated_at` | BEFORE U | `update_updated_at_column` |
| `message_log` | `trg_sync_data_ultimo_disparo` | AFTER I | `sync_data_ultimo_disparo_from_message_log` |
| `messages` | `trg_chat_bump_window` | AFTER I | `chat_bump_conversation_window` |
| `pagamentos` | `update_pagamentos_updated_at` | BEFORE U | `update_updated_at_column` |
| `pagamentos_orfaos` | `trg_orphan_email` | AFTER I | `notify_orphan_payment_created` |
| `phone_health` | `trg_motor_v2_gate_from_phone_health` | AFTER I | `trg_motor_v2_recalc_gate_from_health` |
| `profiles` | `update_profiles_updated_at` | BEFORE U | `update_updated_at_column` |
| `sales_leads` | `update_sales_leads_updated_at` | BEFORE U | `update_updated_at_column` |
| `units` | `update_units_updated_at` | BEFORE U | `update_updated_at_column` |
| `user_unit_permissions` | `update_user_unit_permissions_updated_at` | BEFORE U | `update_updated_at_column` |
| `waba_health` | `trg_motor_v2_gate_from_waba_health` | AFTER I | `trg_motor_v2_recalc_gate_from_health` |
| `waba_violations` | `trg_motor_v2_gate_from_waba_violations` | AFTER I | `trg_motor_v2_recalc_gate_from_health` |
| `webhook_configs` | `update_webhook_configs_updated_at` | BEFORE U | `update_updated_at_column` |

> ⁴ O trigger `cancel_links_on_regua_valor_update` (em `clientes_cobranca_setembro`) chama `http_request` — substituiu, em 2026-05-27, o antigo Database Webhook homônimo (`bloco-14-db-webhooks.json`), que acumulou ~3,96 mi de invocações per-row em updates em massa.

---

## 5. Enums (10) — `bloco-08-enums.json`

| enum | valores |
|------|---------|
| `app_role` | `admin`, `collections_agent`, `user`, `sales_agent` |
| `chat_close_outcome` | `resolvido`, `nao_resolvido`, `fora_de_escopo`, `cliente_nao_respondeu` |
| `chat_conv_event_type` | `queued`, `assigned`, `reassigned`, `returned_to_ai`, `closed` |
| `chat_conversation_status` | `open`, `snoozed`, `closed` |
| `chat_handoff_reason` | `payment_re_register`, `cancel`, `other_support` |
| `chat_message_direction` | `in`, `out` |
| `chat_message_status` | `pending`, `sent`, `delivered`, `read`, `failed` |
| `chat_routing_state` | `ai`, `queued`, `human` |
| `chat_sender_kind` | `ai`, `operator`, `system`, `customer` |
| `permission_type` | `dashboard`, `pagamentos`, `cobranca_time`, `admin`, `whatsapp_errado`, `dashboard_vendas`, `vendas`, `health` |

> 8 dos 10 enums têm prefixo `chat_` (domínio CHAT-CDT). `app_role` e `permission_type` são do domínio Auth/Cobrança.

---

## 6. Índices (229) — `bloco-04-indices.json`

| métrica | valor |
|---------|-------|
| Total de índices | **229** |
| Tamanho total | ~1102 MB |
| `idx_scan = 0` (não usados na janela) | **114** índices · ~656,4 MB |
| `idx_scan = 0` **excluindo PKs** (desperdício real) | **93** índices · **~654,5 MB** |

> O desperdício acionável é **~654,5 MB em 93 índices não-PK nunca varridos** na janela de ~13h — PKs não usadas não são removíveis. Concentração quase total em `clientes_cobranca_dashboard`: top 8 índices não usados (≈441 MB) são todos dessa tabela — `idx_dashboard_disparos_equipe` (108,8 MB), `idx_clientes_dashboard_unit_id` (47,2 MB), `idx_dashboard_unit_id` (45,3 MB), `clientes_cobranca_dashboard_status_idx` (43,1 MB), `clientes_cobranca_dashboard_regua_idx` (42,2 MB), `idx_dashboard_correlation_id` (39,1 MB), `idx_clientes_cobranca_dashboard_data_resposta` (37,8 MB), `idx_dashboard_created_by` (37,6 MB). *(Ressalva: janela curta de stats — um índice "não usado" aqui pode servir a cargas semanais/mensais fora da janela; confirmar antes de dropar.)*

---

## 7. Edge Functions (20) — `edge-functions.json`

| slug | `verify_jwt` | gatilho | finalidade (resumo) |
|------|:---:|---------|---------------------|
| `create-admin-users` | false | http-invoked | Bootstrap/seed de usuários admin fixos. |
| `process-reembolso` | **true** | http-invoked | Reembolso manual (PIX Woovi/OpenPix ou cartão). |
| `cancel-payment-links` | false | http-webhook (DB) | Cancela links em UPDATE de `clientes_cobranca_setembro`. |
| `generate-payment-link` | false | http-invoked | Gera/reusa link PIX Woovi. |
| `woovi-webhook` | false | http-webhook | Webhooks Woovi/OpenPix (PIX), valida HMAC. |
| `list-client-debts` | false | http-invoked | Dívidas pendentes por whatsapp+unit. |
| `stripe-webhook` | false | http-webhook | Webhooks Stripe (charge succeeded/refunded/dispute). |
| `abacate-webhook` | false | http-webhook | Eventos Abacate Pay, valida HMAC-SHA256. |
| `generate-payment-link-abacate` | false | http-invoked | Gera link PIX via Abacate Pay. |
| `process-payouts` | **true** | cron | Repasses diários (chamado pelo n8n via `x-api-key`). |
| `agent-tools` | false | http-invoked | Executor de tools do agente OpenAI (Rafa) no n8n: block/pause/transfer_human. |
| `notify-orphan-email` | false | http-invoked | E-mail de pagamento órfão recém-criado. |
| `reconcile-abacate-pull` | false | cron | Reconciliação diária Abacate (pull). |
| `reconcile-stripe-pull` | false | cron | Reconciliação diária Stripe (pull). |
| `reconcile-woovi-pull` | false | cron | Reconciliação diária Woovi (pull). |
| `sentinel-generate-variation` | false | http-invoked | Reescreve templates recategorizados pela Sentinela. |
| `sentinel-submit-template` | false | http-invoked | Submete variação de template à Meta Graph API. |
| `motor-v2-planejador` | false | cron | Planejador diário de cobrança (08:50 BRT). |
| `motor-v2-sortear-relacionamento` | false | cron | Sorteio diário de relacionamento (11:45 BRT, seg-sex). |
| `motor-v2-fechamento` | false | cron | Fechamento diário do motor (23:00 BRT, seg-sex). |

> Apenas 2 das 20 exigem JWT (`process-reembolso`, `process-payouts`); webhooks de gateway validam por HMAC/assinatura, não JWT.

---

## 8. Extensões relevantes

| extensão | presente? | evidência |
|----------|-----------|-----------|
| `pg_cron` | **sim** | 10 jobs ativos em `bloco-11-cron.json`; `cron.*` referenciado nas defs (`bloco-05b`). |
| `pg_net` | **sim** | `net.http_post` usado ×5 nas defs de função (`call_reconcile_function`, `motor_v2_invoke_edge`, `chat_notify_handoff`, `notify_orphan_payment_created`). |
| `pg_stat_statements` | **sim** | É a origem dos blocos `bloco-10a/10b/10c` (stats por tempo/chamadas/janela). |
| `vault` (Supabase Vault) | **sim** | `vault.*` referenciado ×4 nas defs (segredos `x-api-key`/`cron_secret` lidos via vault). |
| `pgmq` | **ausente** | Nenhuma referência a `pgmq.*` em qualquer fonte (confirmado por grep nas defs). Filas são feitas via `pg_net` + Edge, não pgmq. |
| `wrappers` (FDW/Foreign Data) | **incerto / inferido** | Extensão padrão do stack Supabase, mas **sem uso evidenciado** nas funções/triggers analisadas (grep `wrappers`/`foreign data` = 0). Não confirmado como ativo a partir das fontes brutas. |

---

## 9. Cron Jobs (`pg_cron`) — `bloco-11-cron.json`

**10 jobs ativos** (todos `active=true`). Os `jobid` vão de 1 e 3–11 — **`jobid` 2 está ausente** (job deletado); por isso são 10, não 11.

| jobid | nome | schedule | runs | falhas | últ. status |
|------:|------|----------|-----:|-------:|-------------|
| 1 | `limpeza-links-pagamento` | `0 2 * * *` | 264 | **127** | succeeded |
| 3 | `cleanup_expired_links_daily` | `0 4 * * *` | 25 | 0 | succeeded |
| 4 | `reconcile-woovi-daily` | `0 5 * * *` | 20 | 0 | succeeded |
| 5 | `reconcile-stripe-daily` | `15 5 * * *` | 20 | 0 | succeeded |
| 6 | `reconcile-abacate-daily` | `30 5 * * *` | 20 | 0 | succeeded |
| 7 | `data-freshness-check` | `*/15 * * * *` | 619 | 0 | succeeded |
| 8 | `motor-v2-planejador-daily` | `50 11 * * 1-5` | 2 | 0 | succeeded |
| 9 | `motor-v2-sortear-relacionamento-daily` | `45 14 * * 1-5` | 2 | 0 | succeeded |
| 10 | `motor-v2-fechamento-daily` | `0 2 * * 2-6` | 3 | 0 | succeeded |
| 11 | `chat_purge_webhook_events_daily` | `0 3 * * *` | 5 | 0 | succeeded |

> Sinal de atenção: `limpeza-links-pagamento` (jobid 1) acumulou **127 falhas em 264 execuções** (~48%), apesar do último status `succeeded` — histórico de instabilidade. Único job do CHAT-CDT: `chat_purge_webhook_events_daily` (jobid 11). Os demais são de Cobrança/pagamentos.
