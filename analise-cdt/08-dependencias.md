# 08 — Grafo de Dependências e Matriz Quem-Lê / Quem-Escreve

> **Escopo e honestidade metodológica.** Esta matriz é construída cruzando **cinco fontes de backend**:
> `functions-analysis.json` (115 funções PL/pgSQL), `edge-functions.json` (20 Edge Functions Deno),
> `n8n-workflows.json` (6 workflows), `views-analysis.json` (11 views) e `bloco-06-triggers.json` (27 triggers).
>
> **Ponto cego crítico — a app Next.js é invisível a estas 5 fontes.** As tabelas do CHAT-CDT
> (`conversations`, `contacts`, `messages`, `chat_*`) são dirigidas pelo cliente Supabase em `app/` e `lib/`,
> que NÃO aparece em nenhum dos cinco JSONs. **Ausência de reader/writer aqui significa apenas
> "não tocado pela automação de backend", NÃO "sem uso".** Para desambiguar uso vivo, sobrepus uma
> **camada de liveness independente** com os contadores `pg_stat_user_tables` de `bloco-01-tabelas.json`
> (`seq_scan`, `idx_scan`, `n_tup_ins/upd/del`). Inferências estão marcadas com **(inf.)**.
>
> **Semântica de trigger.** Um trigger *sobre* X não é, por si só, reader/writer de X — quem carrega o
> fluxo de dados é a *função* do trigger (já presente em `functions-analysis`). Uso os triggers como
> (a) sinal de liveness e (b) arestas de cascata no grafo.
>
> Notação na matriz: `fn:` = função PL/pgSQL · `edge:` = Edge Function · `n8n:` = workflow n8n ·
> `view:` = view · **app** = cliente Supabase em `app/`+`lib/` (confirmado por grep ou inferido).

---

## 1. Grafo de dependência (acoplamento de alto nível)

### 1.1 Entradas externas → orquestradores → tabelas

```
META Graph API (WhatsApp inbound)
   │
   ├─► n8n [RabbitMQ]  ──RPC──► route_inbound ──────► R: clientes_cobranca_setembro, adimplentes_base, units, disparadores_whatsapp
   │                   ──RPC──► record_inbound_message ► W: message_inbound      R: disparadores_whatsapp
   │
   ├─► app Next.js  /api/meta/webhook (route.ts) ───► W: chat_webhook_events, conversations, contacts, messages
   │
   └─► n8n [Tatuapé-SP cobrança] / [Relacionamento]
            ├─edge► generate-payment-link(-abacate) ─RPC► upsert_payment_link ─► W: links_pagamentos_gerados
            │                                          └► R/W: clientes_cobranca_setembro, _dashboard
            ├─edge► agent-tools ─RPC► agent_block/pause_customer ─► W: clientes_cobranca_setembro; R/W: conversations, contacts
            ├─edge► list-client-debts ─RPC► get_phone_pending_debts ─► R: clientes_cobranca_setembro, pagamentos, links
            ├─RPC► chat_record_outbound_message ─► W: messages, contacts; R: conversations, wabas, chat_phone_numbers
            └─RPC► isa_registrar_opt_out ─► W: adimplentes_base

Gateways de pagamento (Woovi/OpenPix, Stripe, Abacate)
   │
   └─► edge [*-webhook] / [reconcile-*-pull]
            ├─RPC► register_payment ───────► W: pagamentos, clientes_cobranca_setembro, _dashboard, links, pagamentos_orfaos
            ├─RPC► mark_refund_by_correlation ► W: pagamentos, _dashboard
            ├─RPC► resolve_orfao_matricula ──► R: _dashboard, links → W: pagamentos_orfaos
            └─► W: webhook_events_log (idempotência/auditoria)

Google Drive (planilhas) → n8n [Sync Power BI v3] ─RPC► sync_cobranca_v2 ─► W: setembro, _dashboard, backups, sync_snapshots
                          n8n [Sync Adimplentes]  ─────────────────────► W: adimplentes_base (via motor_v2_adimplentes_*)

pg_cron / scheduleTrigger
   ├─► n8n [DISPAROS MOTOR V2] ─RPC► motor_v2_get_disparos ─► R: setembro, cliente_cadencia, template_inventory, cadence_calendar, gate_state
   └─► edge [motor-v2-planejador / -fechamento / -sortear-relacionamento]
            └─RPC► log_event, motor_v2_* ─► W: cliente_cadencia, disparos_log, event_log, gate_state, adimplentes_base
```

