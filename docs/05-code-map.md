# 5. Mapa do código

Estrutura atual (atualizar a cada nova rota/módulo).

```
chat-cdt/
├── CLAUDE.md                       # orientação automática para sessões Claude
├── plano.md                        # plano original (não-autoritativo, ver docs/)
├── docs/                           # documentação viva — você está aqui
│
├── app/                            # Next.js App Router
│   ├── layout.tsx                  # root layout (gerado)
│   ├── page.tsx                    # home (gerado, redirect → /inbox via middleware)
│   ├── globals.css                 # Tailwind 4 + shadcn neutral tokens
│   └── api/
│       └── meta/
│           └── webhook/
│               └── route.ts        # GET handshake + POST recebe eventos Meta
│
├── components/
│   └── ui/                         # shadcn base (button, card, dialog, ...)
│
├── lib/
│   ├── utils.ts                    # cn() helper (shadcn padrão)
│   ├── supabase/
│   │   ├── client.ts               # createBrowserClient (use no client component)
│   │   ├── server.ts               # createServerClient com cookies() (use no RSC)
│   │   └── service.ts              # service-role client (bypass RLS — webhook/cron/internal)
│   └── meta/
│       ├── graph.ts                # wrappers: graphSendMessage, graphListTemplates, graphSubscribeApp
│       └── types.ts                # tipos do payload de webhook Meta
│
├── middleware.ts                   # auth gate + whitelist /api/meta/webhook
│
├── infra/
│   └── supabase/
│       └── migrations/
│           ├── 0001_init.sql       # schema completo (já aplicado)
│           └── 0002_seed.sql       # placeholders para registrar WABAs+phones
│
├── public/                         # PWA assets (sw.js, icons, manifest) — vir
│
├── .env.example                    # template (.env.local fica fora do git)
├── components.json                 # shadcn
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── postcss.config.mjs
└── tsconfig.json
```

## Convenções

### Clientes Supabase — qual usar quando

| Caller | Cliente | Por quê |
|---|---|---|
| Server Component (RSC) | `lib/supabase/server.ts` → `createClient()` | Cookies do user, RLS ativa, SELECT do tenant atual |
| Client Component | `lib/supabase/client.ts` → `createClient()` | Browser, RLS ativa, usado para Realtime |
| Route Handler (autenticado pelo cookie) | `lib/supabase/server.ts` | mesma coisa que RSC, ainda passa por RLS |
| Webhook, cron, endpoint interno | `lib/supabase/service.ts` → `createServiceClient()` | Bypass RLS. Aplicar `unit_id` manualmente. |

**Regra de ouro**: se a rota é chamada por um usuário logado, use o cliente com cookie. Se é máquina-para-máquina (webhook Meta, push fanout, cron), use service role.

### Graph API

Toda chamada Meta vai por `lib/meta/graph.ts`. Adicione um helper lá em vez de inline `fetch`. Versão do Graph é env (`META_GRAPH_VERSION=v22.0`).

### Validação

Zod nos route handlers para payloads externos. Tipos do webhook Meta em `lib/meta/types.ts`.

### Erros

Webhook nunca pode falhar pra Meta — sempre 200 OK depois de validar HMAC. Erros de processamento vão pra `console.error` e o evento já está em `chat_webhook_events` pra replay.

## Estrutura adicionada na sessão 2 (v1 code-complete)

```
chat-cdt/
├── app/
│   ├── (app)/
│   │   ├── layout.tsx              # auth gate + sidebar + PushSetup + Toaster
│   │   └── inbox/
│   │       ├── page.tsx            # lista server-rendered + filtro por tab
│   │       ├── inbox-client.tsx    # Realtime + state da lista
│   │       ├── inbox-row.tsx       # row com badges + janela 24h
│   │       ├── tabs-bar.tsx        # Aguardando | Meus | Todos | Encerrados
│   │       └── [id]/
│   │           ├── page.tsx        # conversation + última 100 msgs
│   │           ├── thread-client.tsx   # Realtime msgs + bubbles
│   │           ├── thread-header.tsx   # actions (Assumir/Devolver/Encerrar)
│   │           ├── actions.ts          # 'use server' actions
│   │           ├── composer-bar.tsx    # textarea + templates + janela
│   │           └── template-picker.tsx # dialog com variáveis
│   ├── login/
│   │   ├── page.tsx                # form servidor com next param sanitizado
│   │   └── actions.ts              # signIn / signOut Server Actions
│   ├── api/
│   │   ├── messages/send/route.ts  # outbound, janela 24h, fallback service-role
│   │   ├── templates/route.ts      # proxy para template_inventory (n8n)
│   │   ├── push/subscribe/route.ts # POST + DELETE
│   │   ├── internal/push/notify/route.ts  # chamado pela trigger
│   │   └── cron/templates/sync/route.ts   # stub no-op (v1)
│   └── page.tsx                    # redirect → /inbox
│
├── components/
│   ├── sidebar.tsx                 # client, usePathname
│   └── push-setup.tsx              # SW register + permission + subscribe
│
├── lib/
│   ├── push.ts                     # web-push wrapper (VAPID lazy init)
│   └── format/
│       ├── time.ts                 # relativeTime + windowRemaining + formatWaId
│       └── phone.ts                # re-export de formatWaId
│
├── public/
│   ├── sw.js
│   ├── manifest.webmanifest
│   ├── icon.svg                    # SVG source (raster icons em ICONS.md)
│   └── ICONS.md                    # como gerar PNGs reais
│
├── infra/
│   ├── Caddyfile                   # reverse proxy + headers + cache
│   ├── ecosystem.config.cjs        # PM2 (Next start na 3000)
│   └── supabase/migrations/        # SQL aplicado
│
├── bin/
│   └── deploy.sh                   # git pull → install → build → pm2 restart
│
├── .editorconfig                   # LF, UTF-8, 2 espaços
└── README.md                       # versão do repo (boilerplate substituído)
```

Decisões de fluxo gravadas em `09-decisions.md`. Próximas adições (fora do escopo v1) listadas em `08-status.md`.
