# 06 — Edge Functions (20 funções)

> **Fontes.** Campo a campo de cada função (slug, `trigger_kind`, `verify_jwt`, finalidade, tabelas com ops/colunas/confiança, RPCs, `external_services`, `calls[]` com URLs literais, `secrets`, notas de segurança): `analise-cdt/raw/edge-functions.json` (20 entradas, lidas via `get_edge_function` em modo read-only). **Schedules de cron**: `analise-cdt/raw/bloco-11-cron.json` (`cron.job`). **Database Webhook** de `cancel-payment-links`: `analise-cdt/raw/bloco-14-db-webhooks.json` (`supabase_functions.hooks`). RPCs citadas são detalhadas em `03-funcoes.md`; tabelas em `02-tabelas/`.
>
> **Domínio.** Apenas **2 das 20** tocam tabelas do CHAT-CDT (`agent-tools` → `contacts`/`conversations`; `create-admin-users` → `profiles`/`user_roles`/`units`). As outras 18 operam sobre o ecossistema **n8n / cobrança / motor v2** (`pagamentos`, `links_pagamentos_gerados`, `clientes_cobranca_*`, `payment_gateway_configs`, `disparos_log`, `cliente_cadencia`, etc). **Todas usam `SUPABASE_SERVICE_ROLE_KEY`** (bypassam RLS); o controle de acesso real é feito **no código**, não pela plataforma (ver nota de segurança abaixo).
>
> **Legenda.** `gatilho`: `http-invoked` = endpoint POST/GET chamado pelo app/n8n; `http-webhook` = callback de provedor externo (gateway de pagamento); `cron` = uso primário via `pg_cron`+`pg_net` (também invocável manualmente). `jwt`: valor do flag `verify_jwt` no deploy da function. `ops`: `select`/`insert`/`update`/`upsert`/`delete`/`count`/`trigger-source` (lida do payload do Database Webhook, **não** via `.from()`). `conf` (confiança do lineage): **C** = confirmado (coluna aparece literalmente no código); **†** = inferido. `⇪` = chamada HTTP a serviço externo.

## Sumário e destaques

| # | slug | gatilho | jwt | sub-sistema |
|---|---|---|:--:|---|
| 1 | `generate-payment-link` | http-invoked | false | A. Geração e ciclo de vida de links |
| 2 | `generate-payment-link-abacate` | http-invoked | false | A. Geração e ciclo de vida de links |
| 3 | `cancel-payment-links` | http-invoked *(Database Webhook)* | false | A. Geração e ciclo de vida de links |
| 4 | `woovi-webhook` | http-webhook | false | B. Webhooks de provedor |
| 5 | `stripe-webhook` | http-webhook | false | B. Webhooks de provedor |
| 6 | `abacate-webhook` | http-webhook | false | B. Webhooks de provedor |
| 7 | `reconcile-woovi-pull` | cron | false | C. Reconcile cron |
| 8 | `reconcile-stripe-pull` | cron | false | C. Reconcile cron |
| 9 | `reconcile-abacate-pull` | cron | false | C. Reconcile cron |
| 10 | `motor-v2-planejador` | cron | false | D. Motor v2 |
| 11 | `motor-v2-sortear-relacionamento` | cron | false | D. Motor v2 |
| 12 | `motor-v2-fechamento` | cron | false | D. Motor v2 |
| 13 | `process-reembolso` | http-invoked | **true** | E. Estornos e payouts |
| 14 | `process-payouts` | cron | **true** | E. Estornos e payouts |
| 15 | `create-admin-users` | http-invoked | false | F. Chat / admin |
| 16 | `agent-tools` | http-invoked | false | F. Chat / admin |
| 17 | `sentinel-generate-variation` | http-invoked | false | G. Templates WhatsApp (Sentinel) |
| 18 | `sentinel-submit-template` | http-invoked | false | G. Templates WhatsApp (Sentinel) |
| 19 | `list-client-debts` | http-invoked | false | H. Suporte app/n8n (consulta + alertas) |
| 20 | `notify-orphan-email` | http-invoked | false | H. Suporte app/n8n (consulta + alertas) |

**Contagem de gatilhos:** 10 `http-invoked` · 3 `http-webhook` · 7 `cron` (= 20). Confere com `edge-functions.json`.