### 1.2 Cascatas de trigger (acoplamento implícito — arestas que ligam os hubs)

| Origem (tabela com trigger)                        | Trigger → função                                                              | Destino afetado                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `clientes_cobranca_setembro`                       | `mirror_disparo_fields` → `mirror_disparo_fields_to_dashboard`                | **`clientes_cobranca_dashboard`** (liga os 2 hubs de cobrança) |
| `clientes_cobranca_setembro`                       | `cancel_links_on_regua_valor_update` → `http_request`                         | `links_pagamentos_gerados` (via HTTP edge cancel)              |
| `clientes_cobranca_dashboard`                      | `trg_cancel_pending_links_on_payment` → `cancel_pending_links_on_payment`     | `links_pagamentos_gerados`                                     |
| `clientes_cobranca_setembro` / `_dashboard`        | `trg_motor_v2_bloqueio_cliente`                                               | `cliente_cadencia`, `fila_humana`, `event_log`                 |
| `waba_health` / `phone_health` / `waba_violations` | `trg_motor_v2_*_from_health` → `trg_motor_v2_recalc_gate_from_health`         | **`gate_state`** → `event_log` (cascata de saúde→gate)         |
| `pagamentos`                                       | `trg_orphan_email` (em `pagamentos_orfaos`) → `notify_orphan_payment_created` | edge `notify-orphan-email` (lê `app_internal_config`)          |
| `conversations`                                    | `trg_chat_log_transition` / `_notify_handoff` / `_stamp_transition`           | `chat_conversation_events`, push fanout (`chat_config`)        |
| `messages`                                         | `trg_chat_bump_window` → `chat_bump_conversation_window`                      | `conversations` (janela 24h Meta)                              |
| `message_log`                                      | `trg_sync_data_ultimo_disparo` → `sync_data_ultimo_disparo_from_message_log`  | `clientes_cobranca_setembro`, `_dashboard`                     |
| 10 tabelas de cobrança/motor                       | `trg_event_log_*` → `trg_log_event_changes`                                   | **`event_log`** (hub de auditoria genérico)                    |

### 1.3 Os 3 hubs de acoplamento

- **`clientes_cobranca_dashboard`** (1.793 MB, idx_scan 89.501) — hub de **leitura** financeira: 24 readers, 15 writers. Toda checkout/recibo/reconciliação/KPI passa por ele. Espelhado a partir de `setembro` via trigger.
- **`clientes_cobranca_setembro`** (43 MB, idx_scan 233.906) — hub de **estado operacional** da cobrança: 18 readers, 17 writers + n8n. É a fonte canônica do motor de cadência/disparo; alimenta o dashboard por trigger.
- **`units`** (idx_scan 289.616, **0 writers**) — hub de **referência/tenant**: 38 readers (8 edge + 22 fn + 1 n8n + 7 views). Tabela-âncora multi-tenant lida por quase toda RLS e relatório. Conteúdo gerido manualmente/admin.

---

## 2. Matriz quem-lê / quem-escreve (59 tabelas)

> Coluna **pg_stat**: `idx`=idx_scan, `i/u/d`=ins/upd/del. Sinaliza atividade real mesmo sem reader/writer mapeado.

### 2.1 Núcleo Cobrança (hubs e motor)

