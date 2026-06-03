# 05 — Triggers e Database Webhooks (27 triggers)

> **Fontes.** Definição de cada trigger (tabela, timing, evento, nível, `WHEN`, `UPDATE OF`, função handler): `analise-cdt/raw/bloco-06-triggers.json`. O **EFEITO** de cada handler vem do cruzamento com `analise-cdt/raw/functions-analysis.json` (campos `purpose`, `reads`, `writes`, `calls_rpcs`, `external`). Os dois **Database Webhooks** e suas contagens de invocação: `analise-cdt/raw/bloco-14-db-webhooks.json` (agregado de `supabase_functions.hooks`). As edge functions invocadas (`cancel-payment-links`, `notify-orphan-email`): `analise-cdt/raw/edge-functions.json`.
>
> **Como ler o EFEITO.** Vários handlers são genéricos (`TG_TABLE_NAME`/`TG_OP`) e o `functions-analysis.json` marca "tabela alvo não inferível". O EFEITO abaixo **concretiza** esses handlers usando a tabela real fornecida pela definição do trigger — esse é o ponto do cruzamento.
>
> **Legenda.** `†` = lineage **inferido** (`confidence:"inferido"` no `functions-analysis.json`); sem marca = `confirmado`. `⇪` = efeito externo (HTTP via `pg_net`/`net.http_post` ou `supabase_functions.http_request`). **secdef** do handler: **S** = `SECURITY DEFINER`, **I** = `SECURITY INVOKER`. Todos os 27 triggers estão `enabled` e são `FOR EACH ROW` (nível `ROW`).

---

## Visão geral (27 triggers)

| domínio | nº | observação |
|---|:--:|---|
| **CHAT-CDT (`trg_chat_*`)** | 4 | ciclo de atendimento/handoff em `conversations` (3) + janela 24h em `messages` (1) |
| Motor de cobrança v2 (`trg_motor_v2_*`) | 4 | bloqueio de cliente (1) + recálculo de gate por saúde (3) |
| Cobrança — pagamento/links/sync | 6 | guards de pagamento recente, cancelamento de links, sync de disparo, espelho setembro→dashboard, **1 Database Webhook ⇪** |
| Auditoria genérica (`trg_log_event_changes`) | 4 | grava before/after em `event_log` para 4 tabelas |
| `updated_at` genérico (`update_updated_at_column`) | 7 | carimba `NEW.updated_at = now()` em 7 tabelas |
| Outros (set_user_tracking, orphan email ⇪) | 2 | tracking de autor (1) + e-mail de órfão via edge (1) |
| **Total** | **27** | |

Handlers reutilizados (1 função, N triggers): `update_updated_at_column` ×7, `trg_log_event_changes` ×4, `trg_motor_v2_recalc_gate_from_health` ×3. Cada trigger é uma linha própria abaixo, porque a tabela concreta — e portanto o EFEITO — muda.

---

## 1. CHAT-CDT — `trg_chat_*` (4) — **nossos triggers**

Estes são os triggers do CHAT-CDT (handoff humano). Os três de `conversations` orquestram o ciclo de atendimento coordenado por `routing` (`ai`/`queued`/`human`); o de `messages` mantém a janela de 24h da Meta.

| trigger | tabela | timing / evento | `WHEN` / `UPDATE OF` | handler (secdef) | EFEITO |
|---|---|---|---|---|---|
| `trg_chat_stamp_transition` | `conversations` | **BEFORE** UPDATE | `WHEN routing OR status OR assigned_operator_id mudou` | `chat_stamp_conversation_transition` (**I**) | Carimba na própria linha (muta `NEW`): `queued_at` quando `routing→'queued'`, `assigned_at` quando `assigned_operator_id` vira não-nulo, `closed_at` quando `status→'closed'`. Não faz DML — só prepara a linha antes do AFTER. *(handler é o único do lote sem `SECURITY DEFINER` e sem `search_path` fixo)*. |
| `trg_chat_log_transition` | `conversations` | **AFTER** UPDATE | `WHEN routing OR status OR assigned_operator_id mudou` | `chat_log_conversation_transition` (**S**) | Registra o evento do ciclo (`queued`, `returned_to_ai`, `assigned`/`reassigned`, `closed`) → **INSERT em `chat_conversation_events`** (`from/to_routing`, `from/to_status`, `outcome`, `note`, `actor_id` via `auth.uid()`). É a trilha de auditoria do atendimento humano. |
| `trg_chat_notify_handoff` | `conversations` | **AFTER** UPDATE **OF `routing`** | (sem `WHEN`; filtra no corpo: `routing` virou `'queued'`) | `chat_notify_handoff` (**S**) | ⇪ Ao entrar em `routing='queued'`, lê `app_origin`/`cron_secret` de **`chat_config`** e faz **`net.http_post` (pg_net)** assíncrono para `origin \|\| '/api/internal/push/notify'` — dispara o push fanout. **No-op se `app_origin` vazio** (coerente com a GUC ausente descrita no CLAUDE.md). |
| `trg_chat_bump_window` | `messages` | **AFTER** INSERT | (sem `WHEN`; filtra `NEW.direction='in'`) | `chat_bump_conversation_window` (**I**) | Ao chegar mensagem **inbound**, **UPDATE em `conversations`** (`last_inbound_at`, `customer_window_expires_at`) — renova a janela de 24h da Meta automaticamente. |

