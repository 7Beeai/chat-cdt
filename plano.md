# CHAT-CDT — Plano de implementação
## Contexto

A operação de cobrança da CDT usa a Cloud API do WhatsApp com **múltiplas WABAs** registradas em um único Meta App. O webhook desse app entrega tudo para um fluxo n8n que orquestra a IA de cobrança sobre **Supabase**. Hoje, três cenários estouram o escopo da IA e precisam de operador humano com UX dedicada:

1. **Recadastro de forma de pagamento** após quitação.
2. **Cancelamento** de assinatura.
3. **Suportes específicos** fora do roteiro da IA.

Plataformas prontas (Chatwoot/Digisac) resolvem a parte técnica, mas comprometem identidade visual e UX. O CHAT-CDT será uma plataforma **própria, multi-tenant**, que recebe **apenas conversas que a IA repassa**, exibe o motivo do handoff, notifica o operador via web + push (PWA) e oferece composer com janela de 24h e templates aprovados.

**Prazo**: 7h. Toda burocracia da Meta (criar app, subscrever WABAs, aprovação de templates novos) corre em paralelo desde o minuto zero, porque é o único caminho crítico que **não posso acelerar com código**.

## Restrição-chave da Meta e decisão arquitetural

> "Não é possível ter mais de um webhook por app" — verdade. Cada Meta App tem **um** callback URL. **Porém**, uma mesma WABA pode estar **assinada em vários Meta Apps simultaneamente**, e cada app recebe a sua cópia dos eventos no seu próprio callback.

**Decisão:** criar um **segundo Meta App ("CHAT-CDT")** e assinar nele as WABAs já existentes via `POST /{waba-id}/subscribed_apps` com o token do app novo. O app n8n continua intacto recebendo tudo no callback dele; o CHAT-CDT recebe a mesma fita no callback dele. Outbound do CHAT-CDT independe de "quem é dono" — usa o token do System User com permissão na WABA e o `phone_number_id`.

Coordenação: o **Supabase** é a fonte de verdade. n8n decide quando entregar (`routing='queued'`); CHAT-CDT decide a UI e o envio humano.

## Stack final (opinionada, para caber em 7h)

| Camada | Escolha | Onde roda |
|---|---|---|
| App (UI + API + Webhook) | **Next.js 15 (App Router) único**, TypeScript, Tailwind + shadcn/ui | **VPS** (PM2 + Caddy/TLS) |
| Banco + Auth + Realtime + Storage | **Supabase** (o mesmo já em uso) | Supabase Cloud |
| Push notifications | `web-push` + service worker no Next | VPS (chave VAPID local) |
| Sync de templates / cron | Endpoint protegido + `cron` do sistema | VPS |
| DNS / TLS | `chat.cdt...` apontando para VPS; Caddy emite certificado | VPS |

Por que tudo num único Next.js: webhook, composer, UI realtime e push compartilham os mesmos clientes Supabase e Graph. **Menos código de cola, menos deploy, menos coisa para depurar em 7h**. Quando o volume crescer, separamos o webhook em serviço próprio sem reescrever lógica — basta extrair `/app/api/meta/webhook/route.ts` para um serviço autônomo.

Caddy reverse-proxia a porta local do Next (3000) com TLS automático. PM2 mantém o processo vivo e reinicia em crash. Logs vão pra `/var/log/chat-cdt/`.

## Orçamento de tempo (7h, com Claude Code paralelo)