| Tabela | R | W | Readers (resumo) | Writers (resumo) | pg_stat | Classe |
|---|---|---|---|---|---|---|
| `clientes_cobranca_dashboard` | 24 | 15 | 7 edge (webhooks/reconcile), fn chat_debtor_*, get_cobranca_*, get_pay_* | 5 edge + fn register_payment, sync_cobranca_*, mirror_disparo, mark_refund | idx 89.501 · u 48.358 | **Cobrança** |
| `clientes_cobranca_setembro` | 18 | 17 | edge motor-v2-*, fn motor_v2_*, advance_cadence, route_inbound + n8n | edge gen-link, fn register_payment, agent_*, picker, sync_* + n8n | idx 233.906 · u 50.142 | **Cobrança** |
| `cliente_cadencia` | 4 | 6 | edge motor-v2-fechamento/planejador, fn motor_v2_get/finalizar | edge motor-v2-*, fn motor_v2_avancar/finalizar, trg_bloqueio | idx 83.423 · i 27.589 | **Cobrança** |
| `links_pagamentos_gerados` | 20 | 8 | 7 edge, fn buscar_links_*, get_pay_*, chat_debtor_context | edge gen-link/cancel, fn register_payment, upsert_payment_link, cleanup | idx 7.983 · u 1.536 | **Cobrança** |
| `pagamentos` | 29 | 3 | 7 edge, fn get_cobranca_*, get_daily_payments*, 3 views | edge stripe-webhook, fn register_payment, mark_refund | idx 310.133 · i 377 | **Cobrança** |
| `pagamentos_orfaos` | 3 | 6 | edge notify-orphan, fn auto_reconcile/reconcile_orfao | 4 edge reconcile/webhook, fn descartar/reconcile_orfao | idx 1 · i 0 | **Cobrança** |
| `adimplentes_base` | 5 | 5 | edge sortear-relacionamento, fn motor_v2_relacionamento_*, route_inbound + n8n | edge sortear, fn isa_opt_out, motor_v2_adimplentes_* | idx 162.170 · i 157.216 | **Cobrança** |
| `disparadores_whatsapp` | 11 | **0** | 3 edge motor-v2, fn buscar_links, motor_v2_*, record_* | **— (inf.: n8n/motor PATCH não capturado)** | idx 22.933 · **u 9.687** | **Cobrança** |
| `template_inventory` | 10 | 2 | fn motor_v2_*, picker, sentinel + 2 n8n + 2 views | fn sentinel_apply_meta_event/register_variation | idx 77.999 · u 4.446 | **Cobrança** |
| `blacklist_global` | 1 | 1 | fn is_blacklisted | fn add_to_blacklist | idx 2.800 · i 114 | **Cobrança** |
| `cadence_calendar` | 2 | **0** | edge motor-v2-planejador, fn motor_v2_get_disparos | **— (referência estática)** | idx 6.500 · 0 | **Cobrança** |
| `cadence_slot_config` | 2 | **0** | fn advance_cadence_state, picker_select_batch | **— (config manual)** | idx 0 · seq 10.513 | **Cobrança** |
| `gate_state` | 3 | 1 | edge motor-v2-planejador/sortear, fn motor_v2_get_disparos | fn motor_v2_recalc_gate | idx 2.016 · u 2.016 | **Cobrança** |
| `gate_config` | 2 | **0** | edge motor-v2-planejador, fn motor_v2_recalc_gate | **— (config)** | idx 2.016 · 0 | **Cobrança** |
| `disparos_log` | 2 | 3 | edge motor-v2-planejador/sortear | edge motor-v2-*, fn motor_v2_cancel_future_disparos | idx 451 · 0 | **Cobrança** |
| `system_state` | 5 | **0** | 3 edge motor-v2, fn motor_v2_recalc_gate, picker | **— (estado lido; escrita via uncaptured)** | idx 4.860 · u 1 | **Cobrança** |
| `agents` | 2 | **0** | n8n Tatuapé-SP, Relacionamento | **— (inf.: gerido por admin/n8n)** | idx 43 · i 13 u 27 | **Cobrança** |

### 2.2 Saúde de número / WABA / templates

