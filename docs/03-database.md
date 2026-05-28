# 3. Banco de dados

**Project ref Supabase**: `ubwcxktaruxqacxltovq` (sa-east-1, Postgres 17).
**Schema é vivo**, não greenfield. 40+ tabelas usadas em produção pelo n8n.

## Tabelas pré-existentes que reusamos (NÃO alterar)

| Tabela | Papel para o CHAT-CDT |
|---|---|
| `units` (id uuid, code, name, whatsapp_phone) | **É o tenant.** FK em todas nossas tabelas via `unit_id`. |
| `profiles` (id, user_id → auth.users.id, name, is_active) | Identidade do operador. |
| `user_units` (user_id → **profiles.id**, unit_id → units.id) | Acesso operador → unit. Atenção: `user_id` aqui aponta pra `profiles.id`, NÃO `auth.users.id`. |
| `user_unit_permissions` (enum `permission_type`) | Granular access. v1 não usa. |
| `user_roles` (enum `app_role`: admin / collections_agent / user / sales_agent) | v1 não filtra por role. |
| `template_inventory` (waba_id text, status, components, is_active_in_cadence) | Templates Meta sincronizados — **read-only** do CHAT-CDT. |

## Tabelas n8n que NÃO tocamos (boas saber que existem)

- `message_log` (159k linhas) — outbound do n8n. Sem `conversation_id`.
- `message_inbound` (11k linhas) — inbound do webhook do n8n. Sem `conversation_id`.
- `clientes_cobranca_setembro`, `clientes_cobranca_dashboard` — base de devedores. **Volátil** (clientes entram/saem todo dia). Usar `cadence_branch_state` aqui era a alternativa ao `routing` — rejeitada.
- `disparadores_whatsapp` — registry de números/WABAs do n8n. Não tem `phone_number_id` (Graph API ID), por isso temos `chat_phone_numbers`.
- `webhook_events_log` — audit do webhook do n8n. Nosso audit fica em `chat_webhook_events`.
- `waba_health`, `phone_health`, `waba_violations`, `waba_capability` — telemetria que o n8n popula.
- `template_master` (RLS OFF!) — templates canônicos com `components` jsonb. Reuso futuro possível.

⚠ **7 tabelas do n8n estão com RLS OFF**: `log_limpeza_links`, `cadence_slot_config`, `system_state`, `cobranca_clientes_removidos`, `sync_snapshots`, `template_master`, `data_freshness_log`. Surpresa de segurança herdada — flagged mas fora do nosso escopo.

## Tabelas que o CHAT-CDT criou

### `wabas`
Registry canônico de WhatsApp Business Accounts (não existia).
```
id           uuid PK
unit_id      uuid → units.id  (NOT NULL, CASCADE)
waba_id      text UNIQUE
business_id  text
name         text
created_at   timestamptz
```

### `chat_phone_numbers`
Mapa `phone_number_id` (Graph) → WABA. `disparadores_whatsapp` não tem essa coluna.
```
id              uuid PK
waba_id         uuid → wabas.id  (NOT NULL, CASCADE)
phone_number_id text UNIQUE  (ID da Cloud API)
display_phone   text
quality_rating  text
created_at      timestamptz
```

### `contacts`
Cliente do WhatsApp. Key por `(unit_id, wa_id)`.
```
id              uuid PK
unit_id         uuid → units.id
wa_id           text  (número E.164 sem '+')
name            text
profile         jsonb  (matricula opcional aqui)
crm_external_id text
created_at      timestamptz
UNIQUE (unit_id, wa_id)
INDEX (unit_id, wa_id)
```

### `conversations`
Sessão atendimento. Coordena CHAT-CDT ↔ n8n via `routing`.
```
id                          uuid PK
unit_id                     uuid → units.id
contact_id                  uuid → contacts.id
phone_number_id             uuid → chat_phone_numbers.id
status                      chat_conversation_status  ('open'/'snoozed'/'closed')
routing                     chat_routing_state        ('ai'/'queued'/'human')
handoff_reason              chat_handoff_reason       (NULL until handoff)
priority                    int default 0
assigned_operator_id        uuid → auth.users.id
last_inbound_at             timestamptz
customer_window_expires_at  timestamptz  (last_inbound_at + 24h, mantido por trigger)
opened_at                   timestamptz default now()
closed_at                   timestamptz
```
Índices:
- `(unit_id, routing, priority desc, last_inbound_at desc)` — feed da inbox
- `(assigned_operator_id)` — "Meus"
- `(contact_id, status)` — lookup do contato
- **`UNIQUE (contact_id) WHERE status='open'`** — race guard contra n8n