| Bloco | Tempo |
|---|---|
| 0. Burocracia Meta em paralelo (iniciar **antes** de tudo) | 0:00 (não bloqueia) |
| 1. VPS prep (Caddy, Node 20, PM2, domínio) | 0:30 |
| 2. Bootstrap Next.js + Tailwind + shadcn + Supabase client | 0:30 |
| 3. Migrations SQL (full schema + RLS + triggers) | 0:30 |
| 4. Webhook receiver + assinatura HMAC + persistência | 1:00 |
| 5. Outbound API (`/api/messages/send`) + janela 24h | 0:45 |
| 6. Auth + shell + sidebar + login | 0:30 |
| 7. Inbox (lista + Realtime) | 0:45 |
| 8. Thread (mensagens + Realtime + composer) | 1:00 |
| 9. Web Push + service worker + som | 0:30 |
| 10. Deploy VPS + DNS + apontamento webhook + testes E2E | 0:30 |
| Buffer | 0:30 |

Total: 7h. Itens em **paralelo via subagentes do Claude Code**: blocos 4 e 5 podem rodar em paralelo após 3; blocos 7 e 8 também.

## Pré-flight (você faz antes de o relógio começar)

1. Domínio escolhido — sugiro `chat.cdt.xxx` e `wh.chat.cdt.xxx` (pode ser o mesmo se quiser; mantenho um só pra simplificar TLS). Apontar `A` record da VPS.
2. SSH na VPS confirmado, usuário não-root com sudo.
3. **Supabase project URL + service role key + anon key** em mãos.
4. **Conta Meta for Developers** logada como admin do Business Manager onde estão as WABAs.
5. Lista de `waba_id` e `phone_number_id` que serão integrados na v1 (começar com 1 para acelerar, depois adicionar os outros).
6. Repositório Git criado (GitHub, vazio). VPS com chave deploy.
7. Gerar segredos: `WEBHOOK_VERIFY_TOKEN` (string aleatória), VAPID keypair (`npx web-push generate-vapid-keys`), `META_APP_SECRET` (vem do app, ver abaixo).

## Bloco 0 — Burocracia Meta (começa antes do código, roda em paralelo)

Execute nessa ordem:

1. `developers.facebook.com/apps` → **Create App** → tipo **Business** → nome "CHAT-CDT".
2. Adicionar produto **WhatsApp** → **Configuration**.
3. Em **App Settings → Basic**, copiar `App ID` e `App Secret`. Salvar em `.env` como `META_APP_ID` e `META_APP_SECRET`.
4. Em **Business Settings → Accounts → WhatsApp Accounts**, para cada WABA → **Add People/Apps** → adicionar o app "CHAT-CDT" com acesso `Manage WhatsApp Business Account`.
5. **Business Settings → Users → System Users** → criar um System User "chat-cdt-bot" → **Add Assets** → adicionar cada WABA com `Full Control` → **Generate Token** com escopos `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`. Token nunca expira. Salvar como `META_SYSTEM_USER_TOKEN`.
6. Para cada `waba_id`, executar (pode fazer via `curl` quando o domínio já existir, mas a chamada de subscribe não precisa do callback configurado ainda — basta:):
   ```bash
   curl -X POST "https://graph.facebook.com/v22.0/{waba_id}/subscribed_apps" \
     -H "Authorization: Bearer $META_SYSTEM_USER_TOKEN"
   ```
   Conferir com `GET .../subscribed_apps` que o CHAT-CDT aparece.
7. **WhatsApp → Configuration → Webhook**: callback `https://chat.cdt.xxx/api/meta/webhook`, verify token = `WEBHOOK_VERIFY_TOKEN`, subscrever campos: `messages`, `message_template_status_update`, `account_update`, `phone_number_quality_update`, `template_category_update`. (Esse passo só completa depois que o serviço estiver no ar — deixar pendente.)

Tudo isso geralmente é instantâneo. **Não há aprovação de "App Review" necessária** porque o app só atua sobre WABAs onde já é admin (modo Business). Só haveria App Review se quiséssemos credenciais públicas para clientes externos — não é o caso.

## Bloco 1 — VPS prep

Comandos no servidor (Ubuntu 22.04+):

```bash
sudo apt update && sudo apt install -y curl ufw build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm pm2
# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
sudo mkdir -p /var/www/chat-cdt /var/log/chat-cdt && sudo chown -R $USER /var/www/chat-cdt /var/log/chat-cdt
```

