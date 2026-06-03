# 00 — Resumo: panorama de alto nível do banco Supabase (ref `ubwcxktaruxqacxltovq`)

Banco **compartilhado** entre o n8n (cobrança/relacionamento em produção) e o CHAT-CDT
(atendimento humano de handoff). Este documento é o panorama de entrada da análise; os
detalhes por tabela ficam em `02-tabelas/` e os demais blocos em `raw/`.

---

## Data e janela do snapshot

- **Snapshot tirado em:** `2026-06-02T03:25:41Z` (campo `snapshot_at`).
  Fonte: `raw/bloco-10c-stat-janela.json`.
- **`pg_stat_statements` foi resetado em** `2026-06-01T14:11:34Z` → a **janela de
  estatísticas de uso é de ~13h** (`13:14:06`). Fonte: `raw/bloco-10c-stat-janela.json`.

> **Atenção — leia antes de citar qualquer número de uso:**
> Todas as estatísticas de **tempo gasto / nº de chamadas por query**
> (`raw/bloco-10a-stat-por-tempo.json` e `raw/bloco-10b-stat-por-chamadas.json`) refletem
> **apenas essas ~13h** desde o reset. NÃO representam carga histórica nem média diária.
> **Caveat separado:** os contadores `seq_scan` / `idx_scan` / `n_tup_*` de
> `raw/bloco-01-tabelas.json` vêm de `pg_stat_user_tables`, que tem reset **independente**
> de `pg_stat_statements`. Não há timestamp de reset capturado para esses contadores — sua
> janela é **desconhecida** (provavelmente desde o último restart/`pg_stat_reset`, não 13h).
> Inferência: não atribuir "em 13h" a nenhum número de scan de bloco-01.

---

## Contagens (snapshot 2026-06-02)

| Objeto | Qtd | Fonte |
|---|---|---|
| Tabelas (schema `public`) | **59** | `raw/bloco-01-tabelas.json` |
| Views | **11** | `raw/bloco-07-views.json` |
| Funções | **115** | `raw/bloco-05a-funcoes-meta.json` / `functions-analysis.json` |
| Triggers | **27** | `raw/bloco-06-triggers.json` |
| Enums | **10** | `raw/bloco-08-enums.json` |
| Policies (RLS) | **64** ⚠️ | `raw/bloco-09-policies.json` |
| Edge Functions | **20** | `edge-functions.json` |
| Workflows n8n | **6** | `n8n-workflows.json` |
| Cron jobs (pg_cron) | **10** ⚠️ | `raw/bloco-11-cron.json` |
| Bucket de storage | **1** (`chat-media`) | `raw/bloco-13-storage.json` |
| Objetos no bucket | **1.563** (≈153 MB) | `raw/bloco-13-storage.json` |

### ⚠️ Discrepâncias com o brief da tarefa (reconciliadas, não erros)

- **Policies — brief diz 65, extração tem 64.** `raw/bloco-09-policies.json` lista 64 rows;
  a soma de `n_policies` por tabela em `raw/bloco-01-tabelas.json` também dá **exatamente 64**,
  e nenhuma policy de `storage.*` aparece em bloco-09. **Inferência:** a 65ª policy quase
  certamente é uma policy em `storage.objects` (bucket `chat-media`, que é privado), fora do
  recorte de tabelas `public` desta extração. Adoto **64** como autoritativo para `public`.
- **Cron — brief diz 11, extração tem 10.** Os `jobid` em `raw/bloco-11-cron.json` são
  1, 3, 4, 5, 6, 7, 8, 9, 10, 11 — **falta o `jobid` 2**. Todas as 10 linhas estão
  `active:true`. **Inferência:** o "11" do brief conta o `jobid` 2 (deletado, ou inativo e
  filtrado pela extração). Adoto **10 jobs ativos** como autoritativo.

---

## Domínios (agrupamento funcional das 59 tabelas)

Classificação por domínio com base nos comentários de tabela (`raw/bloco-01-tabelas.json`),
no lineage de funções (`functions-analysis.json`) e nos consumidores
(`edge-functions.json`, `n8n-workflows.json`). Domínio = inferência analítica.

### 1. CHAT-CDT (atendimento humano de handoff) — prefixo `chat_` + 4 sem prefixo
`conversations`, `contacts`, `messages`, `wabas`, `chat_phone_numbers`,
`chat_conversation_events`, `chat_webhook_events`, `chat_push_subscriptions`,
`chat_config`. Realtime ligado em `conversations` e `messages`
(`raw/bloco-12-realtime.json`). Bucket `chat-media` é deste domínio.

