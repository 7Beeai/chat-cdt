# 8. Status

> **Atualizar ao fim de cada sessão de trabalho.** Última atualização: 2026-05-27 (sessão 2 — código v1 completo, sem smoke test ainda).

## TL;DR

V1 está **code-complete**: webhook, outbound API, auth+shell, inbox+Realtime, thread+composer, web push, deploy artifacts, e infra (Caddyfile, PM2, deploy.sh) prontos. `pnpm build` passa limpo (11 rotas geradas). **Nunca foi rodado num browser** ainda — checklist E2E na seção final.

## O que está pronto

### Código (todas as rotas + UI da v1)

- ✅ Bootstrap Next.js 15 + Tailwind 4 + shadcn neutral
- ✅ Deps instaladas: `@supabase/supabase-js`, `@supabase/ssr`, `web-push`, `zod`
- ✅ shadcn base: button, input, textarea, card, dialog, sheet, badge, avatar, separator, scroll-area, tabs, select, sonner
- ✅ Libs: `lib/utils.ts`, `lib/supabase/{client,server,service}.ts`, `lib/meta/{graph,types}.ts`, `lib/push.ts`, `lib/format/{time,phone}.ts`
- ✅ `middleware.ts` (auth gate + whitelist webhook/manifest/sw)
- ✅ `app/api/meta/webhook/route.ts` — GET handshake + POST com HMAC + idempotência + race guard
- ✅ `app/api/messages/send/route.ts` — outbound operador com janela 24h, **fallback service-role no persist** se cookie client falhar (garante que a mensagem que foi pra Graph sempre vire row no DB)
- ✅ `app/api/templates/route.ts` — proxy server-side para `template_inventory` usando service-role (evita conflito com RLS do n8n; valida acesso à WABA antes)
- ✅ `app/api/push/subscribe/route.ts` (POST + DELETE)
- ✅ `app/api/internal/push/notify/route.ts` — chamado pela trigger `chat_notify_handoff`
- ✅ `app/api/cron/templates/sync/route.ts` — stub no-op para v1 (templates ficam em n8n)
- ✅ `app/login/page.tsx` + `app/login/actions.ts` (Server Actions signIn/signOut)
- ✅ `app/(app)/layout.tsx` — auth gate + sidebar + PushSetup + Toaster
- ✅ `components/sidebar.tsx`, `components/push-setup.tsx`
- ✅ `app/(app)/inbox/page.tsx` + `inbox-client.tsx` + `inbox-row.tsx` + `tabs-bar.tsx` — lista com Realtime + filtros (Aguardando/Meus/Todos/Encerrados)
- ✅ `app/(app)/inbox/[id]/page.tsx` + `thread-client.tsx` + `thread-header.tsx` + `actions.ts` + `composer-bar.tsx` + `template-picker.tsx`
- ✅ `public/sw.js` + `public/manifest.webmanifest` + `public/icon.svg`
- ✅ `.env.example` completo, `.gitignore` com `!.env.example`, `.editorconfig`

### Banco

- ✅ `chat_cdt_init` aplicada no projeto `ubwcxktaruxqacxltovq`
- ✅ `chat_cdt_hardening` aplicada (search_path fixo, EXECUTE revogado, deny-all em chat_webhook_events)
- ✅ 7 tabelas novas, 6 enums prefixados, 2 triggers, 1 helper RLS
- ✅ Realtime publication para `conversations` + `messages`
- ✅ Race guard `uniq_open_conv_per_contact`

### Deploy

- ✅ `infra/Caddyfile` (placeholder de domínio)
- ✅ `infra/ecosystem.config.cjs` (PM2)
- ✅ `bin/deploy.sh` (git pull → install → build → pm2 restart). Lembrar `chmod +x` no primeiro clone (Windows não preserva exec bit).
- ✅ `README.md` (substitui o boilerplate, aponta pra docs/)

### Documentação

- ✅ `CLAUDE.md` na raiz (auto-load para sessões Claude)
- ✅ `docs/README.md` + 9 capítulos
- ✅ Memórias persistentes em `~/.claude/projects/.../memory/`

### Builds + verificações estáticas

- ✅ `pnpm exec tsc --noEmit` — clean
- ✅ `pnpm build` — 11 rotas, 0 errors. Warning de migração `middleware → proxy` no Next 16 é cosmético, fica para depois.

## Pendências externas (precisa ação humana)

### Bloqueantes para subir em prod

- [ ] **Domínio** — escolher e apontar A record pra VPS. Substituir `chat.cdt.exemplo.com.br` em `infra/Caddyfile`, `.env.local`, e na config Meta.
- [ ] **`META_APP_SECRET`** — pegar em developers.facebook.com → CHAT-CDT → App Settings → Basic ("Show"). É independente do webhook URL.
- [ ] **Gerar VAPID keys** — `pnpx web-push generate-vapid-keys`. Colocar em `.env.local`.
- [ ] **`CRON_SECRET`** — gerar string aleatória, colocar em `.env.local` + no banco via `ALTER DATABASE ... SET app.cron_secret = ...`.
- [ ] **GUCs do Postgres** — uma vez:
  ```sql
  alter database postgres set app.app_origin  = 'https://chat.cdt.exemplo.com.br';
  alter database postgres set app.cron_secret = '<mesmo do .env>';
  ```