`/etc/caddy/Caddyfile`:

```
chat.cdt.xxx {
  reverse_proxy 127.0.0.1:3000
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000;"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
  }
}
```

`sudo systemctl reload caddy`.

## Bloco 2 — Bootstrap do projeto

```bash
cd /var/www/chat-cdt
pnpm create next-app@latest . --ts --tailwind --app --eslint --no-src-dir --import-alias '@/*'
pnpm add @supabase/supabase-js @supabase/ssr web-push zod
pnpm add -D @types/web-push supabase
pnpx shadcn@latest init -d
pnpx shadcn@latest add button input textarea card dialog sheet badge avatar separator scroll-area tabs select toast
```

`.env.local` (committar `.env.example` apenas; o `.local` fica fora do git):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
META_APP_ID=...
META_APP_SECRET=...
META_SYSTEM_USER_TOKEN=...
META_GRAPH_VERSION=v22.0
WEBHOOK_VERIFY_TOKEN=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:victor@7bee.ai
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...   # mesma da privada acima
CRON_SECRET=...
```

## Bloco 3 — Banco (Supabase, SQL completo)

Criar `infra/supabase/migrations/0001_init.sql` e aplicar via `supabase db push` (linkar o projeto antes com `supabase link --project-ref ...`) ou colar no SQL editor do Studio.

```sql
-- Tipos
create type routing_state as enum ('ai','queued','human');
create type handoff_reason as enum ('payment_re_register','cancel','other_support');
create type conversation_status as enum ('open','snoozed','closed');
create type message_direction as enum ('in','out');
create type message_status as enum ('pending','sent','delivered','read','failed');
create type sender_kind as enum ('ai','operator','system','customer');

-- Tenants (uma linha por "empresa" dentro da CDT; multi-WABA por tenant é OK)
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- WABAs registradas
create table wabas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  waba_id text unique not null,
  business_id text,
  name text,
  created_at timestamptz not null default now()
);

-- Phone numbers das WABAs
create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  waba_id uuid not null references wabas(id) on delete cascade,
  phone_number_id text unique not null,
  display_phone text,
  quality_rating text,
  created_at timestamptz not null default now()
);

-- Operadores (1:1 com auth.users)
create table operators (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  display_name text not null,
  role text not null default 'operator',  -- 'admin'|'supervisor'|'operator'
  presence text not null default 'offline',
  push_subscriptions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Contatos
create table contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  wa_id text not null,
  name text,
  profile jsonb not null default '{}'::jsonb,
  crm_external_id text,
  unique (tenant_id, wa_id),
  created_at timestamptz not null default now()
);

-- Conversas
create table conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  phone_number_id uuid not null references phone_numbers(id),
  status conversation_status not null default 'open',
  routing routing_state not null default 'ai',
  handoff_reason handoff_reason,
  priority int not null default 0,
  assigned_operator_id uuid references operators(id),
  last_inbound_at timestamptz,
  customer_window_expires_at timestamptz,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on conversations(tenant_id, routing, priority desc, last_inbound_at desc);
create index on conversations(assigned_operator_id);

-- Mensagens
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  wa_message_id text unique,
  direction message_direction not null,
  type text not null,                    -- 'text','image','audio','video','document','template','interactive'
  payload jsonb not null,
  status message_status not null default 'pending',
  error jsonb,
  sent_by sender_kind not null,
  operator_id uuid references operators(id),
  created_at timestamptz not null default now()
);
create index on messages(conversation_id, created_at desc);

-- Templates espelhados
create table templates (
  id uuid primary key default gen_random_uuid(),
  waba_id uuid not null references wabas(id) on delete cascade,
  name text not null,
  language text not null,
  category text,
  status text not null,
  components jsonb not null,
  last_synced_at timestamptz not null default now(),
  unique (waba_id, name, language)
);