---

## 2. Motor de cobrança v2 — `trg_motor_v2_*` (4)

| trigger | tabela | timing / evento | `WHEN` / `UPDATE OF` | handler (secdef) | EFEITO |
|---|---|---|---|---|---|
| `trg_motor_v2_bloqueio_cliente` | `clientes_cobranca_setembro` *(n8n)* | **AFTER** UPDATE **OF `bloqueio_disparos`, `disparos_pausados_ate`** | `WHEN bloqueio_disparos OR disparos_pausados_ate mudou` | `trg_motor_v2_bloqueio_cliente` (**S**) | Ao bloquear/pausar um cliente: chama RPC `motor_v2_cancel_future_disparos()` (cancela disparos PROGRAMADOS), **UPDATE `cliente_cadencia`** (status→pausado, `paused_at`/`paused_reason`), **INSERT `fila_humana`** (abre item p/ atendente, lendo `fila_humana` p/ evitar duplicata aberta) e **INSERT `event_log`**. |
| `trg_motor_v2_gate_from_phone_health` | `phone_health` | **AFTER** INSERT | — | `trg_motor_v2_recalc_gate_from_health` (**S**) | Ao registrar nova saúde de número, recalcula o gate da unidade: chama RPC `motor_v2_recalc_gate()` (upsert em `gate_state`). Falha não derruba o INSERT de origem (registra em `event_log` só no bloco EXCEPTION). |
| `trg_motor_v2_gate_from_waba_health` | `waba_health` | **AFTER** INSERT | — | `trg_motor_v2_recalc_gate_from_health` (**S**) | Idem acima, disparado por nova linha de saúde da WABA → recalcula gate via `motor_v2_recalc_gate()`. |
| `trg_motor_v2_gate_from_waba_violations` | `waba_violations` | **AFTER** INSERT | — | `trg_motor_v2_recalc_gate_from_health` (**S**) | Idem, disparado por nova violação de WABA → recalcula gate via `motor_v2_recalc_gate()`. Os três compartilham o mesmo handler genérico (lê `NEW.unit_id`). |

---

## 3. Cobrança — pagamento, links e sync (6, inclui **1 Database Webhook ⇪**)