- [ ] **Seed inicial** — editar `infra/supabase/migrations/0002_seed.sql` com `waba_id` real + `phone_number_id` da Graph, aplicar via Studio ou MCP.
- [ ] **Operador inicial** — criar usuário Victor em Supabase Auth, depois `INSERT` em `profiles` + `user_units` ligando à `units.code='CDT'` (snippet em `docs/06-setup.md`).
- [ ] **Subscrever WABA(s) ao app CHAT-CDT** — `POST /{waba_id}/subscribed_apps` com o System User token. Pode fazer via curl agora mesmo (não precisa do callback no ar).
- [ ] **Configurar webhook na Meta** — `https://<domínio>/api/meta/webhook` + `WEBHOOK_VERIFY_TOKEN` + subscrever campos messages/etc. Só depois que o domínio estiver TLS-OK.
- [ ] **Ajustes no n8n** — 3 mudanças SQL no fluxo (gravar outbound em `messages`, escrever `routing='queued'` no handoff, ler `routing` antes de enviar). Detalhe em `docs/04-n8n-contract.md`.

### Nice-to-have

- [ ] Gerar raster icons (`icon-192.png`, `icon-512.png`, `icon-maskable.png`, `badge.png`) — ver `public/ICONS.md`. Sem isso, PWA install no iOS não funciona; Chrome dá warning mas instala via SVG.
- [ ] Migrar `middleware.ts` → `proxy.ts` (deprecation do Next 16).
- [ ] Editor de templates (fora do escopo v1).
- [ ] Métricas/dashboards.

## Checklist E2E (rodar quando estiver no ar)

1. ✅ `pnpm build` passa local — já feito.
2. ☐ `pnpm dev` sobe, `/login` renderiza, login funciona com user do Supabase.
3. ☐ Handshake do webhook na Meta: dashboard mostra "Verified" no callback.
4. ☐ POST manual com assinatura inválida → 401.
5. ☐ "Send Test" no painel Meta → linha em `chat_webhook_events`.
6. ☐ Inbound real (mandar "oi" do celular) → linha em `messages` direction='in', `last_inbound_at` atualizado, janela 24h aberta.
7. ☐ Forçar handoff manual: `UPDATE conversations SET routing='queued', handoff_reason='cancel' WHERE id=...`. Operador logado vê o card aparecer **em <1s** (Realtime) E recebe **push** (mesmo com aba em background).
8. ☐ Operador clica "Assumir" + envia texto → WhatsApp recebe + status evolui `sent→delivered→read`.
9. ☐ Fora da janela: `UPDATE conversations SET customer_window_expires_at = now() - interval '1 minute'` → texto livre = 409; template = ok.
10. ☐ Template picker carrega lista filtrada por status='APPROVED' da WABA correta.
11. ☐ n8n não duplica enquanto `routing='ai'` (presume ajustes #3 do contrato aplicados).
12. ☐ `pm2 restart chat-cdt` mid-flight não perde mensagens (Meta retenta 7d).
13. ☐ PWA `Add to home screen` (Android), abrir, ver `/inbox` standalone, receber push com app fechado.

## Decisões / fixes não-óbvios desta sessão

1. **`/api/messages/send` faz fallback para service-role** se o insert via cookie client falhar — garante que a row sempre lande (a mensagem já foi pro Graph; sem row no DB = mensagem fantasma no histórico). Em vez de retornar 200 com warning soft.
2. **`/api/templates` proxy server-side**: `template_inventory.RLS` usa função `user_can_read_unit_code(unit_code)` que depende de `user_unit_permissions` (não da nossa `user_units`). Operador CHAT-CDT só estaria em uma OU na outra. Endpoint usa service-role após validar acesso à WABA via RLS própria.
3. **Push: applicationServerKey precisa cast `as unknown as BufferSource`** com `@types/node` 20+ (PushSubscriptionOptionsInit ficou estrito contra `Uint8Array<SharedArrayBuffer>`). Runtime aceita tudo.
4. **Sidebar mostra email se profile faltar** — fresh signup em Supabase Auth não cria `profiles` automaticamente. Documentado em `docs/06-setup.md`.

## Riscos vivos

| Risco | Mitigação |
|---|---|
| Operador autenticado sem `user_units` row → RLS bloqueia tudo silenciosamente | Documentado em `docs/06-setup.md`; seed inclui INSERT em `user_units` |
| `META_APP_SECRET` ainda não no `.env.local` | Webhook responde 500 "misconfigured" sem ele; flag visível |
| Volume alto saturar Next | ACK em microtask; webhook é stateless e pode ser extraído depois |
| iOS Safari push sem PNG icons reais | Documentado em `public/ICONS.md`, gerador sugerido |
| Próxima sessão Claude perder contexto | `CLAUDE.md` + `docs/` versionados + memórias persistentes |