-- Idempotência de webhook
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  app_event_id text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index on webhook_events(received_at desc);

-- Trigger: ao inserir mensagem inbound, atualizar última atividade + janela 24h
create or replace function bump_conversation_window() returns trigger as $$
begin
  if new.direction = 'in' then
    update conversations
    set last_inbound_at = new.created_at,
        customer_window_expires_at = new.created_at + interval '24 hours'
    where id = new.conversation_id;
  end if;
  return new;
end$$ language plpgsql;
create trigger trg_bump_window after insert on messages
for each row execute function bump_conversation_window();

-- Trigger: handoff queued → human + atribuição simples (round-robin via assigned_operator_id NULL).
-- V1: deixar 'queued' e operador "pega" no inbox; round-robin automático fica para depois.

-- RLS
alter table tenants enable row level security;
alter table wabas enable row level security;
alter table phone_numbers enable row level security;
alter table operators enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table templates enable row level security;

-- Helper: tenant do usuário corrente
create or replace function current_tenant() returns uuid language sql stable as $$
  select tenant_id from operators where id = auth.uid()
$$;

-- Policies (operadores enxergam só o próprio tenant)
create policy tenant_isolation_conv on conversations
  for all using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation_msg on messages
  for all using (
    exists (select 1 from conversations c where c.id = messages.conversation_id and c.tenant_id = current_tenant())
  );
create policy tenant_isolation_contacts on contacts
  for all using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation_wabas on wabas
  for select using (tenant_id = current_tenant());
create policy tenant_isolation_phones on phone_numbers
  for select using (exists (select 1 from wabas w where w.id = phone_numbers.waba_id and w.tenant_id = current_tenant()));
create policy tenant_isolation_templates on templates
  for select using (exists (select 1 from wabas w where w.id = templates.waba_id and w.tenant_id = current_tenant()));
create policy ops_self on operators
  for select using (tenant_id = current_tenant());
create policy ops_self_update on operators
  for update using (id = auth.uid()) with check (id = auth.uid());
```

Server-side (webhook, cron) sempre usa **service role key** e bypass RLS — funções de aplicação aplicam `tenant_id` manualmente.

## Bloco 4 — Webhook receiver (`/app/api/meta/webhook/route.ts`)

Validação HMAC, ACK rápido, processamento idempotente.

Skeleton:

```ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET!)
    .update(raw)
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return new NextResponse('bad signature', { status: 401 });
  }
  const body = JSON.parse(raw);
  // Guarda raw para audit + retry
  await supabase.from('webhook_events').insert({ payload: body });
  // Processa em background (não bloqueia ACK)
  queueMicrotask(() => process(body).catch(e => console.error('webhook process', e)));
  return NextResponse.json({ ok: true });
}