| trigger | tabela | timing / evento | `WHEN` / `UPDATE OF` | handler (secdef) | EFEITO |
|---|---|---|---|---|---|
| `trg_guard_recent_payment_dashboard` | `clientes_cobranca_dashboard` *(n8n)* | **BEFORE** INSERT/UPDATE | — | `guard_recent_payment_dashboard` (**S**) | Antes de gravar a linha de cobrança, procura pagamento recente (<48h, não reembolsado) em **`pagamentos`** pela matrícula; se achar, marca a linha como paga (muta `NEW`: `pagamento_feito`, `data_pagamento`, `plataforma_pagamento_utilizada`†, `correlation_id`†). Evita cobrar quem já pagou. |
| `trg_guard_recent_payment_setembro` | `clientes_cobranca_setembro` *(n8n)* | **BEFORE** INSERT/UPDATE | — | `guard_recent_payment_setembro` (**S**) | Igual ao guard do dashboard, mas em `setembro` e **sem** propagar `correlation_id` (muta `NEW`: `pagamento_feito`, `data_pagamento`, `plataforma_pagamento_utilizada`†). Lê `pagamentos`. |
| `trg_cancel_pending_links_on_payment` | `clientes_cobranca_dashboard` *(n8n)* | **AFTER** UPDATE **OF `pagamento_feito`** | `WHEN new.pagamento_feito=true AND (old IS NULL OR old=false)` | `cancel_pending_links_on_payment` (**S**) | **(caminho A — SQL puro, sem edge)** Na transição `pagamento_feito false→true`, lê `pagamentos`/`links_pagamentos_gerados` por `correlation_id` e **UPDATE `links_pagamentos_gerados`** (`status='cancelled'`, `cancelado_at`) p/ os links pendentes daquela matrícula que ainda não têm pagamento associado. |
| `cancel_links_on_regua_valor_update` ⇪ **(DB Webhook)** | `clientes_cobranca_setembro` *(n8n)* | **AFTER** UPDATE **OF `regua`, `valor_inadimplente`** | `WHEN old.regua IS DISTINCT FROM new.regua OR old.valor_inadimplente IS DISTINCT FROM new.valor_inadimplente` | `supabase_functions.http_request` *(dispatcher embutido; **não está no `functions-analysis.json`**)* | **(caminho B — edge function)** ⇪ Faz `POST` p/ `…/functions/v1/cancel-payment-links` (timeout 5000 ms). A **edge `cancel-payment-links`** cancela os links ativos da matrícula nos gateways: **PIX/Woovi (OpenPix)** e **cartão (Stripe)**, lendo `payment_gateway_configs` (credenciais por franquia) e atualizando `links_pagamentos_gerados`. **Ver bloco "Database Webhooks" abaixo** — disparou ~3,96 **milhões** de vezes sob o nome antigo. |
| `mirror_disparo_fields` | `clientes_cobranca_setembro` *(n8n)* | **AFTER** UPDATE | `WHEN` com **~18 colunas** mudaram (ver abaixo) | `mirror_disparo_fields_to_dashboard` (**S**) | **Espelha setembro → dashboard.** Quando qualquer campo de disparo/cadência (Strategic Swarm) muda, **UPDATE `clientes_cobranca_dashboard` WHERE matricula=NEW.matricula** copiando os ~18 campos: `disparos`, `disparos_equipe`, `"disparado com sucesso"`, `data_ultimo_disparo`, `status`, e todo o bloco `cadence_*` (`fase`, `dia_ciclo`, `slot`, `variante`, `proximo_envio_at`, `ultimo_template`, `branch_state`, `entrou_em`), `regua_at_entry`, `last_inbound_at`, `slots_enviados_hoje(_data)`, `last_resgate_ia_at`, `updated_at`. O `WHEN` enorme existe para o trigger só rodar quando algum desses campos efetivamente mudou. |
| `trg_sync_data_ultimo_disparo` | `message_log` *(n8n)* | **AFTER** INSERT | — | `sync_data_ultimo_disparo_from_message_log` (**S**) | Ao registrar um disparo em `message_log`, propaga `data_ultimo_disparo` (BRT, idempotente — só se nulo ou mais antigo) por matrícula para **`clientes_cobranca_setembro`** e **`clientes_cobranca_dashboard`** (`NEW.sent_at`/`NEW.matricula` lidos via NEW†). |

**`WHEN` de `mirror_disparo_fields` (literal, ~18 colunas):** `disparos`, `disparos_equipe`, `"disparado com sucesso"`, `data_ultimo_disparo`, `status`, `cadence_fase`, `cadence_dia_ciclo`, `cadence_slot`, `cadence_variante`, `cadence_proximo_envio_at`, `cadence_ultimo_template`, `cadence_branch_state`, `cadence_entrou_em`, `regua_at_entry`, `last_inbound_at`, `slots_enviados_hoje`, `slots_enviados_hoje_data`, `last_resgate_ia_at` — cada uma comparada com `IS DISTINCT FROM`.

---

## 4. Auditoria genérica — `trg_log_event_changes` (4)

Mesmo handler `trg_log_event_changes` (**S**, `search_path public`), **AFTER INSERT/DELETE/UPDATE**, sem `WHEN`. Usa `TG_TABLE_NAME`/`TG_OP`/`TG_NAME` e grava **INSERT em `event_log`** com `to_jsonb(OLD)`/`to_jsonb(NEW)` em `before_data`/`after_data` e o ator a partir de GUCs de sessão (`app.actor_*`). O EFEITO concreto de cada um é "auditar mutações da sua tabela":

| trigger | tabela auditada | EFEITO |
|---|---|---|
| `trg_event_log_cliente_cadencia` | `cliente_cadencia` | Audita toda INSERT/DELETE/UPDATE de cadência → before/after em `event_log`. |
| `trg_event_log_disparos_log` | `disparos_log` | Audita mutações no log de disparos → `event_log`. |
| `trg_event_log_fila_humana` | `fila_humana` | Audita mutações na fila humana (abertura/resolução) → `event_log`. |
| `trg_event_log_gate_state` | `gate_state` | Audita mudanças de estado do gate de saúde → `event_log`. |