> ### ⚠️ DESTAQUES DE SEGURANÇA
>
> 1. **Só 2 das 20 têm `verify_jwt=true`: `process-reembolso` e `process-payouts`.** As outras 18 rodam com `verify_jwt=false` no nível da plataforma. **Isso NÃO significa "sem autenticação"** — quase todas fazem checagem própria no código (`x-api-key`/`INTERNAL_API_KEY`, `x-internal-key`, `x-agent-tools-secret`, ou assinatura HMAC de provedor). Ver coluna "auth no código" em cada ficha. E mesmo as 2 com `jwt=true` usam `SERVICE_ROLE_KEY` internamente e fazem o controle de papel manualmente.
>
> 2. **`create-admin-users` é o endpoint genuinamente exposto.** `verify_jwt=false` **E sem nenhuma autenticação no código** + usa `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS) + **senha temporária hardcoded `TempPassword123!`** + emails admin hardcoded (`victor@7bee.com`, `andre@7bee.com`) + CORS `*`. Cria/garante contas admin de forma idempotente. Deveria exigir JWT/secret. Fonte: `edge-functions.json[0].notes`.
>
> 3. **`cancel-payment-links` é disparada por Database Webhook, não por um provedor.** O `trigger_kind` é `http-invoked` porque ela **chama** os provedores externos (OpenPix/Stripe) — não recebe callback deles. Quem a dispara é o Database Webhook **`cancel_links_on_regua_valor_update`** (`AFTER UPDATE OF regua_valor ON clientes_cobranca_setembro` → `supabase_functions.http_request`), via `pg_net`. Nome antigo `\tcancel-links-on-regua-valor-update` acumulou **~3,96 milhões de invocações** em ~3 meses (disparo per-row em updates em massa) e foi substituído em 2026-05-27. Fonte: `bloco-14-db-webhooks.json`.
>
> 4. **Webhooks fail-open:** `woovi-webhook` e `abacate-webhook` **pulam a validação de assinatura HMAC se o secret não estiver configurado** (aceitam o evento com warning). `stripe-webhook` valida sempre (HMAC-SHA256 + tolerância 5min). Fonte: `notes` de cada função.

---

## A. Geração e ciclo de vida de links de pagamento (3)

### A.1 `generate-payment-link` — gera/reutiliza link PIX (Woovi) ou cartão (Stripe)

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **auth no código** | Bearer token (`supabase.auth.getUser`) **OU** `x-api-key == INTERNAL_API_KEY` (caminho da IA do n8n). `SERVICE_ROLE_KEY`. |
| **finalidade** | Gera (ou reutiliza com *smart reuse*) link PIX/Woovi ou Stripe para uma matrícula inadimplente: valida valor/régua, persiste o link e atualiza as tabelas de cobrança. |
| **RPCs** | `upsert_payment_link` (`p_correlation_id, p_matricula, p_whatsapp, p_link, p_unit_id, p_plataforma, p_data_link, p_gateway_charge_id`) |
| **serviços externos** | ⇪ Woovi/OpenPix (`POST /api/v1/charge`); ⇪ Stripe (`POST /v1/products`, `/v1/prices`, `/v1/payment_links`) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_API_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `units` | select | `id, code, name` | C |
| `clientes_cobranca_setembro` | select, update | `whatsapp, regua, name, valor_inadimplente, matricula, link_pagamento_enviado, link_pagamento, correlation_id, unit_id, plataforma_pagamento_utilizada, hora_link_gerado` | C |
| `pagamentos` | select | `id, data_pagamento, matricula, reembolso_realizado` | C |
| `links_pagamentos_gerados` | select, update | `id, correlation_id, link_pagamento, created_at, data_link_gerado, expires_at, valor, regua, matricula, unit_id, plataforma_pagamento_utilizada, cancelado_at` | C |
| `clientes_cobranca_dashboard` | update | `matricula, link_pagamento_enviado, link_pagamento, correlation_id, plataforma_pagamento_utilizada, hora_link_gerado` | C |
| `payment_gateway_configs` | select | `api_key, unit_id, platform, is_active` | C |
| `webhook_events_log` | insert | `source, event_type, correlation_id, unit_code, payload, processed, error` | C |

**Notas.** *Smart reuse*: reaproveita link ativo não expirado se valor e régua iguais; senão cancela (`cancelado_at`) e gera novo. Guard de **48h** contra pagamento recente (HTTP 409) e guard de **30 dias** para não sobrescrever `correlation_id` real. Credenciais Woovi/Stripe vêm de `payment_gateway_configs.api_key` por unidade — **não de `Deno.env`**. `webhook_events_log` só registra falha de criação de cobrança (`CHARGE_CREATE_FAILED`).

### A.2 `generate-payment-link-abacate` — gera link PIX via Abacate Pay

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **auth no código** | `x-api-key == INTERNAL_API_KEY` **OU** Bearer (`auth.getUser`). **Kill switch `ABACATE_ENABLED=true`** obrigatório (senão 503). `SERVICE_ROLE_KEY`. |
| **finalidade** | Função dedicada à geração de links PIX no Abacate Pay (separada da A.1): valida unidade/cliente, *smart-reuse* cross-gateway ou cria nova cobrança, persiste e retorna a **URL do checkout CDT** (`CHECKOUT_BASE_URL/pay/<correlation_id>`), não o brCode bruto. |
| **RPCs** | `upsert_payment_link` |
| **serviços externos** | ⇪ Abacate (`POST https://api.abacatepay.com/v1/pixQrCode/create`, Bearer = `api_key` resolvida em `payment_gateway_configs`) |
| **secrets** | `CHECKOUT_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ABACATE_ENABLED`, `INTERNAL_API_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `units` | select | `id, code, name` | C |
| `clientes_cobranca_setembro` | select, update | `matricula, whatsapp, regua, name, valor_inadimplente, link_pagamento_enviado, link_pagamento, correlation_id, unit_id, plataforma_pagamento_utilizada, hora_link_gerado` | C |
| `clientes_cobranca_dashboard` | select, update | `matricula, pagamento_feito, link_pagamento_enviado, link_pagamento, correlation_id, plataforma_pagamento_utilizada, hora_link_gerado` | C |
| `payment_gateway_configs` | select | `api_key, unit_id, platform, is_active` | C |
| `links_pagamentos_gerados` | select, update | `id, correlation_id, link_pagamento, data_link_gerado, expires_at, valor, regua, pix_gateway, matricula, unit_id, plataforma_pagamento_utilizada, cancelado_at, created_at, pix_copia_cola` | C |
| `webhook_events_log` | insert | `source, event_type, correlation_id, unit_code, payload, processed, error` | C |
| `pagamentos` | select | `id, matricula, data_pagamento, reembolso_realizado` | C |

**Notas.** Todas as colunas são nomeadas literalmente (sem `select('*')`) → **confiança confirmada nas 7 tabelas**. Persist fail retorna **502** (não 207) para o n8n não disparar WhatsApp com link órfão. `brCode` persistido em `links_pagamentos_gerados.pix_copia_cola`. Falhas em `webhook_events_log` (`CHARGE_CREATE_FAILED` / `UPSERT_PAYMENT_LINK_FAILED`).

### A.3 `cancel-payment-links` — cancela links ativos quando régua/valor muda (Database Webhook)

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` — **disparada por Database Webhook**, não por provedor (ver destaque #3) |
| **disparador** | DB Webhook `cancel_links_on_regua_valor_update` (`AFTER UPDATE OF regua_valor ON clientes_cobranca_setembro` → `supabase_functions.http_request`/`pg_net`). Fonte: `bloco-14-db-webhooks.json` |
| **auth no código** | Valida `payload.type==='UPDATE'` com `old_record`/`record`. Sem secret próprio (confia na origem interna do DB Webhook). `SERVICE_ROLE_KEY`. |
| **finalidade** | Quando `regua` ou `valor_inadimplente` muda numa matrícula, cancela os links ativos (PIX/Woovi via OpenPix e cartão via Stripe) daquela matrícula usando as credenciais da franquia. |
| **RPCs** | — |
| **serviços externos** | ⇪ Woovi/OpenPix (`DELETE /api/v1/charge/{correlation_id}`); ⇪ Stripe (`GET /v1/payment_links?active=true`, `POST /v1/payment_links/{id}` com `active=false`) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `clientes_cobranca_setembro` | **trigger-source** | `regua, valor_inadimplente, matricula, unit_id` | C |
| `payment_gateway_configs` | select | `platform, api_key, unit_id, is_active` | C |
| `links_pagamentos_gerados` | select, update | `id, correlation_id, matricula, status, cancelado_at, plataforma_pagamento_utilizada` | C |

**Notas.** `clientes_cobranca_setembro` **não é consultada via `.from()`** — suas colunas vêm do payload do DB Webhook (`old_record`/`record`). Stripe filtra payment links localmente por `metadata['Matricula'/'Matrícula']` (não usa `links_pagamentos_gerados`). Credenciais vêm de `payment_gateway_configs.api_key` (não `Deno.env`). Erros de provedor são logados e **não abortam** o fluxo; retorna contadores `woovi_cancelled`/`stripe_cancelled`.

---

## B. Webhooks de provedor de pagamento (3)

> As 3 são endpoints públicos (`http-webhook`, `verify_jwt=false`) chamados pelo gateway. Padrão comum: gravam o evento em `webhook_events_log` **antes** de validar a assinatura (defesa em profundidade), e **quase sempre retornam HTTP 200** mesmo em erro para evitar loop de reenvio (exceções: 400 JSON inválido, 401 assinatura inválida). Idempotência via RPC `register_payment` (`already_existed`) e `upsert onConflict (source, gateway_correlation_id)` em `pagamentos_orfaos`.

### B.1 `woovi-webhook` — pagamentos PIX Woovi/OpenPix

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-webhook` · `false` |
| **auth no código** | HMAC-SHA1 (base64) no header `x-openpix-signature` vs `WOOVI_WEBHOOK_SECRET`. **Fail-open**: se o secret não estiver setado, a validação é PULADA (aceita com warning). |
| **finalidade** | Recebe webhooks Woovi/OpenPix: registra `CHARGE_COMPLETED`, trata estornos (`CHARGE_REFUNDED`/`CHARGE_EXPIRED_REFUNDED`) e reconcilia pagamentos cujo link não foi encontrado (auto-resolve por telefone ou grava como órfão). |
| **RPCs** | `mark_refund_by_correlation`, `resolve_orfao_matricula`, `register_payment` |
| **serviços externos** | — (apenas inbound) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WOOVI_WEBHOOK_SECRET` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `webhook_events_log` | insert, select, update | `id, source, event_type, correlation_id, payload, processed, error, unit_code` | C |
| `links_pagamentos_gerados` | select | `matricula, whatsapp, unit_id, plataforma_pagamento_utilizada, link_pagamento, correlation_id` | C |
| `clientes_cobranca_dashboard` | select, **update** | `name, valor_inadimplente, regua, whatsapp, matricula, link_pagamento` | C |
| `pagamentos_orfaos` | upsert | `source, gateway_correlation_id, gateway_charge_id, valor, data_pagamento, payer_name, payer_phone, payer_taxid, raw_payload` | C |

**Notas.** **Atenção:** a função **escreve** em `clientes_cobranca_dashboard.link_pagamento` (tabela do n8n). Fluxo órfão: se `links_pagamentos_gerados` não tem o `correlation_id`, tenta `resolve_orfao_matricula` pelo telefone do pagador; se resolver chama `register_payment`, senão grava em `pagamentos_orfaos`. `unit_id` nunca é hardcoded.

### B.2 `stripe-webhook` — pagamentos e estornos cartão Stripe

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-webhook` · `false` |
| **auth no código** | HMAC-SHA256 do header `stripe-signature` vs `STRIPE_WEBHOOK_SECRET`, **tolerância 5min** (valida sempre — não fail-open). |
| **finalidade** | Recebe `charge.succeeded`/`charge.refunded`/`charge.dispute.closed`: valida assinatura, resolve unidade/matrícula via `correlation_id`+tabelas de cobrança, e registra pagamento ou estorno (ou grava órfão se não resolve). |
| **RPCs** | `mark_refund_by_correlation`, `register_payment` |
| **serviços externos** | — (apenas inbound) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_WEBHOOK_SECRET` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `webhook_events_log` | insert, select, update | `id, source, event_type, correlation_id, payload, processed, error, unit_code` | C |
| `pagamentos` | select, update | `correlation_id, gateway_charge_id, comprovante` | C |
| `links_pagamentos_gerados` | select | `unit_id, whatsapp, correlation_id` | C |
| `clientes_cobranca_dashboard` | select, update | `unit_id, name, valor_inadimplente, regua, link_pagamento, matricula` | C |
| `clientes_cobranca_setembro` | select | `unit_id, matricula` | C |
| `pagamentos_orfaos` | upsert | `source, gateway_correlation_id, gateway_charge_id, valor, data_pagamento, payer_name, payer_phone, payer_taxid, matricula_informada, raw_payload` | C |

**Notas.** Apenas `charge.succeeded` é processado para pagamento (`payment_intent.succeeded` **ignorado de propósito** por não ter `receipt_url`). Resolução de `unit_id`: `links_pagamentos_gerados` → `clientes_cobranca_dashboard` → `clientes_cobranca_setembro`; falhou → `pagamentos_orfaos`. `data_pagamento` do órfão usa `new Date().toISOString()` (não vem do payload).

### B.3 `abacate-webhook` — pagamentos PIX Abacate Pay

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-webhook` · `false` |
| **auth no código** | HMAC-SHA256 (base64) sobre o raw body, header `X-Webhook-Signature` vs `ABACATE_WEBHOOK_SECRET`. **Fail-open** (aceita unsigned com warning — marcado TEMPORARY). |
| **finalidade** | Recebe eventos pagos do Abacate Pay (`checkout.completed`, `billing.paid`, `pix.paid`, `transparent.paid`/`.completed`, `pixQrCode.paid`), localiza o link por `externalId`/`correlation_id` e registra pagamento idempotente, marcando o link como pago. Espelha `woovi-webhook`. |
| **RPCs** | `register_payment` |
| **serviços externos** | — (apenas inbound) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ABACATE_WEBHOOK_SECRET` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `webhook_events_log` | insert, update | `source, event_type, correlation_id, payload, processed, error, unit_code, id` | C |
| `links_pagamentos_gerados` | select, **update** | `matricula, whatsapp, unit_id, plataforma_pagamento_utilizada, link_pagamento, correlation_id, status, gateway_charge_id` | C |
| `clientes_cobranca_dashboard` | select, **update** | `name, valor_inadimplente, regua, matricula, link_pagamento` | C |

**Notas.** Fonte de verdade do valor = `valorPago` confirmado pelo gateway (`paidAmount`/`amount`), fallback `valor_inadimplente` do dashboard. **Update de `links_pagamentos_gerados.status='paid'` dispara Realtime** no checkout em `pagar.cdt.7bee.ai`.

---

## C. Reconcile cron (pull de pagamentos perdidos) (3)

> Crons diários de reconciliação que cobrem o gap de webhooks que **nunca chegaram**: listam charges pagos das últimas N horas no gateway e ingerem os ausentes. **Apesar de `cron`, exigem `x-internal-key == NOTIFY_ORPHAN_INTERNAL_KEY`** (401 caso contrário); `verify_jwt=false`. Params de query: `hours_back` (default 48) e `dry_run=1` (simulação). `SERVICE_ROLE_KEY`. Skip de configs com `api_key` vazia ou < 20 chars. Sempre gravam um resumo em `webhook_events_log`. Schedules em `bloco-11-cron.json` (todos via `call_reconcile_function(...)`):

| função | jobname | schedule (UTC) | ≈ BRT |
|---|---|---|---|
| `reconcile-woovi-pull` | `reconcile-woovi-daily` | `0 5 * * *` | 02:00 |
| `reconcile-stripe-pull` | `reconcile-stripe-daily` | `15 5 * * *` | 02:15 |
| `reconcile-abacate-pull` | `reconcile-abacate-daily` | `30 5 * * *` | 02:30 |

### C.1 `reconcile-woovi-pull`

| campo | valor |
|---|---|
| **gatilho / jwt** | `cron` · `false` (auth `x-internal-key`) |
| **finalidade** | Lista charges `COMPLETED` da Woovi nas últimas N horas e ingere as ausentes em `pagamentos`, auto-resolvendo via `register_payment` ou salvando como órfão. |
| **RPCs** | `resolve_orfao_matricula`, `register_payment` |
| **serviços externos** | ⇪ Woovi (`GET https://api.openpix.com.br/api/v1/charge?status=COMPLETED`, paginado 100/pág, hard cap 5000) |
| **secrets** | `NOTIFY_ORPHAN_INTERNAL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `payment_gateway_configs` | select | `unit_id, api_key, platform, is_active` | C |
| `pagamentos` | select | `id, correlation_id` | C |
| `clientes_cobranca_dashboard` | select | `name, valor_inadimplente, regua, whatsapp, matricula` | C |
| `pagamentos_orfaos` | upsert | `source, gateway_correlation_id, gateway_charge_id, valor, data_pagamento, payer_name, payer_phone, payer_taxid, raw_payload` | C |
| `webhook_events_log` | insert | `source, event_type, correlation_id, payload, processed` | C |

### C.2 `reconcile-stripe-pull`

| campo | valor |
|---|---|
| **gatilho / jwt** | `cron` · `false` (auth `x-internal-key`) |
| **finalidade** | Lista charges Stripe `succeeded`/`paid` das últimas N horas e ingere as ausentes; auto-resolve matrícula+unidade ou salva como órfão (disparando email). |
| **RPCs** | `resolve_orfao_matricula`, `register_payment` |
| **serviços externos** | ⇪ Stripe (`GET https://api.stripe.com/v1/charges`, paginado via `starting_after`, hard cap 5000; `api_key` `sk_live`/`sk_test` lida do banco via Basic auth) |
| **secrets** | `NOTIFY_ORPHAN_INTERNAL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `payment_gateway_configs` | select | `unit_id, api_key, platform, is_active` | C |
| `pagamentos` | select | `id, correlation_id, gateway_charge_id` | C |
| `clientes_cobranca_dashboard` | select *(read-only)* | `matricula, unit_id, name, valor_inadimplente, regua, whatsapp` | C |
| `pagamentos_orfaos` | upsert | `source, gateway_correlation_id, gateway_charge_id, valor, data_pagamento, payer_name, payer_phone, payer_taxid, matricula_informada, raw_payload` | C |
| `webhook_events_log` | insert | `source, event_type, correlation_id, payload, processed` | C |

**Notas.** Resolve matrícula via `metadata['Matrícula']`/`matricula` ou `resolve_orfao_matricula(p_correlation_id, p_payer_phone)`. Dedup por `correlation_id` (metadata) ou `gateway_charge_id` (`ch_xxx`).

### C.3 `reconcile-abacate-pull`

| campo | valor |
|---|---|
| **gatilho / jwt** | `cron` · `false` (auth `x-internal-key`) |
| **finalidade** | Itera links Abacate sem pagamento criados nas últimas N horas e consulta cada cobrança via `/v1/pixQrCode/check`; quando `PAID`, registra via `register_payment`. |
| **RPCs** | `register_payment` |
| **serviços externos** | ⇪ Abacate (`GET https://api.abacatepay.com/v1/pixQrCode/check?id=<gateway_charge_id>`) |
| **secrets** | `NOTIFY_ORPHAN_INTERNAL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `payment_gateway_configs` | select | `unit_id, api_key, platform, is_active` | C |
| `links_pagamentos_gerados` | select | `correlation_id, matricula, unit_id, gateway_charge_id, whatsapp, plataforma_pagamento_utilizada, created_at` | C |
| `pagamentos` | select | `id, correlation_id` | C |
| `clientes_cobranca_dashboard` | select | `name, valor_inadimplente, regua, whatsapp, matricula` | C |
| `webhook_events_log` | insert | `source, event_type, correlation_id, payload, processed` | C |

**Notas.** Diferente das outras duas, itera por **links locais** (não lista o gateway). Resumo gravado com `source='abacate_pull_reconciliation'`. `register_payment` é a única escrita real em dados de cobrança.

---

## D. Motor v2 (cobrança automatizada / cadência) (3)

> Três crons (`pg_cron`+`pg_net` via `motor_v2_invoke_edge`) que orquestram o motor de cobrança v2 sobre tabelas do n8n (`disparos_log`, `cliente_cadencia`, `gate_state`, `system_state`, `clientes_cobranca_setembro`, `disparadores_whatsapp`). **Auth própria**: `x-api-key` OU `Authorization: Bearer` == `MOTOR_V2_API_KEY` (ou == `SUPABASE_SERVICE_ROLE_KEY`); `verify_jwt=false`. Também invocáveis manualmente com body `{unit_id, mode, target_date}` (modos `live`/`smoke`/`replay`). Kill switch e overrides via `system_state.key`. **Nenhuma chamada fetch/invoke externa** — só `supabase-js`. Auditoria via RPC `log_event`. Schedules em `bloco-11-cron.json` (consistentes a UTC−3):

| função | jobname | schedule (UTC) | ≈ BRT |
|---|---|---|---|
| `motor-v2-planejador` | `motor-v2-planejador-daily` | `50 11 * * 1-5` | 08:50 seg-sex |
| `motor-v2-sortear-relacionamento` | `motor-v2-sortear-relacionamento-daily` | `45 14 * * 1-5` | 11:45 seg-sex |
| `motor-v2-fechamento` | `motor-v2-fechamento-daily` | `0 2 * * 2-6` | 23:00 seg-sex (noite anterior) |

### D.1 `motor-v2-planejador`

| campo | valor |
|---|---|
| **gatilho / jwt** | `cron` · `false` (auth `x-api-key`/Bearer == `MOTOR_V2_API_KEY`) |
| **finalidade** | Às 08:50 BRT sincroniza `cliente_cadencia` com `clientes_cobranca_setembro`, aplica gate de réguas (pausa/retoma) e pré-popula `disparos_log` com mensagens `PROGRAMADA` nos slots do dia por unidade. |
| **RPCs** | `log_event` |
| **serviços externos** | — |
| **secrets** | `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MOTOR_V2_API_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `clientes_cobranca_setembro` | select | `matricula, whatsapp, name, regua, pagamento_feito, bloqueio_disparos, unit_id` | C |
| `cliente_cadencia` | select, insert, update | `id, matricula, unit_id, telefone, nome, regua, dia_ciclo, ciclo_numero, entrou_em, status, pago_at, paused_at, paused_reason` | C |
| `gate_state` | select | `unit_id, health_color_efetivo, reguas_efetivas, relacionamento_ratio` | C |
| `system_state` | select | `key, value` | C |
| `gate_config` | select | `reguas_ativas, relacionamento_ratio, health_color` | C |
| `disparadores_whatsapp` | select | `numero_telefone, ativo, unit_id` | C |
| `units` | select | `name` | C |
| `cadence_calendar` | select | `regua, dia_ciclo, slot_index, action_type, intensity, template_pool_tag` | C |
| `disparos_log` | select, insert, delete | `id, unit_id, cliente_cadencia_id, cliente_source, matricula, telefone, nome, trilho, regua, dia_ciclo, slot_index, action_type, intensity, template_pool_tag, phone_number_id, health_color_no_envio, status, scheduled_for, correlation_id` | C |

**Notas.** Kill switch `system_state.key='motor_v2_enabled'`; cap de réguas `system_state.key='motor_v2_reguas_override'`. Modo `replay` faz DELETE das `PROGRAMADA` do dia/unidade antes do re-INSERT.

### D.2 `motor-v2-sortear-relacionamento`

| campo | valor |
|---|---|
| **gatilho / jwt** | `cron` · `false` (auth `x-api-key`/Bearer == `MOTOR_V2_API_KEY`) |
| **finalidade** | Às 11:45 BRT sorteia N clientes **adimplentes** elegíveis por unidade e cria disparos `PROGRAMADO` de `RELACIONAMENTO` para 12:00 BRT, onde N = `round(relacionamento_ratio × inadimplentes únicos contactados no slot 1)`, com cooldown de 7 dias. |
| **RPCs** | `log_event`, `motor_v2_count_contactados_slot1`, `motor_v2_sortear_adimplentes` |
| **serviços externos** | — |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MOTOR_V2_API_KEY`, `SUPABASE_PROJECT_REF` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `system_state` | select | `key, value` | C |
| `disparadores_whatsapp` | select | `numero_telefone, ativo, unit_id` | C |
| `units` | select | `name` | C |
| `gate_state` | select | `relacionamento_ratio, health_color_efetivo, unit_id` | C |
| `disparos_log` | select, count, insert, delete | `id, matricula, unit_id, trilho, cliente_source, slot_index, status, scheduled_for, cliente_cadencia_id, telefone, nome, regua, dia_ciclo, action_type, intensity, template_pool_tag, phone_number_id, health_color_no_envio, correlation_id` | C |
| `adimplentes_base` | select, update | `id, matricula, telefone, nome, unit_id, bi_atual, last_relacionamento_at, updated_at` | C |

**Notas.** Possui **fallbacks REST** quando as RPCs `motor_v2_count_contactados_slot1`/`motor_v2_sortear_adimplentes` não existem (count+DISTINCT client-side e Fisher-Yates shuffle). Inserts/updates em batches de 500.

### D.3 `motor-v2-fechamento`

| campo | valor |
|---|---|
| **gatilho / jwt** | `cron` · `false` (auth `x-api-key`/Bearer == `MOTOR_V2_API_KEY`) |
| **finalidade** | Fechamento diário (23:00 BRT seg-sex): reconcilia pagamentos noturnos, avança `dia_ciclo` da cadência (+1) e finaliza clientes que passaram do dia 21, enviando-os à fila humana, por unidade. |
| **RPCs** | `log_event`, `motor_v2_reconcile_pagamentos_unit`, `motor_v2_avancar_dia`, `motor_v2_finalizar_dia22` |
| **serviços externos** | — |
| **secrets** | `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MOTOR_V2_API_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `system_state` | select | `key, value` | C |
| `disparadores_whatsapp` | select | `unit_id, ativo` | C |
| `units` | select | `name` | C |
| `clientes_cobranca_setembro` | select | `matricula, unit_id, pagamento_feito` | C |
| `cliente_cadencia` | update, select | `status, pago_at, updated_at, unit_id, matricula, id` | C |

**Notas.** A RPC `motor_v2_reconcile_pagamentos_unit` pode não existir: há **fallback manual** que faz UPDATE direto em `cliente_cadencia` (`status=PAGO`) a partir de matrículas com `pagamento_feito=true`, filtrando `status IN (ACTIVE, PAUSED_REGUA_MORTA)`. Idempotência delegada às RPCs (`last_advance_date`).

---

## E. Estornos e payouts (as únicas 2 com `verify_jwt=true`) (2)

### E.1 `process-reembolso` — reembolso manual (PIX Woovi / cartão Stripe)

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · **`true`** |
| **auth no código** | `verify_jwt=true` **mais** controle manual: exige `Authorization: Bearer`, valida via `auth.getUser` e checa `user_roles` para papel `admin` **ou** `collections_agent` (403 senão). Usa `SERVICE_ROLE_KEY`. |
| **finalidade** | Processa reembolso manual de um pagamento (PIX via Woovi/OpenPix ou cartão via Stripe), chamando a API do gateway e marcando o reembolso no banco via RPC compartilhada (mesmo dual-write dos webhooks). |
| **RPCs** | `mark_refund_by_correlation` (`p_correlation_id, p_motivo, p_realizado_by, p_source='manual'`) |
| **serviços externos** | ⇪ Woovi/OpenPix (`POST /api/v1/charge/{correlationID}/refund`); ⇪ Stripe (`POST /v1/refunds`); ⇪ Supabase Auth (`auth.getUser`) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `user_roles` | select | `role, user_id` | C |
| `pagamentos` | select | `id, reembolso_realizado, unit_id, correlation_id, forma_pagamento, matricula, valor` | C/† |
| `units` | select | `code` | C |
| `payment_gateway_configs` | select | `api_key, unit_id, platform, is_active` | C |
| `webhook_events_log` | insert, select | `source, event_type, correlation_id, payload, created_at` | C |

**Notas.** O select em `pagamentos` é `'*, units!pagamentos_unit_id_fkey(code)'` — as colunas listadas são as **literalmente acessadas no código**; pode haver outras vindas do `'*'` **(†)**. `forma_pagamento='pix'`→`platform='woovi'`; `'stripe'`→`'stripe'`; outros → "Plataforma não suportada". Para Stripe o `correlation_id` é UUID interno, então a função busca o `charge_id` real em `webhook_events_log` (`event_type='charge.succeeded'`). `logRefundAttempt` insere logs de cada etapa em `webhook_events_log.payload`. Sem validação de assinatura de provedor → confirma `http-invoked` (chamada pelo app).

### E.2 `process-payouts` — saques PIX automáticos (Abacate)

| campo | valor |
|---|---|
| **gatilho / jwt** | `cron` · **`true`** |
| **auth no código** | Apesar de `verify_jwt=true`, a autorização real é **`x-api-key === INTERNAL_API_KEY`** (401 senão) + kill switch **`PAYOUTS_ENABLED=true`** (503 senão). Chamado pelo n8n. `SERVICE_ROLE_KEY`. |
| **finalidade** | Cron diário: para cada unidade com gateway Abacate ativo e payout habilitado, atualiza status de payouts `PENDING` e cria saques PIX automáticos do saldo disponível, registrando em `payouts`. |
| **RPCs** | `link_payout_charges` (`p_payout_id`) — popula `payout_pagamentos` dentro da RPC |
| **serviços externos** | ⇪ Abacate (`GET /v2/payouts/get`, `GET /v2/store/get` (saldo), `POST /v2/payouts/create`) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYOUTS_ENABLED`, `INTERNAL_API_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `payouts` | select, insert, update | `id, external_id, unit_id, status, platform, abacate_id, platform_fee_cents, receipt_url, raw_response, updated_at, completed_at, amount_cents, pix_key, pix_key_type, raw_request, error_message` | C |
| `payment_gateway_configs` | select | `unit_id, api_key, platform, is_active, payout_enabled, payout_pix_key, payout_pix_key_type` | C |
| `webhook_events_log` | insert | `source, event_type, correlation_id, unit_code, payload, processed, error` | C |
| `units` | select | `code, name` | C |

**Notas.** `units` lida via embedded join PostgREST (`units:unit_id(code, name)`). Idempotência por `externalId=crypto.randomUUID()` + UNIQUE no banco; insert do payout `PENDING` ocorre **antes** do POST e é marcado `FAILED` se o POST falhar. Rate limit Abacate **1 payout/min** (sleep 65s entre criações). Schedule em `bloco-11-cron.json`: não há job dedicado `process-payouts` listado — disparo via n8n (cron externo), consistente com `notes` ("chamado pelo n8n via x-api-key").

---

## F. Chat / admin (2)

### F.1 `create-admin-users` — bootstrap de contas admin ⚠️

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **auth no código** | **NENHUMA** — sem Bearer, sem secret, CORS `*`. Usa `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS). **Endpoint sensível e exposto** (ver destaque #2). |
| **finalidade** | Bootstrap/seed idempotente: garante que os admins fixos (`victor@7bee.com`, `andre@7bee.com`) existam no Auth e tenham `profile` (unidade `ibirite`) e role `admin`. |
| **RPCs** | — |
| **serviços externos** | ⇪ Supabase Auth Admin (`auth.admin.getUserByEmail`/`createUser` — API, não tabela `public`) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `units` | select | `id, code` | C |
| `profiles` | select, insert | `id, user_id, name, unit_id` | C |
| `user_roles` | select, insert | `id, user_id, role` | C |

**Notas.** **Senha temporária hardcoded `TempPassword123!`** e emails admin hardcoded no código. `units` filtrada por `code='ibirite'`. No insert de `profiles`, grava `user_id`/`name`/`unit_id` (id/timestamps por default). Toca tabelas do CHAT-CDT.

### F.2 `agent-tools` — executor de tools do agente OpenAI (Rafa) no n8n

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **auth no código** | Header custom `x-agent-tools-secret == AGENT_TOOLS_SECRET`. `SERVICE_ROLE_KEY`. |
| **finalidade** | Executa 4 actions do agente: `block` (→ RPC `agent_block_customer`), `pause` (→ RPC `agent_pause_customer`), `transfer_human` (seta `conversations.routing='queued'` + `handoff_reason`) e `ai_may_send` (gate: false se há conversa open com routing `queued`/`human`). Mexe em `contacts`/`conversations` do **CHAT-CDT**. |
| **RPCs** | `agent_block_customer`, `agent_pause_customer` |
| **serviços externos** | — (nenhum fetch/invoke externo) |
| **secrets** | `AGENT_TOOLS_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `contacts` | select | `id, unit_id, wa_id` | C |
| `conversations` | select, update | `id, routing, handoff_reason, contact_id, status` | C |

**Notas.** Trata 9º dígito BR gerando variantes de `wa_id` (`waIdCandidates`). Erro RPC code `02000` → 404.

---

## G. Templates WhatsApp — Sentinel (2)

> Duas funções **100% stateless**: não usam cliente Supabase, não tocam nenhuma tabela nem RPC. CORS `*`, `verify_jwt=false` (sem auth própria no código — *inferido* dos `notes`, que confirmam ausência de cliente Supabase mas não descrevem checagem de header). Operam sobre IA Anthropic e a Meta Graph API.

### G.1 `sentinel-generate-variation`

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **finalidade** | Agente stateless que reescreve templates WhatsApp recategorizados pela Meta como MARKETING (ou rejeitados/pausados/quality RED): Sonnet gera variação UTILITY, Opus revisa num loop de até `max_iterations` (clamp 1..3, default 2). Retorna versão final + histórico. **Não toca DB nem escreve na Meta.** |
| **tabelas / RPCs** | — / — |
| **serviços externos** | ⇪ Anthropic (`POST https://api.anthropic.com/v1/messages`); ⇪ Meta Graph (`GET .../v22.0/{waba_id}/message_templates` — fallback de leitura quando `body_text` não vem no input) |
| **secrets** | `ANTHROPIC_API_KEY` (obrigatória, 503 se ausente), `SENTINEL_SONNET_MODEL`, `SENTINEL_OPUS_MODEL` (defaults `claude-sonnet-4-6`/`claude-opus-4-7`), `META_GRAPH_TOKEN`, `META_TOKEN` (só no fallback) |

**Notas.** O cabeçalho diz "não chama Meta", mas há um GET de leitura na Graph API no fallback (nunca escreve na Meta).

### G.2 `sentinel-submit-template`

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **finalidade** | Submete uma variação de template à Meta Graph API (`POST .../message_templates`), auto-injetando exemplos (`example.body_text`/`header_text`) quando há variáveis `{{N}}` sem amostras. Stateless, não toca banco. |
| **tabelas / RPCs** | — / — |
| **serviços externos** | ⇪ Meta Graph (`POST https://graph.facebook.com/v22.0/{waba_id}/message_templates`) |
| **secrets** | `META_GRAPH_TOKEN` (fallback `META_TOKEN`) |

**Notas.** Input `{waba_id, name, language(pt_BR), category(UTILITY), components[]}`. Retorna `meta_template_id`/`meta_status`/`meta_category`/`raw`; em erro `stage='meta_create'`.

---

## H. Suporte app/n8n — consulta e alertas (2)

### H.1 `list-client-debts` — dívidas pendentes de um telefone

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **auth no código** | `x-api-key == INTERNAL_API_KEY` **OU** Bearer (`auth.getUser`). `SERVICE_ROLE_KEY`. CORS `*`. |
| **finalidade** | Recebe `whatsapp` + `unit_id` e retorna as dívidas pendentes do telefone via RPC, separando as que precisam de novo link das que já têm link ativo. |
| **RPCs** | `get_phone_pending_debts` (`p_whatsapp, p_unit_id`) |
| **serviços externos** | ⇪ Supabase Auth (`auth.getUser`) |
| **secrets** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_API_KEY` |

**Tabelas:** **nenhum acesso direto a tabela** (`.from()`). O único acesso a dados é o RPC `get_phone_pending_debts`. Os campos consumidos (`has_active_link, matricula, name, valor_inadimplente, regua, link_pagamento`) vêm da **saída do RPC, não de uma tabela** — granularidade de coluna registrada com essa origem. Aceita params via query string, JSON body ou form-urlencoded.

### H.2 `notify-orphan-email` — alerta de pagamento órfão por email

| campo | valor |
|---|---|
| **gatilho / jwt** | `http-invoked` · `false` |
| **auth no código** | `x-internal-key == NOTIFY_ORPHAN_INTERNAL_KEY` (401 senão). Disparada por **trigger AFTER INSERT em `pagamentos_orfaos` via `pg_net`** (migration separada) → por isso `http-invoked`, não webhook de provedor. `SERVICE_ROLE_KEY`. |
| **finalidade** | Recebe um órfão recém-criado e dispara email de alerta via SMTP/nodemailer para `ORPHAN_NOTIFY_TO`, com modo agregado (anti-spam) em burst da mesma source. |
| **RPCs** | — |
| **serviços externos** | ⇪ SMTP/Gmail (nodemailer@6.9.16; `secure=true` se porta 465, senão STARTTLS) |
| **secrets** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `ORPHAN_NOTIFY_TO`, `NOTIFY_ORPHAN_INTERNAL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

| tabela | ops | colunas | conf |
|---|---|---|:--:|
| `pagamentos_orfaos` | select (`count head:true`) | `id, source, created_at` | C |
| `webhook_events_log` | select, insert | `id, source, event_type, correlation_id, payload, processed, error, created_at` | C |

**Notas.** Anti-spam: `BURST_THRESHOLD=5` órfãos em `BURST_WINDOW_MIN=60` vira modo burst; debounce de 60min checando `webhook_events_log` (`event_type=burst_alert_<source>`). Event types em `webhook_events_log`: `sent`, `burst_alert_<source>`, `burst_skipped`, `send_failed`.

---

## Apêndice — observações transversais

- **`webhook_events_log` é o barramento de telemetria comum:** 9 das 20 funções escrevem nela (todos os webhooks, geradores de link, reconcilers, `process-reembolso`, `process-payouts`, `notify-orphan-email`). Serve como log de eventos, idempotência e debounce de alertas.
- **`register_payment` + `resolve_orfao_matricula` + `mark_refund_by_correlation`** são as RPCs compartilhadas de dual-write entre o caminho webhook (tempo real) e o caminho reconcile (pull) — garantindo idempotência por `correlation_id`. Detalhe em `03-funcoes.md`.
- **Credenciais de gateway nunca vêm de `Deno.env`** (exceto secrets de webhook/HMAC): `api_key` Woovi/Stripe/Abacate é resolvida por unidade em `payment_gateway_configs` (multi-franquia).
- **`pagamentos_orfaos`** é o destino de fallback quando unidade/matrícula não resolve (webhooks e reconcilers Stripe/Woovi/Abacate); seu INSERT dispara `notify-orphan-email`.
- **Consistência de fuso nos crons** (`bloco-11-cron.json`): todos os schedules conferem com os horários BRT citados nos `notes` a UTC−3 — incluindo `motor-v2-fechamento` (`0 2 * * 2-6` UTC = 23:00 BRT da noite anterior, seg-sex BRT). Não há discrepância de horário.