async function process(body: any) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const phoneNumberId = v.metadata?.phone_number_id;
      // resolve WABA + tenant via phone_number_id
      const { data: phone } = await supabase
        .from('phone_numbers').select('id, waba_id, wabas(tenant_id)')
        .eq('phone_number_id', phoneNumberId).single();
      if (!phone) continue;
      const tenantId = (phone as any).wabas.tenant_id;

      // Mensagens inbound
      for (const msg of v.messages ?? []) {
        const waId = msg.from;
        const { data: contact } = await supabase
          .from('contacts').upsert({ tenant_id: tenantId, wa_id: waId, name: v.contacts?.[0]?.profile?.name },
            { onConflict: 'tenant_id,wa_id' })
          .select().single();
        // pega conversa aberta ou cria
        let { data: conv } = await supabase
          .from('conversations').select('*')
          .eq('contact_id', contact!.id).eq('status','open').maybeSingle();
        if (!conv) {
          const ins = await supabase.from('conversations')
            .insert({ tenant_id: tenantId, contact_id: contact!.id, phone_number_id: phone.id })
            .select().single();
          conv = ins.data!;
        }
        await supabase.from('messages').insert({
          conversation_id: conv!.id,
          wa_message_id: msg.id,
          direction: 'in',
          type: msg.type,
          payload: msg,
          sent_by: 'customer',
          status: 'delivered'
        }).onConflict?.('wa_message_id'); // no-op se já existe
      }

      // Status updates (sent/delivered/read/failed)
      for (const st of v.statuses ?? []) {
        await supabase.from('messages').update({
          status: st.status,
          error: st.errors ?? null
        }).eq('wa_message_id', st.id);
      }
    }
  }
}
```

(Observações: `onConflict` em `.insert` no JS client se faz com `.upsert(..., { onConflict: 'wa_message_id', ignoreDuplicates: true })`. Ajustar na hora de codar.)

## Bloco 5 — Outbound API (`/app/api/messages/send/route.ts`)

Autenticado via Supabase cookie JWT. Valida janela 24h. Chama Graph.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { z } from 'zod';

const schema = z.object({
  conversationId: z.string().uuid(),
  type: z.enum(['text','template','image','document']),
  text: z.string().optional(),
  template: z.object({
    name: z.string(),
    language: z.string(),
    components: z.array(z.any()).optional()
  }).optional(),
  mediaUrl: z.string().url().optional()
});

export async function POST(req: NextRequest) {
  const supabase = createServerClient(/* ... */);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = schema.parse(await req.json());

  // Carrega conversa + phone_number + janela
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, customer_window_expires_at, routing, phone_number:phone_numbers(phone_number_id), contact:contacts(wa_id)')
    .eq('id', body.conversationId).single();
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const insideWindow = conv.customer_window_expires_at && new Date(conv.customer_window_expires_at) > new Date();
  if (body.type === 'text' && !insideWindow) {
    return NextResponse.json({ error: 'out_of_window' }, { status: 409 });
  }

  const graphBody: any = {
    messaging_product: 'whatsapp',
    to: (conv.contact as any).wa_id,
    type: body.type
  };
  if (body.type === 'text') graphBody.text = { body: body.text, preview_url: false };
  if (body.type === 'template') graphBody.template = body.template;

  const r = await fetch(
    `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}/${(conv.phone_number as any).phone_number_id}/messages`,
    { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.META_SYSTEM_USER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(graphBody) });
  const out = await r.json();
  if (!r.ok) return NextResponse.json({ error: 'graph', details: out }, { status: 502 });

  const wamid = out.messages?.[0]?.id;
  // persiste com service role (RLS bypass) usando cliente paralelo, ou simplesmente como o próprio usuário (RLS permite porque conv é dele)
  await supabase.from('messages').insert({
    conversation_id: conv.id,
    wa_message_id: wamid,
    direction: 'out',
    type: body.type,
    payload: graphBody,
    sent_by: 'operator',
    operator_id: user.id,
    status: 'sent'
  });
  return NextResponse.json({ ok: true, wa_message_id: wamid });
}
```

## Bloco 6 — Auth + shell

`/app/login/page.tsx` com Supabase Auth (email+senha, magic link off para v1). `middleware.ts` redireciona não-autenticados para `/login` exceto `/api/meta/webhook` (público) e assets. Layout `/app/(app)/layout.tsx` com sidebar (Inbox, Templates, Sair).

Cliente Supabase em `lib/supabase/server.ts` e `lib/supabase/client.ts` (padrão `@supabase/ssr`).

## Bloco 7 — Inbox (`/app/(app)/inbox/page.tsx`)

Server component faz SELECT inicial:

```ts
const { data } = await supabase
  .from('conversations')
  .select('id, routing, handoff_reason, priority, last_inbound_at, contact:contacts(wa_id,name), last_msg:messages(payload,direction,created_at)')
  .in('routing', ['queued','human'])
  .order('priority', { ascending: false })
  .order('last_inbound_at', { ascending: false })
  .limit(100);
```