| Tabela | R | W | Readers | Writers | pg_stat | Classe |
|---|---|---|---|---|---|---|
| `waba_health` | 1 | 1 | view v_waba_health_current | fn record_waba_health_snapshot | idx 0 · i 1.001 | **Cobrança** |
| `phone_health` | 3 | 2 | fn motor_v2_recalc_gate, rpc_phone_health, view | fn record_meta_account_event, record_phone_health_snapshot | idx 2.576 · i 1.001 | **Cobrança** |
| `waba_violations` | 1 | 1 | view v_waba_violations_recent | fn record_meta_account_event | idx 560 · i 1 | **Cobrança** |
| `waba_capability` | 1 | 1 | view v_waba_capability_current | fn record_meta_account_event | idx 0 · 0 | **Cobrança** |
| `template_status_log` | 1 | **0** | view v_template_current | **— (inf.: snapshot via Sentinel/edge)** | idx 241 · 0 | **Cobrança** |
| `template_master` | **0** | **0** | **—** | **—** | idx 0 · 0 (vazia) | **Morta/Backup** |

### 2.3 Mensageria / webhooks / logs

| Tabela | R | W | Readers | Writers | pg_stat | Classe |
|---|---|---|---|---|---|---|
| `message_log` | 6 | 2 | fn rpc_* (relatórios), sync_data_ultimo, view v_message_perf_24h | fn advance_cadence_state, record_message_status | idx 93.495 · i 10.058 | **Cobrança** |
| `message_inbound` | 1 | 2 | fn rpc_inbound_summary | fn record_inbound_message + n8n RabbitMQ | idx 3.796 · i 3.791 | **Compartilhada** |
| `webhook_events_log` | 4 | 12 | edge notify-orphan, process-reembolso, stripe/woovi-webhook | 12 edge (pagamento/payout) + fn record_meta_account_event | idx 386 · i 383 | **Cobrança** |
| `event_log` | **0** | 5 | **— (log write-only; leitura ad-hoc/app)** | fn log_event, motor_v2_invoke_edge, trg_log_event_changes +2 | idx 1 · **i 30.890** | **Cobrança** |
| `data_freshness_log` | **0** | 1 | **— (write-only audit)** | fn check_data_freshness | idx 1 · i 255 | **Cobrança** |
| `spreadsheet_sync_log` | 1 | 1 | fn sync_cobranca_v2 | fn sync_cobranca_v2 | idx 1 · 0 | **Cobrança** |
| `log_limpeza_links` | **0** | 1 | **— (write-only audit)** | fn limpar_links_pagamento_expirados | idx 0 · i 1 | **Cobrança** |
| `adimplentes_import_log` | **0** | 1 | **— (write-only audit)** | fn motor_v2_adimplentes_finalize | idx 0 · i 11 | **Cobrança** |

### 2.4 Núcleo CHAT-CDT (atendimento humano — dirigido pela app Next.js)

| Tabela                     | R     | W     | Readers (backend)                                         | Writers (backend)                                          | pg_stat               | Classe            |
| -------------------------- | ----- | ----- | --------------------------------------------------------- | ---------------------------------------------------------- | --------------------- | ----------------- |
| `conversations`            | 7     | 3     | edge agent-tools, fn chat_* + **app**                     | edge agent-tools, fn chat_bump/record_outbound + **app**   | idx 35.394 · u 4.011  | **CHAT-CDT**      |
| `contacts`                 | 3     | 1     | edge agent-tools, fn chat_debtor_* + **app**              | fn chat_record_outbound + **app**                          | idx 51.680 · u 7.348  | **Compartilhada** |
| `messages`                 | 1     | 1     | fn chat_report_overview + **app**                         | fn chat_record_outbound_message + **app**                  | idx 166.150 · i 8.306 | **CHAT-CDT**      |
| `chat_webhook_events`      | **0** | 1     | **— (app /api/meta/webhook escreve; purge lê)**           | fn chat_purge_webhook_events + **app (confirmado)**        | idx 4 · **i 4.734**   | **CHAT-CDT**      |
| `chat_conversation_events` | **0** | 1     | **— (app reporta; leitura invisível às 5 fontes)**        | fn chat_log_conversation_transition (trigger) + **app**    | idx 3 · i 171         | **CHAT-CDT**      |
| `chat_push_subscriptions`  | **0** | **0** | **app `/api/internal/push/notify` (select) — confirmado** | **app `/api/push/subscribe` (insert/upsert) — confirmado** | idx 3 · i 1           | **CHAT-CDT**      |
| `chat_config`              | 1     | **0** | fn chat_notify_handoff                                    | **— (config GUC/manual)**                                  | idx 345 · 0           | **CHAT-CDT**      |
| `chat_phone_numbers`       | 1     | **0** | fn chat_record_outbound_message                           | **— (referência; admin/app)**                              | idx 94.878 · 0        | **CHAT-CDT**      |
| `wabas`                    | 1     | **0** | fn chat_record_outbound_message                           | **— (referência; admin/app)**                              | idx 88.917 · 0        | **Compartilhada** |

