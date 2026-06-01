# CHAT-CDT — Documentação

Documentação viva do projeto. **Atualizar a cada decisão arquitetural ou mudança de schema.**

## Índice

1. [Overview — o que é e por quê](01-overview.md)
2. [Arquitetura — decisões grandes](02-architecture.md)
3. [Banco de dados — schema real](03-database.md)
4. [Contrato com o n8n — coordenação](04-n8n-contract.md)
5. [Mapa do código — onde tudo está](05-code-map.md)
6. [Setup — env vars e como rodar](06-setup.md)
7. [Deployment — VPS + Caddy + PM2](07-deployment.md)
8. [Status — o que está feito e o que falta](08-status.md)
9. [Decisões — ADR log](09-decisions.md)
10. [Sessão 2026-05-29 — admin, ciclo de atendimento, relatórios](10-sessao-2026-05-29.md)

## Convenções da documentação

- **Documentação refere o estado real do código e do banco.** Se houver conflito entre `plano.md` (na raiz) e estes docs, **os docs vencem** — `plano.md` é histórico.
- Trechos de SQL devem casar com o que está em `infra/supabase/migrations/`.
- Decisões grandes vão em `09-decisions.md` em formato ADR (uma decisão = uma seção).
- `08-status.md` é atualizado ao fim de cada sessão.

## Para quem trabalha aqui depois (humano ou Claude)

Comece sempre por `01-overview.md` + `08-status.md`. Em ~5 minutos você sabe onde estamos. Se a sessão é Claude, o arquivo `CLAUDE.md` na raiz já te apontou pra cá.