Client component se inscreve em Realtime:

```ts
'use client';
const channel = supabase
  .channel('inbox')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, payload => { /* merge na lista */ })
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => { /* atualiza preview */ })
  .subscribe();
```

Cada item: badge de motivo (`cancel`/`payment_re_register`/`other_support`), prioridade (cor), prévia, "Há X min", botão **Assumir** se `assigned_operator_id is null`.

Filtros: tabs "Aguardando | Meus | Todos | Encerrados".

## Bloco 8 — Thread + Composer (`/app/(app)/inbox/[id]/page.tsx`)

- Server component carrega últimas 100 mensagens.
- Client component se inscreve em Realtime filtrado por `conversation_id=eq.{id}`.
- Composer:
  - Textarea com auto-resize.
  - Botão de templates (modal lista `templates` aprovados da WABA da conversa, com inputs para variáveis).
  - Botão de mídia (upload p/ Supabase Storage, depois manda como `type=image/document`).
  - Banner amarelo se `< 2h` para fechar janela; bloqueio se já fechou (só template).
  - Botões: **Encerrar conversa** (`status='closed'`), **Devolver para IA** (`routing='ai'`).

Sidebar direita: dados do cliente (`contacts.profile`), `crm_external_id`, histórico anterior (links para conversas fechadas).

## Bloco 9 — Push notifications

1. Gerar VAPID keys (`npx web-push generate-vapid-keys`) e colocar no `.env`.
2. `/public/sw.js` (service worker mínimo):
   ```js
   self.addEventListener('push', e => {
     const data = e.data?.json() ?? {};
     e.waitUntil(self.registration.showNotification(data.title, {
       body: data.body, icon: '/icon-192.png', badge: '/badge.png', tag: data.tag, data
     }));
   });
   self.addEventListener('notificationclick', e => {
     e.notification.close();
     e.waitUntil(clients.openWindow(e.notification.data.url));
   });
   ```
3. `manifest.webmanifest` com `name`, `short_name`, `icons`, `display: standalone`, `start_url: /inbox`.
4. No primeiro login: registrar SW (`navigator.serviceWorker.register('/sw.js')`), pedir permissão, gerar `PushSubscription`, POST para `/api/push/subscribe` que faz `update operators set push_subscriptions = push_subscriptions || $1`.
5. Disparo: criar `/api/internal/push/notify` (server-only) que chama `web-push.sendNotification(sub, JSON.stringify({title, body, url, tag}))`. Quando a UI detecta via Realtime uma nova conversa `routing='queued'` para o operador, ela chama esse endpoint? **Não** — push tem que sair do servidor. Solução: **trigger Postgres → função `pg_net` → fetch para `/api/internal/push/notify`** com `x-cron-secret`, OU um listener leve que faz `supabase.channel(...)` no servidor e dispara push. Para 7h, **a forma mais rápida**: trigger SQL chama `net.http_post` (extensão `pg_net` do Supabase) apontando para nosso endpoint interno, que então faz o `sendNotification` para todos os operadores online do tenant.

```sql
create extension if not exists pg_net;
create or replace function notify_handoff() returns trigger as $$
begin
  if new.routing = 'queued' and (old.routing is distinct from new.routing) then
    perform net.http_post(
      url := 'https://chat.cdt.xxx/api/internal/push/notify',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret', current_setting('app.cron_secret', true)),
      body := jsonb_build_object('conversation_id', new.id, 'tenant_id', new.tenant_id, 'reason', new.handoff_reason)
    );
  end if;
  return new;
end$$ language plpgsql security definer;
create trigger trg_notify_handoff after update of routing on conversations
for each row execute function notify_handoff();
```

(`app.cron_secret` definido como GUC ou hardcoded — pode ser variável de env via `ALTER DATABASE ... SET app.cron_secret = '...'`.)

## Bloco 10 — Deploy + apontamento final