> **Nota landmine:** `chat_push_subscriptions`, `chat_webhook_events` e `chat_conversation_events` aparecem
> com R=0 e/ou W=0 nesta matriz **mas NÃO estão mortas** — são tabelas vivas do CHAT-CDT escritas/lidas pela app.
> `chat_push_subscriptions` foi **confirmado por grep** em `app/api/push/subscribe/route.ts` (insert/select)
> e `app/api/internal/push/notify/route.ts` (select). É feature nascente (1 linha), não peso morto.

### 2.5 Identidade / tenant / RLS / config

| Tabela | R | W | Readers | Writers | pg_stat | Classe |
|---|---|---|---|---|---|---|
| `units` | 38 | **0** | 8 edge + 22 fn + n8n + 7 views | **— (catálogo gerido manual/admin)** | idx 289.616 · 0 | **Compartilhada** |
| `user_unit_permissions` | 12 | 4 | fn can_access/rpc_*/user_can_read | fn ensure_admin/grant/revoke/handle_new_user | idx 732.175 · 0 | **Compartilhada** |
| `user_units` | 5 | **0** | fn chat_* (RLS helpers) | **— (inf.: app/admin escreve)** | seq 1.219.180 · 0 | **CHAT-CDT** |
| `profiles` | 8 | 3 | edge create-admin, fn chat_*, get_users_with_emails | edge create-admin, fn create_admin_user, handle_new_user | idx 1.219.315 · 0 | **Compartilhada** |
| `user_roles` | 7 | 5 | edge create-admin/process-reembolso, fn has_role, can_access | edge create-admin, fn assign_admin_role, handle_new_user | seq 90M+ · 0 | **Compartilhada** |
| `app_internal_config` | 2 | **0** | fn call_reconcile_function, notify_orphan_payment | **— (config)** | idx 3 · 0 | **Cobrança** |
| `payment_gateway_configs` | 8 | **0** | 8 edge (gen-link/reconcile/payout/reembolso) | **— (config gateways; admin)** | idx 584 · 0 | **Cobrança** |
| `webhook_configs` | **0** | **0** | **—** | **—** | idx 0 · 0 (vazia) | **Morta/Backup** |

### 2.6 Pagamentos avançado / payouts / reconciliação

| Tabela | R | W | Readers | Writers | pg_stat | Classe |
|---|---|---|---|---|---|---|
| `payouts` | 2 | 1 | edge process-payouts, fn link_payout_charges | edge process-payouts | idx 4 · 0 | **Cobrança** |
| `payout_pagamentos` | **0** | 1 | **— (inf.: leitura via join em relatório/app)** | fn link_payout_charges | idx 0 · 0 | **Cobrança** |
| `cobranca_clientes_removidos` | **0** | 2 | **— (write-only; rollback consulta backup)** | fn rollback_sync, sync_cobranca_v2 | idx 0 · 0 | **Cobrança** |
| `fila_humana` | 1 | 2 | fn trg_motor_v2_bloqueio_cliente | fn motor_v2_finalizar_dia22, trg_bloqueio | idx 356 · i 355 | **Cobrança** |

### 2.7 Backups / snapshots / legado / vazias