---

## 5. `updated_at` genérico — `update_updated_at_column` (7)

Mesmo handler `update_updated_at_column` (**I**, sem `search_path`), **BEFORE UPDATE**, sem `WHEN`. Apenas muta `NEW.updated_at = now()` — **não faz DML, não lê/escreve tabelas**. EFEITO idêntico em todas: manter `updated_at` correto na própria linha.

| trigger | tabela |
|---|---|
| `update_links_pagamentos_gerados_updated_at` | `links_pagamentos_gerados` |
| `update_pagamentos_updated_at` | `pagamentos` |
| `update_profiles_updated_at` | `profiles` |
| `update_sales_leads_updated_at` | `sales_leads` |
| `update_units_updated_at` | `units` |
| `update_user_unit_permissions_updated_at` | `user_unit_permissions` |
| `update_webhook_configs_updated_at` | `webhook_configs` |

---

## 6. Outros (2)

| trigger | tabela | timing / evento | `WHEN` / `UPDATE OF` | handler (secdef) | EFEITO |
|---|---|---|---|---|---|
| `set_user_tracking_trigger` | `clientes_cobranca_dashboard` *(n8n)* | **BEFORE** INSERT/UPDATE | — | `set_user_tracking` (**S**) | Preenche `created_by`/`updated_by`/`updated_at` com `auth.uid()` na linha (muta `NEW`). Não faz DML. |
| `trg_orphan_email` ⇪ | `pagamentos_orfaos` | **AFTER** INSERT | — | `notify_orphan_payment_created` (**S**) | ⇪ Ao criar um pagamento órfão, lê `NOTIFY_ORPHAN_INTERNAL_KEY` de `app_internal_config` e faz **`net.http_post`** (best-effort, `EXCEPTION WHEN OTHERS → WARNING`) para a edge **`notify-orphan-email`**, que envia e-mail de alerta via SMTP (modo agregado anti-spam por burst). Falha não bloqueia o INSERT. |

---

## Database Webhooks (`supabase_functions.hooks`) — ⇪ alto volume

Um único trigger do tipo Database Webhook (`supabase_functions.http_request`) está ativo: **`cancel_links_on_regua_valor_update`** (seção 3, caminho B). O registro de invocações em `supabase_functions.hooks` mostra **dois nomes** ao longo do tempo (`bloco-14-db-webhooks.json`):

| nome do hook | invocações | primeiro | último | observação |
|---|---:|---|---|---|
| `\tcancel-links-on-regua-valor-update` *(nome **antigo**, com `\t` literal no início)* | **3.962.003** (~3,96 **milhões**) | 2026-02-22 | 2026-05-26 | Substituído em 2026-05-27. Volume gigantesco em ~3 meses = sinal de disparo **per-row em updates em massa** de `clientes_cobranca_*`. |
| `cancel_links_on_regua_valor_update` *(nome **atual**)* | **5.304** | 2026-05-27 | 2026-06-01 | Trigger atual `AFTER UPDATE OF regua, valor_inadimplente` → `http_request` → edge `cancel-payment-links`. |

**Notas (honestidade de fonte):**
- A definição **autoritativa** do trigger (em `bloco-06-triggers.json`) é `AFTER UPDATE OF regua, valor_inadimplente` com `WHEN (old.regua IS DISTINCT FROM new.regua OR old.valor_inadimplente IS DISTINCT FROM new.valor_inadimplente)`. O campo `_obs` do `bloco-14` chama isso informalmente de "coluna regua_valor" — terminologia frouxa do _obs, não duas colunas distintas.
- A queda de ~3,96 M → 5.304 invocações coincide com a migração do nome antigo (sem `WHEN` guard aparente) para o trigger atual com `WHEN ... IS DISTINCT FROM`. **Atribuir a queda à cláusula `WHEN` é inferência†** — os logs comprovam os **números** e as **datas**, não a **causa**. (O nome antigo com `\t` inicial e o padrão per-row sugerem que rodava em todo UPDATE da varredura em massa, sem o guard de mudança real de valor.)
- A edge `cancel-payment-links` tem `verify_jwt:false` e cancela links PIX/Woovi (OpenPix) e cartão (Stripe) por unidade via `payment_gateway_configs` (`edge-functions.json`).