1. `pnpm build` na VPS.
2. `pm2 start ecosystem.config.cjs`:
   ```js
   module.exports = { apps: [{
     name: 'chat-cdt',
     cwd: '/var/www/chat-cdt',
     script: 'node_modules/next/dist/bin/next',
     args: 'start -p 3000',
     env: { NODE_ENV: 'production' },
     out_file: '/var/log/chat-cdt/out.log',
     error_file: '/var/log/chat-cdt/err.log',
     max_memory_restart: '500M'
   }]}
   ```
3. `pm2 save && pm2 startup`.
4. Voltar ao painel Meta → WhatsApp → Configuration → **Webhook**: callback `https://chat.cdt.xxx/api/meta/webhook`, verify token, subscribar campos. Verify deve responder 200 com o `challenge`.
5. Cron sync de templates: `crontab -e` → `*/30 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://chat.cdt.xxx/api/cron/templates/sync`.

## Interface n8n ↔ CHAT-CDT (mínima e clara)

A IA do n8n decide handoff e faz **uma chamada só** ao Supabase (ele já tem service key configurada). Pode ser via "Supabase node" do n8n ou via PostgREST:

```sql
update conversations
set routing = 'queued',
    handoff_reason = 'cancel'::handoff_reason,
    priority = 10
where contact_id = (select id from contacts where tenant_id = :tenant and wa_id = :wa_id)
  and status = 'open';
```

Reverso (operador devolve): o próprio CHAT-CDT muda `routing='ai'`. n8n volta a responder.

Coexistência: n8n só responde quando `routing='ai'`. CHAT-CDT só envia quando há um operador clicando. **Não há sobreposição de envio**.

**Regra de persistência (corrigida)**:
- **Inbound**: tanto n8n quanto CHAT-CDT recebem cópia do webhook. Os dois podem inserir; o `UNIQUE (wa_message_id)` deduplica de forma idempotente. **Não precisa mudar nada no n8n** — `INSERT ... ON CONFLICT DO NOTHING`.
- **Outbound da IA**: o n8n **precisa gravar em `messages`** logo após enviar pelo Graph, com `sent_by='ai'`, `direction='out'`, `payload=<corpo enviado>`, `wa_message_id=<retornado pela Graph>`. Sem isso o operador não vê o histórico do que a IA disse antes do handoff — e isso seria um buraco fatal de contexto. Esse é o **único ajuste obrigatório no fluxo n8n**.
- **Outbound do operador**: CHAT-CDT grava sozinho na rota `/api/messages/send` (bloco 5).
- **Status updates** (`sent → delivered → read → failed`): chegam por webhook; ambos os apps podem aplicar `UPDATE messages SET status=...`, idempotente por `wa_message_id`.

Resumo prático para você ajustar no n8n: adicionar **um nó depois do envio Graph** que faz `INSERT into messages (...) values (...)` com os campos acima. Uma linha de SQL.

## Multi-tenant para v1

Manter operacional como **tenant único** (toda a CDT). Schema já suporta múltiplos, mas v1 evita complexidade de seleção/troca de tenant. Linha em `tenants` no seed, todos os operadores apontam para ela.

## Estrutura de arquivos final

```
/var/www/chat-cdt/
  app/
    api/
      meta/webhook/route.ts          # bloco 4
      messages/send/route.ts         # bloco 5
      push/subscribe/route.ts        # bloco 9
      internal/push/notify/route.ts  # bloco 9
      cron/templates/sync/route.ts   # bloco 10
    (app)/
      layout.tsx                     # sidebar + auth gate
      inbox/page.tsx
      inbox/[id]/page.tsx
      inbox/[id]/composer.tsx        # client
      templates/page.tsx
    login/page.tsx
    layout.tsx
    globals.css
  components/ui/...                  # shadcn
  lib/
    supabase/server.ts
    supabase/client.ts
    meta/graph.ts                    # wrapper de fetch da Graph API
    meta/types.ts                    # tipos do webhook
    push.ts                          # helper web-push
  public/
    sw.js
    manifest.webmanifest
    icon-192.png  icon-512.png  badge.png
  infra/
    supabase/migrations/0001_init.sql
    Caddyfile
    ecosystem.config.cjs
  middleware.ts
  .env.example
  package.json
```