### `messages`
Mensagens da conversa. **Tabela própria, paralela ao `message_log`/`message_inbound` do n8n.**
```
id              uuid PK
conversation_id uuid → conversations.id  (CASCADE)
wa_message_id   text UNIQUE  (idempotência via webhook)
direction       chat_message_direction  ('in'/'out')
type            text  ('text'/'image'/'audio'/'video'/'document'/'template'/'interactive')
payload         jsonb  (corpo enviado ou recebido)
status          chat_message_status  ('pending'/'sent'/'delivered'/'read'/'failed')
error           jsonb
sent_by         chat_sender_kind  ('ai'/'operator'/'system'/'customer')
operator_id     uuid → auth.users.id
created_at      timestamptz
INDEX (conversation_id, created_at desc)
```

### `chat_push_subscriptions`
Web Push subscriptions, uma por device.
```
id          uuid PK
user_id     uuid → auth.users.id  (CASCADE)
endpoint    text
p256dh      text
auth        text
user_agent  text
created_at  timestamptz
UNIQUE (user_id, endpoint)
```

### `chat_webhook_events`
Audit log do nosso webhook (separado do `webhook_events_log` do n8n).
```
id            uuid PK
app_event_id  text
payload       jsonb
received_at   timestamptz
INDEX (received_at desc)
INDEX (app_event_id)
```
RLS enabled com policy deny-all explícita. Só `service_role` acessa.

## Enums criados (prefixo `chat_` para não colidir)

```sql
chat_routing_state       ('ai','queued','human')
chat_handoff_reason      ('payment_re_register','cancel','other_support')
chat_conversation_status ('open','snoozed','closed')
chat_message_direction   ('in','out')
chat_message_status      ('pending','sent','delivered','read','failed')
chat_sender_kind         ('ai','operator','system','customer')
```

## Triggers

### `trg_chat_bump_window` em `messages`
Após `INSERT` de mensagem com `direction='in'`, atualiza `conversations.last_inbound_at` + `customer_window_expires_at = now() + 24h`.

### `trg_chat_notify_handoff` em `conversations`
Após `UPDATE OF routing`, se `new.routing='queued'` e `old.routing != 'queued'`, chama `net.http_post(app.app_origin || '/api/internal/push/notify', ...)` para fanout de push. **Lê 2 GUCs**: `app.app_origin` e `app.cron_secret`. Sem eles, no-op (não dispara push).

Para ativar push em prod:
```sql
alter database postgres set app.app_origin  = 'https://chat.cdt.exemplo.com.br';
alter database postgres set app.cron_secret = '<CRON_SECRET>';
```

## RLS

Todas as tabelas do CHAT-CDT têm RLS habilitado.

Helper central:
```sql
chat_user_has_unit(target uuid) returns boolean
-- True se auth.uid() tem acesso à unit alvo.
-- Cadeia: auth.users.id → profiles.user_id → profiles.id → user_units.user_id → unit_id
```

Policies (resumo):
- `wabas` — SELECT se `chat_user_has_unit(unit_id)`.
- `chat_phone_numbers` — SELECT se há WABA acessível.
- `contacts`, `conversations` — ALL se `chat_user_has_unit(unit_id)`.
- `messages` — ALL se a conversa está numa unit acessível.
- `chat_push_subscriptions` — ALL se `user_id = auth.uid()`.
- `chat_webhook_events` — deny-all explícito (só service_role).

**Webhook + endpoints internos usam `service_role`** (bypass RLS) com `tenant_id`/`unit_id` aplicado manualmente.

## Extensões

Já instaladas no projeto (não criar): `pg_net 0.14`, `pgcrypto`, `uuid-ossp`, `pg_cron`, `supabase_vault`.

## Realtime

`conversations` e `messages` foram adicionados ao `supabase_realtime` publication. UI escuta `postgres_changes` via `@supabase/supabase-js`.

## Migrations

Pasta `infra/supabase/migrations/`:
- `0001_init.sql` — schema completo. Aplicada via MCP. Nome no log: `chat_cdt_init`.
- `0002_seed.sql` — placeholders comentados para registrar WABAs + phone_numbers. Editar e rodar manualmente.

Migration de hardening (search_path fixo + revoke EXECUTE + deny-all em webhook_events) foi aplicada como `chat_cdt_hardening`.