### 2. Cobrança / Motor-v2 (cadência de inadimplentes)
Núcleo de dados: `clientes_cobranca_setembro` (base canônica, 49,6k linhas) e
`clientes_cobranca_dashboard` (**duplicata** declarada, 95,7k linhas, 1,8 GB).
Motor: `cliente_cadencia`, `cadence_calendar`, `cadence_slot_config`, `gate_config`,
`gate_state`, `disparos_log`, `disparadores_whatsapp` (n8n), `fila_humana`, `event_log`,
`system_state`. Adimplentes/relacionamento: `adimplentes_base`, `adimplentes_import_log`.
Sync de planilha: `spreadsheet_sync_log`, `sync_snapshots`, `cobranca_clientes_removidos`,
`data_freshness_log`.

### 3. Pagamentos (links, gateways, conciliação)
`pagamentos`, `links_pagamentos_gerados`, `pagamentos_orfaos`, `payment_gateway_configs`,
`payouts`, `payout_pagamentos`, `webhook_events_log`, `faturamento_baixas`,
`log_limpeza_links`. Gateways: Woovi/OpenPix, Stripe, AbacatePay.

### 4. WABA-health (saúde de WhatsApp / Strategic Swarm)
`waba_health`, `waba_capability`, `waba_violations`, `phone_health`,
`template_inventory`, `template_status_log`, `template_master`, `blacklist_global`,
`message_log` (auditoria de envio, 260k linhas, n8n), `message_inbound`.

### 5. Auth / tenant
`units` (= tenant), `profiles` (= operador), `user_units`, `user_roles`,
`user_unit_permissions`, `agents`. Enum `app_role` e `permission_type`
(`raw/bloco-08-enums.json`).

### 6. Infra / config / outros
`webhook_configs`, `app_internal_config`, `sales_leads`, `todos`.

### Tabelas Morta / Backup (candidatas a remoção)
`cobranca_sync_backup` (RLS off, 0 live tup), `agents_bak_20260601_precancel`,
`agents_bak_20260601_prerename` (backups manuais datados), `template_master` (0 rows, sem
RLS), `sync_snapshots`/`spreadsheet_sync_log` com 0 live tup no snapshot. Fonte:
`raw/bloco-01-tabelas.json` (campos `n_live_tup`, `rls_on`, `comentario`).

---

## Mapa de alto nível do fluxo (lineage)

Fontes: `functions-analysis.json`, `edge-functions.json`, `n8n-workflows.json`,
`raw/bloco-11-cron.json`.

### A) Planilha (Google Drive) → base de cobrança
```
Franquia sobe XLSX no Drive (1 pasta/unidade)
  → n8n "Sync Planilha Power BI v3 (Robusto)" (9 triggers Drive, poll ~15min)
  → valida data + converte XLSX→Sheets
  → RPC sync_cobranca_v2(...)  [transacional, com foto pré-sync reversível]
       ├─ upsert clientes_cobranca_setembro  (base canônica)
       ├─ upsert clientes_cobranca_dashboard (duplicata)
       ├─ insert cobranca_clientes_removidos (saídas: pagou / sumiu da planilha)
       ├─ insert cobranca_sync_backup        (backup reversível)
       └─ upsert sync_snapshots + log em spreadsheet_sync_log
```
Adimplentes (relacionamento) seguem trilho análogo via n8n
"Sync Adimplentes - Relacionamento (Motor v2)" → tabela `adimplentes_base`.

### B) Motor v2 (cadência diária → disparos)
```
pg_cron motor-v2-planejador-daily (11:50 UTC ≈ 08:50 BRT, seg-sex)
  → motor_v2_invoke_edge('motor-v2-planejador')  [pg_net + segredo do vault]
  → Edge motor-v2-planejador:
       sincroniza cliente_cadencia ← clientes_cobranca_setembro
       aplica gate de réguas (gate_config/gate_state)
       pré-popula disparos_log com mensagens PROGRAMADA por slot/unidade
  → n8n "DISPAROS MOTOR V2 - TT" (4 horários/dia útil)
       → RPC motor_v2_get_disparos(slot) → envia WhatsApp via Meta
pg_cron motor-v2-fechamento-daily (02:00 UTC, ter-sáb)
  → Edge motor-v2-fechamento: reconcilia pagamentos noturnos,
    avança dia_ciclo (+1), finaliza dia-22 → fila_humana
pg_cron motor-v2-sortear-relacionamento-daily (14:45 UTC, seg-sex)
```