| Tabela | R | W | Readers | Writers | pg_stat | Classe |
|---|---|---|---|---|---|---|
| `cobranca_sync_backup` | 1 | 1 | fn rollback_sync | fn sync_cobranca_v2 | idx 2 · 0 (9.203 lin) | **Compartilhada** (backup vivo) |
| `sync_snapshots` | 1 | 2 | fn sync_cobranca_v2 | fn rollback_sync, sync_cobranca_v2 | idx 0 · 0 (vazia) | **Cobrança** (infra de rollback) |
| `agents_bak_20260601_precancel` | **0** | **0** | **—** | **—** | i 14 (snapshot) | **Morta/Backup** |
| `agents_bak_20260601_prerename` | **0** | **0** | **—** | **—** | i 13 (snapshot) | **Morta/Backup** |
| `faturamento_baixas` | **0** | **0** | **—** | **—** | idx 33 · i 3 d 2 | **Morta/Backup** |
| `sales_leads` | **0** | **0** | **—** | **—** | idx 0 · 0 (vazia) | **Morta/Backup** |
| `todos` | **0** | **0** | **—** | **—** | idx 1 · 0 (vazia) | **Morta/Backup** |

---

## 3. Classificação das 59 tabelas (justificativa de 1 linha)

| Tabela | Classe | Justificativa |
|---|---|---|
| `clientes_cobranca_dashboard` | Cobrança | Hub financeiro espelhado; lido por todo checkout/recibo/KPI, escrito por register_payment/sync. |
| `clientes_cobranca_setembro` | Cobrança | Estado canônico do motor de cadência/disparo; fonte do dashboard via trigger. |
| `cliente_cadencia` | Cobrança | Estado de cadência por cliente, dirigido pelos edge/fn motor-v2. |
| `links_pagamentos_gerados` | Cobrança | Links PIX/cartão gerados pelos gateways e consumidos em checkout. |
| `pagamentos` | Cobrança | Ledger de pagamentos confirmados; lido por relatórios e reconciliação. |
| `pagamentos_orfaos` | Cobrança | Pagamentos sem matrícula resolvida, fila de reconciliação manual/auto. |
| `adimplentes_base` | Cobrança | Base de relacionamento (adimplentes) do motor-v2; 157k linhas ativas. |
| `disparadores_whatsapp` | Cobrança | Config de disparadores por unidade; **escrita ativa (upd 9.687) por writer n8n não capturado (inf.)**. |
| `template_inventory` | Cobrança | Inventário de templates WhatsApp por WABA, lido por motor/sentinel. |
| `blacklist_global` | Cobrança | Opt-outs/bloqueios globais de cobrança. |
| `cadence_calendar` | Cobrança | Calendário estático de cadência (referência sem writer de backend). |
| `cadence_slot_config` | Cobrança | Config de slots de cadência (referência manual). |
| `gate_state` | Cobrança | Estado do gate de envio por unidade, recalculado de health. |
| `gate_config` | Cobrança | Parâmetros do gate (config). |
| `disparos_log` | Cobrança | Log/agenda de disparos do motor-v2. |
| `system_state` | Cobrança | Flags de estado global do motor; lido por edge/fn (escrita uncaptured). |
| `agents` | Cobrança | Catálogo de agentes IA/unidade lido por n8n (gerido por admin/n8n, inf.). |
| `waba_health` | Cobrança | Snapshots de saúde WABA → alimentam gate. |
| `phone_health` | Cobrança | Snapshots de saúde de número → alimentam gate. |
| `waba_violations` | Cobrança | Violações Meta → alimentam gate. |
| `waba_capability` | Cobrança | Capacidade/tier WABA atual. |
| `template_status_log` | Cobrança | Histórico de status de template (snapshot via Sentinel/edge, inf.). |
| `template_master` | Morta/Backup | Vazia, sem reader/writer em nenhuma fonte; idx 0. |
| `message_log` | Cobrança | Log de mensagens de cobrança (custo, status, cadência); 260k linhas. |
| `message_inbound` | Compartilhada | Inbound bruto gravado por n8n RabbitMQ e lido por relatórios. |
| `webhook_events_log` | Cobrança | Idempotência/auditoria de webhooks de pagamento. |
| `event_log` | Cobrança | Log de eventos write-only do motor (30.890 ins); leitura ad-hoc/app. |
| `data_freshness_log` | Cobrança | Auditoria write-only de frescor de dados. |
| `spreadsheet_sync_log` | Cobrança | Log de sync de planilha (lido/escrito pela própria sync_cobranca_v2). |
| `log_limpeza_links` | Cobrança | Auditoria write-only da limpeza de links expirados. |
| `adimplentes_import_log` | Cobrança | Auditoria write-only de importação de adimplentes. |
| `conversations` | CHAT-CDT | Núcleo do handoff humano; dirigido pela app + edge agent-tools. |
| `contacts` | Compartilhada | Contato compartilhado entre cobrança (n8n/edge) e chat (app). |
| `messages` | CHAT-CDT | Mensagens do atendimento humano; escritas pela app/RPC outbound. |
| `chat_webhook_events` | CHAT-CDT | Eventos do webhook Meta da app (4.734 ins); purge por fn (app confirmado). |
| `chat_conversation_events` | CHAT-CDT | Log de transições de conversa (trigger + app reporta). |
| `chat_push_subscriptions` | CHAT-CDT | Subscrições push; **confirmado lido/escrito pela app (não morta)**. |
| `chat_config` | CHAT-CDT | Config de push/handoff (GUC/manual). |
| `chat_phone_numbers` | CHAT-CDT | Referência de números do chat (idx 94k); gerido por admin/app. |
| `wabas` | Compartilhada | Catálogo de WABAs lido por chat e cobrança. |
| `units` | Compartilhada | Tenant-âncora multi-tenant; 38 readers, catálogo manual. |
| `user_unit_permissions` | Compartilhada | Permissões unidade↔usuário, base da RLS de cobrança. |
| `user_units` | CHAT-CDT | Vínculo operador↔unidade da RLS do chat (escrita app/admin, inf.). |
| `profiles` | Compartilhada | Perfis de operador, compartilhados auth/chat/cobrança. |
| `user_roles` | Compartilhada | Papéis (admin) consultados por has_role em ambos os lados. |
| `app_internal_config` | Cobrança | Config interna (segredo cron/origem) para reconcile/orphan. |
| `payment_gateway_configs` | Cobrança | Credenciais/config dos gateways de pagamento. |
| `webhook_configs` | Morta/Backup | Vazia, sem reader/writer; idx 0. |
| `payouts` | Cobrança | Saques PIX (payout) do fluxo Abacate. |
| `payout_pagamentos` | Cobrança | Junção payout↔pagamento (leitura via relatório/app, inf.). |
| `cobranca_clientes_removidos` | Cobrança | Write-only: clientes removidos no sync, consultado em rollback. |
| `fila_humana` | Cobrança | Fila de transferência cobrança→humano do motor-v2. |
| `cobranca_sync_backup` | Compartilhada | Backup vivo (9.203 lin) usado por rollback_sync. |
| `sync_snapshots` | Cobrança | Infra de rollback do sync (vazia entre execuções). |
| `agents_bak_20260601_precancel` | Morta/Backup | Snapshot manual datado de `agents` (pré-cancelamento). |
| `agents_bak_20260601_prerename` | Morta/Backup | Snapshot manual datado de `agents` (pré-rename). |
| `faturamento_baixas` | Morta/Backup | Quase vazia (1 lin), sem reader/writer em nenhuma fonte. |
| `sales_leads` | Morta/Backup | Vazia, só trigger de updated_at; sem reader/writer. |
| `todos` | Morta/Backup | Vazia, tabela boilerplate; sem reader/writer. |

