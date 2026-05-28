# CHAT-CDT — Orientação para sessões Claude

Este projeto é a plataforma própria de **atendimento humano** da CDT para conversas WhatsApp que a IA do n8n repassa (handoff). Está em construção ativa.

## Antes de tocar em qualquer coisa

1. **Leia `docs/README.md`** — índice da documentação.
2. **Banco Supabase é compartilhado com n8n em produção.** Schema vivo, 40+ tabelas, 170k linhas de mensagens. **Nunca alterar tabelas do n8n** (`message_log`, `message_inbound`, `clientes_cobranca_*`, `disparadores_whatsapp`, etc). Todas as tabelas novas do CHAT-CDT são aditivas.
3. **Project ref Supabase**: `ubwcxktaruxqacxltovq` — acessar via MCP `mcp__claude_ai_Supabase__*`.
4. Para retomar o estado atual: `docs/08-status.md`.

## Fatos não-óbvios que economizam tempo

- **Tenant = `public.units`** (já existia). Não criar `tenants`.
- **Operador = `public.profiles`** + acesso via `user_units`. Não criar `operators`. Cadeia para RLS: `auth.uid() → profiles.user_id → profiles.id → user_units.user_id → unit_id`. Helper pronto: `chat_user_has_unit(target uuid)`.
- **Todas nossas tabelas/enums têm prefixo `chat_`** (exceto `wabas`, `contacts`, `conversations`, `messages` que não colidiam). Razão: convivência segura com o n8n.
- **Handoff é coordenado por `conversations.routing`** (`ai`/`queued`/`human`). n8n vai precisar de 2-3 ajustes SQL no fluxo dele — ver `docs/04-n8n-contract.md`.
- **Janela 24h da Meta** é mantida automaticamente via trigger `chat_bump_conversation_window` em `customer_window_expires_at`.
- **Push fanout** depende de 2 GUCs no banco: `app.app_origin` e `app.cron_secret`. Sem eles, `chat_notify_handoff` é no-op.
- **Race contra n8n criar conversation duplicada**: tem `uniq_open_conv_per_contact` parcial; webhook trata `23505` com re-SELECT.

## Stack

Next.js 15 (App Router) + TypeScript + Tailwind 4 + shadcn neutral + Supabase (auth/realtime/storage) + web-push. **Tudo num único processo Node** — webhook, UI, API e cron compartilham os mesmos clientes. Deploy futuro em VPS Google compartilhada com n8n (Caddy + PM2).

## Onde tudo está

- Plano original (não autoritativo, banco real divergiu): `plano.md`
- Documentação viva: `docs/`
- Migrations: `infra/supabase/migrations/`
- Código: `app/`, `lib/`, `components/`

## Como rodar

```bash
pnpm install
cp .env.example .env.local   # preencher
pnpm dev
```

Detalhes: `docs/06-setup.md`.