### C) Webhooks de pagamento → register_payment
```
Gateway (Woovi/OpenPix | Stripe | AbacatePay) → POST webhook
  → Edge woovi-webhook / stripe-webhook / abacate-webhook
       valida HMAC, grava webhook_events_log
       → RPC register_payment(correlation_id, ...)  [idempotente, upsert]
            ├─ upsert pagamentos
            ├─ marca pagamento_feito em clientes_cobranca_setembro/_dashboard
            └─ status='paid' em links_pagamentos_gerados
       refund → mark_refund_by_correlation; sem link → resolve_orfao_matricula / pagamentos_orfaos
Conciliação noturna: pg_cron reconcile-{woovi,stripe,abacate}-daily
  → call_reconcile_function('reconcile-*-pull', 48) → Edge reconcile-*-pull
Geração de link: Edge generate-payment-link[-abacate] → RPC upsert_payment_link
```

### D) n8n ↔ CHAT-CDT (handoff IA → humano)
```
Inbound WhatsApp (Meta → fila RabbitMQ) → n8n
  "CDT Cobrança - Tatuapé" / "CDT Relacionamento" / workflow "RabbitMQ"
  → IA (agente "Rafa"/"Isa") responde e:
     ├─ Edge agent-tools (x-api-key): RPCs agent_block_customer / agent_pause_customer,
     │   action=transfer_human (routing='queued') ou gate ai_may_send
     └─ RPC chat_record_outbound_message(...) → upsert contacts + conversations + messages
  → trigger chat_notify_handoff (em routing='queued')
       → pg_net POST {app_origin}/api/internal/push/notify  (no-op se GUC vazio)
  → Realtime empurra conversations/messages para a UI do CHAT-CDT
```

---

## Falhas / armadilhas de extração registradas

- **`raw/bloco-14-db-webhooks.json`:** a query original falhou com `42703`
  (`supabase_functions.hooks` **não tem coluna `type`** — colunas reais: `id`,
  `hook_table_id`, `hook_name`, `created_at`, `request_id`). **Corrigido** por agregação
  por `hook_name` via `execute_sql` read-only (2026-06-02). Resultado registrado no JSON.
- **Cron / Policies:** ver "Discrepâncias com o brief" acima (10 vs 11 cron; 64 vs 65
  policies) — ambas reconciliadas como recorte de extração, não erro de dados.
- **Janela de stats:** `pg_stat_user_tables` (bloco-01) e `pg_stat_statements`
  (bloco-10) têm resets independentes; só o segundo tem timestamp (~13h).

---

## Top achados (1 linha cada)

- **DB webhook descontrolado:** o hook antigo `\tcancel-links-on-regua-valor-update`
  acumulou **3.962.003 invocações** (per-row em updates em massa de `regua_valor`) antes de
  ser substituído por trigger em 2026-05-27. Fonte: `raw/bloco-14-db-webhooks.json`.
- **Duplicata de 1,8 GB:** `clientes_cobranca_dashboard` (95,7k linhas, 1793 MB) é "a
  duplicate of `clientes_cobranca_setembro`" pelo próprio comentário. Fonte:
  `raw/bloco-01-tabelas.json`.
- **Hot path de RLS com seq_scan extremo:** `user_roles` (~90,6M seq_scan, `idx_scan:0`) e
  `user_units` (~1,22M seq_scan, `idx_scan:0`) — varredura sequencial dos helpers de RLS
  (janela do contador desconhecida). Fonte: `raw/bloco-01-tabelas.json`.
- **`message_log` é a maior por volume:** 259,7k linhas (291 MB), auditoria 1-a-1 de cada
  envio do Send Executor com `UNIQUE(wamid)`. Fonte: `raw/bloco-01-tabelas.json`.
- **Cron `limpeza-links-pagamento` com histórico ruim:** 264 execuções, **127 falhas**
  (última succeeded). Fonte: `raw/bloco-11-cron.json`.
- **Tabelas backup/morta a limpar:** `agents_bak_20260601_*` (2 backups datados),
  `cobranca_sync_backup` e `template_master` (RLS off, 0 live tup). Fonte:
  `raw/bloco-01-tabelas.json`.
- **Realtime exposto em tabelas de cobrança:** `clientes_cobranca_dashboard`,
  `clientes_cobranca_setembro`, `pagamentos`, `links_pagamentos_gerados` estão na
  publicação `supabase_realtime`. Fonte: `raw/bloco-12-realtime.json`.
- **`register_payment` é o ponto de convergência de pagamentos:** chamado pelos 3 webhooks
  de gateway, idempotente por `correlation_id`, escreve em 4 tabelas. Fonte:
  `functions-analysis.json` + `edge-functions.json`.