**Resumo da classificação:** CHAT-CDT = 8 · Cobrança = 37 · Compartilhada = 7 · Morta/Backup = 7 (total 59).

---

## 4. Destaques

### 4.1 Tabelas SEM writer de backend identificado (W = 0)

Separadas em três tiers — **a maioria NÃO é legado**:

**(a) Referência/config — mantidas manualmente ou via admin/app (vivas; idx_scan alto):**
`units` (idx 289k), `user_units` (seq 1,2M), `wabas` (idx 88k), `chat_phone_numbers` (idx 94k),
`gate_config`, `payment_gateway_configs`, `cadence_slot_config`, `app_internal_config`,
`system_state`, `chat_config`, `agents`, `cadence_calendar`, `template_status_log`, `payout_pagamentos`.

**(b) Writer ativo NÃO capturado pela extração — pg_stat prova escrita (inferência):**
**`disparadores_whatsapp`** — `upd = 9.687`, mas nenhuma das 5 fontes mostra writer. É o gêmeo, no lado
cobrança, do ponto cego da app: um PATCH de n8n/motor não mapeado. **Marcar como inferência, não legado.**

**(c) Genuinamente sem escrita = legado/peso morto:** `template_master`, `webhook_configs`,
`sales_leads`, `todos`, `faturamento_baixas`, `agents_bak_20260601_precancel`, `agents_bak_20260601_prerename`.

