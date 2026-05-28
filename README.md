# CHAT-CDT

Plataforma de atendimento humano para conversas WhatsApp que a IA do n8n repassa.

> Documentação completa em [`docs/`](./docs). Status atual em [`docs/08-status.md`](./docs/08-status.md). Para sessões Claude Code, [`CLAUDE.md`](./CLAUDE.md) na raiz é carregado automaticamente.

## O que faz

Recebe handoff da IA de cobrança (n8n) quando uma conversa WhatsApp precisa de operador humano — pagamento, cancelamento, suporte fora do roteiro. Multi-WABA num único Meta App próprio que coexiste com o app do n8n via subscrição compartilhada. Schema multi-tenant, janela 24h da Meta com fallback automático para templates aprovados, web push para notificar operador.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · shadcn/ui · Supabase (auth/realtime/storage) · web-push · PM2 · Caddy

## Rodando localmente

```bash
pnpm install
cp .env.example .env.local   # preencher
pnpm dev
```

Detalhes (env vars, VAPID, seed): [`docs/06-setup.md`](./docs/06-setup.md).

## Banco de dados

Reusa o Supabase já em produção do n8n. Migrations em [`infra/supabase/migrations/`](./infra/supabase/migrations/).

Schema vivo + nossas tabelas novas: [`docs/03-database.md`](./docs/03-database.md).

> **Nunca alterar tabelas do n8n** (`message_log`, `message_inbound`, `clientes_cobranca_*`, `disparadores_whatsapp`). Tudo nosso é aditivo.

## Coexistência com o n8n

3 ajustes SQL no fluxo n8n são parte do contrato: [`docs/04-n8n-contract.md`](./docs/04-n8n-contract.md).

## Deploy

VPS Google + Caddy + PM2. Detalhes: [`docs/07-deployment.md`](./docs/07-deployment.md). Artifacts em [`infra/`](./infra/).

```bash
# Primeira vez no servidor
ssh user@vps
sudo mkdir -p /var/www/chat-cdt /var/log/chat-cdt
sudo chown -R $USER /var/www/chat-cdt /var/log/chat-cdt
cd /var/www/chat-cdt
git clone <repo> .
cp .env.example .env.local && nano .env.local
pnpm install
pnpm build
pm2 start infra/ecosystem.config.cjs
pm2 save
sudo cp infra/Caddyfile /etc/caddy/ && sudo systemctl reload caddy
chmod +x bin/deploy.sh

# Atualizações
./bin/deploy.sh
```

## Decisões arquiteturais

Log em [`docs/09-decisions.md`](./docs/09-decisions.md). 11 ADRs cobrindo dois Meta Apps, single Next.js, reuso do schema do n8n, handoff via `conversations.routing`, etc.

## Status

Ver [`docs/08-status.md`](./docs/08-status.md) — atualizado a cada sessão.

## Licença

Privado.