## Verificação ponta a ponta (rodar em ordem)

1. **Handshake**: configurar webhook na Meta. A página de configuração deve dizer "Verified" — significa que o GET handshake passou.
2. **Assinatura inválida**: enviar POST manual sem header correto → resposta 401, nada persiste.
3. **Assinatura válida**: usar "Test" da Meta na UI do app → linha em `webhook_events`.
4. **Inbound real**: do seu celular, manda "oi" para um número de WABA. Conferir `messages` com `direction='in'`, `conversations.last_inbound_at` atualizada, `customer_window_expires_at = +24h`.
5. **Handoff forçado**: `update conversations set routing='queued', handoff_reason='cancel'` na conversa do teste 4. Operador logado vê o card aparecer **em <1s** (Realtime) e recebe **push** (mesmo com aba em background).
6. **Resposta humana**: operador clica Assumir, digita texto, envia. WhatsApp do celular recebe. `messages` linha `out`, `status` evolui `sent → delivered → read`.
7. **Fora da janela**: rodar `update conversations set customer_window_expires_at = now() - interval '1 minute'` e tentar enviar texto livre → API responde 409 `out_of_window`. Enviar template aprovado funciona.
8. **n8n não duplica**: enquanto a conversa do teste 4 estava `routing='ai'`, conferir que n8n respondeu como sempre (inalterado).
9. **Reload survival**: matar `pm2 restart chat-cdt`, mandar mensagem do celular, conferir que o webhook continuou recebendo (Meta retenta por até 7 dias em falha — não dá pra perder).
10. **PWA**: `Add to home screen` no Android, abrir, ver `/inbox` em standalone, receber push com app fechado.

## Itens explicitamente fora de escopo da v1 (7h)

- Atribuição automática round-robin (operador "pega" manualmente).
- Tela de administração de operadores/regras (cria-se via Supabase Studio).
- Editor de templates (usar Meta Business Manager para criar; CHAT-CDT só consome).
- Métricas/dashboards (TMA, SLA) — só logs por enquanto.
- Upload de mídia com preview avançado (text + template já bastam para os 3 casos de uso iniciais).
- IA dentro do CHAT-CDT (continua no n8n).
- Aplicativo nativo (PWA cobre o caso).

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Aprovação do app/WABA atrasar | Iniciado no minuto zero, paralelo ao código; não é "App Review" — geralmente instantâneo. |
| Volume alto saturar Next no VPS | Webhook responde 200 imediato, processamento em microtask; se necessário, mover só o webhook depois. |
| Cliente envia mídia que falha download | v1: armazenar `payload` cru com `media.id`; baixar sob demanda só quando operador abrir. |
| Janela 24h confunde operador | Banner cor + bloqueio servidor + lista de templates pronta no composer. |
| Duplicação de mensagens com n8n | UNIQUE em `wa_message_id` + decisão de fonte única (CHAT-CDT escreve, n8n só lê). |
| Push falha em iOS Safari | iOS 16.4+ suporta Web Push em PWA instalado; comunicar requisito; fallback é som + badge visível na aba. |

## Comandos resumidos para começar (cole na VPS depois do prep)

```bash
cd /var/www/chat-cdt
git init && git remote add origin <repo>
# após criar projeto Next, copiar .env, rodar migrations:
supabase link --project-ref <ref>
supabase db push
pnpm build
pm2 start infra/ecosystem.config.cjs
pm2 save
```

Depois disso, configurar webhook na Meta apontando para `https://chat.cdt.xxx/api/meta/webhook` e seguir o checklist de verificação.