### 4.2 Tabelas SEM reader de backend identificado (R = 0)

**(a) Logs de auditoria write-only — por design, NÃO mortos (consumidos ad-hoc / por relatório da app):**
`event_log` (**30.890 ins**), `data_freshness_log`, `log_limpeza_links`, `adimplentes_import_log`,
`cobranca_clientes_removidos`, `chat_webhook_events` (**4.734 ins**).

**(b) Dirigidas pela app — reader invisível às 5 fontes (vivas):**
`chat_conversation_events`, `chat_push_subscriptions` (**leitura confirmada por grep** em
`app/api/internal/push/notify/route.ts`).

**(c) Genuinamente sem leitura = peso morto/vazias:** `template_master`, `sales_leads`,
`webhook_configs`, `todos`, `faturamento_baixas`, `agents_bak_*`.

### 4.3 Interseção R=0 ∩ W=0 (candidatas "definitivamente mortas") — com 1 exceção crítica

| Tabela | Veredicto |
|---|---|
| `template_master` | **Morta** — vazia, idx 0. |
| `webhook_configs` | **Morta** — vazia, idx 0. |
| `sales_leads` | **Morta** — vazia. |
| `todos` | **Morta** — boilerplate vazio. |
| `faturamento_baixas` | **Morta** — 1 linha, idx 33 residual. |
| `agents_bak_20260601_precancel` | **Backup** — snapshot datado. |
| `agents_bak_20260601_prerename` | **Backup** — snapshot datado. |
| **`chat_push_subscriptions`** | **VIVA — NÃO MEXER.** Feature de push do CHAT-CDT; app escreve (subscribe) e lê (notify). Aparece em R0∩W0 só porque a app é cega às 5 fontes. |

### 4.4 Hubs de acoplamento (maior fan-in/fan-out)

| Hub | Fan-in (readers) | Fan-out (writers) | Papel |
|---|---|---|---|
| `units` | **38** | 0 | Tenant-âncora multi-tenant; toda RLS/relatório lê. Mexer = risco sistêmico amplo. |
| `pagamentos` | 29 | 3 | Ledger financeiro; centro dos relatórios e reconciliação. |
| `clientes_cobranca_dashboard` | 24 | 15 | Hub financeiro espelhado de `setembro`. |
| `links_pagamentos_gerados` | 20 | 8 | Centro do fluxo de checkout/cancelamento. |
| `clientes_cobranca_setembro` | 18 | 17 | Hub de estado do motor; alimenta o dashboard por trigger. |
| `user_unit_permissions` | 12 | 4 | Base da RLS de cobrança (idx 732k). |

> **Aresta de acoplamento mais sensível:** `clientes_cobranca_setembro` —(trigger `mirror_disparo_fields_to_dashboard`)→
> `clientes_cobranca_dashboard`. Liga diretamente os dois maiores hubs de cobrança; qualquer alteração de
> schema em `setembro` propaga ao `dashboard` (1,8 GB) via trigger síncrono.

---

## 5. Dependências externas (fora das 59 tabelas)

Referências de leitura/escrita que apontam para **fora** do conjunto analisado (não entram na matriz):
`auth.users`, `auth.identities` (Supabase Auth, via `handle_new_user`/`create_admin_user`/edge create-admin) ·
`vault.decrypted_secrets` (segredos) · `information_schema.tables` (introspecção) ·
`n8n_cobranca_histories`, `n8n_relacionamento_histories` (memória de conversa do n8n, fora do schema CHAT-CDT).
APIs externas: Meta Graph, Woovi/OpenPix, Stripe, AbacatePay, Anthropic (Sentinel), RabbitMQ, Redis.
