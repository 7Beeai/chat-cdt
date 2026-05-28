# 6. Setup

## Pré-requisitos locais (Windows / Mac / Linux)

- Node 20+ (testado em 24.15)
- pnpm 11+
- Acesso ao projeto Supabase `ubwcxktaruxqacxltovq` (ou ao MCP Supabase já configurado no Claude Code)
- App Meta CHAT-CDT já criado (App ID, App Secret, System User Token em mãos)

## Subindo o projeto pela primeira vez

```bash
git clone <repo> chat-cdt
cd chat-cdt
pnpm install
cp .env.example .env.local   # preencher (ver abaixo)
pnpm dev                     # http://localhost:3000
```

## Variáveis de ambiente (`.env.local`)

```env
# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=https://ubwcxktaruxqacxltovq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# --- Meta / WhatsApp Cloud API ---
META_APP_ID=...                       # App Settings → Basic
META_APP_SECRET=...                   # App Settings → Basic ("Show")
META_SYSTEM_USER_TOKEN=...            # Business Settings → System Users → Generate
META_GRAPH_VERSION=v22.0
WEBHOOK_VERIFY_TOKEN=...              # string aleatória, casa com a config no painel Meta

# --- Web Push (VAPID) ---
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:victor@7bee.ai
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...      # mesma do VAPID_PUBLIC_KEY

# --- Internal ---
CRON_SECRET=...                       # protege /api/cron/* e /api/internal/*
APP_ORIGIN=http://localhost:3000      # em dev. em prod = https://chat.cdt.xxx
```

### Como gerar VAPID keys

```bash
pnpx web-push generate-vapid-keys
```

Pega o `Public Key` (vai pra `VAPID_PUBLIC_KEY` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) e o `Private Key` (vai pra `VAPID_PRIVATE_KEY`).

### Onde achar cada chave Meta

| Variável | Onde |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | https://developers.facebook.com → seu App CHAT-CDT → App Settings → Basic |
| `META_SYSTEM_USER_TOKEN` | https://business.facebook.com → Business Settings → System Users → "chat-cdt-bot" → Generate New Token |
| `WEBHOOK_VERIFY_TOKEN` | Você escolhe. Mesma string vai na config do webhook no painel Meta. |

## Estado do banco

Migrations já aplicadas no projeto `ubwcxktaruxqacxltovq`:
- `chat_cdt_init` (schema completo)
- `chat_cdt_hardening` (search_path fixo, EXECUTE revogado, deny-all)

Para verificar:
```sql
select name, executed_at
  from supabase_migrations.schema_migrations
 order by executed_at desc
 limit 10;
```

Ou via MCP:
```
mcp__claude_ai_Supabase__list_migrations(project_id="ubwcxktaruxqacxltovq")
```

## Seed mínimo (rodar 1x antes de testar handoff)

Editar `infra/supabase/migrations/0002_seed.sql` substituindo placeholders e rodar via Studio ou MCP `apply_migration`:

```sql
-- 1) Operador de teste (Victor) → unit CDT
insert into profiles (user_id, name)
select u.id, coalesce(u.raw_user_meta_data->>'name', u.email)
  from auth.users u
 where u.email = 'victor@7bee.ai'
 on conflict do nothing;

insert into user_units (user_id, unit_id)
select p.id, (select id from units where code = 'CDT' limit 1)
  from profiles p
  join auth.users u on u.id = p.user_id
 where u.email = 'victor@7bee.ai'
 on conflict do nothing;

-- 2) Registrar a primeira WABA
with u as (select id from units where code = 'CDT' limit 1)
insert into wabas (unit_id, waba_id, name)
select u.id, '<WABA_ID>', 'CDT Cobrança' from u
on conflict (waba_id) do nothing;

-- 3) Registrar phone_number da Graph API
with w as (select id from wabas where waba_id = '<WABA_ID>')
insert into chat_phone_numbers (waba_id, phone_number_id, display_phone)
select w.id, '<PHONE_NUMBER_ID>', '<+55 31 ...>' from w
on conflict (phone_number_id) do nothing;
```

## GUCs para o push fanout funcionar em prod

Uma vez só, no banco de produção:

```sql
alter database postgres set app.app_origin  = 'https://chat.cdt.exemplo.com.br';
alter database postgres set app.cron_secret = '<CRON_SECRET>';
```

(Os GUCs são lidos pela função `chat_notify_handoff()` em cada trigger. Sem eles, push é no-op.)

## Configuração do webhook na Meta

Depois que o domínio + TLS estiverem prontos (ver `07-deployment.md`):

1. https://developers.facebook.com → App CHAT-CDT → WhatsApp → Configuration → Webhook
2. **Callback URL**: `https://chat.cdt.xxx/api/meta/webhook`
3. **Verify token**: o valor de `WEBHOOK_VERIFY_TOKEN`
4. Subscrever campos: `messages`, `message_template_status_update`, `account_update`, `phone_number_quality_update`, `template_category_update`
5. Salvar — Meta vai chamar GET no callback. Resposta esperada: 200 com o `challenge`.

## Subscrever WABAs ao app CHAT-CDT

Uma vez por WABA. Pode rodar localmente com o System User token:
```bash
curl -X POST "https://graph.facebook.com/v22.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer $META_SYSTEM_USER_TOKEN"
```

Conferir:
```bash
curl "https://graph.facebook.com/v22.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer $META_SYSTEM_USER_TOKEN"
```
O app CHAT-CDT deve aparecer na lista, junto do app do n8n.
