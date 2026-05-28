# 1. Overview

## O problema

A CDT (operação de cobrança) usa WhatsApp Cloud API em **múltiplas WABAs** registradas num único Meta App. Esse app entrega webhooks para um fluxo n8n que orquestra uma **IA de cobrança** sobre Supabase.

Três cenários estouram o escopo da IA e exigem operador humano com UX dedicada:

1. **Recadastro de forma de pagamento** após quitação.
2. **Cancelamento** de assinatura.
3. **Suportes específicos** fora do roteiro da IA.

Plataformas prontas (Chatwoot, Digisac) resolvem a parte técnica, mas comprometem identidade visual + UX e adicionam custo recorrente. A decisão foi construir uma plataforma **própria, multi-tenant**, que recebe **apenas as conversas que a IA repassa**, exibe o motivo do handoff, notifica o operador e oferece composer com janela 24h + templates aprovados.

## Restrição que define a arquitetura

> "Não é possível ter mais de um webhook por Meta App" — **verdade**. Cada Meta App tem **um** callback URL.

**Mas**: uma mesma WABA pode estar **assinada em vários Meta Apps simultaneamente**. Cada app recebe a sua cópia dos eventos no callback dele.

**Decisão**: criar um **segundo Meta App** ("CHAT-CDT") e assinar nele as mesmas WABAs já em uso pelo app n8n via `POST /{waba_id}/subscribed_apps`. O app n8n continua intacto, recebendo tudo no callback dele. O CHAT-CDT recebe a mesma fita no callback dele. Outbound do CHAT-CDT independe de "quem é dono" — usa o token do System User com permissão na WABA + `phone_number_id`.

## Quem coordena quem

- **Supabase é a fonte de verdade.** Tanto n8n quanto CHAT-CDT escrevem lá.
- **n8n decide quando entregar para humano** (`UPDATE conversations SET routing = 'queued'`).
- **CHAT-CDT decide a UI** e o envio do operador.
- **Operador devolve pra IA** marcando `routing = 'ai'`. n8n lê isso antes de cada envio.
- **Sem sobreposição de envio**: n8n só responde quando `routing = 'ai'`; CHAT-CDT só envia quando o operador clica.

Detalhes do contrato em `04-n8n-contract.md`.

## Escopo da v1

| Dentro | Fora |
|---|---|
| Inbox com filtros (Aguardando / Meus / Todos / Encerrados) | Atribuição automática round-robin (operador "pega" manualmente) |
| Thread com composer (texto livre + templates aprovados) | Editor de templates (usar Meta Business Manager) |
| Janela 24h: banner + bloqueio servidor + fallback para template | Métricas/dashboards (TMA, SLA) |
| Web Push (PWA) + som | App nativo (PWA cobre o caso) |
| Tenant único (CDT) na operação, schema multi-tenant | Tela de administração de operadores (criar via Studio) |
| 3 motivos de handoff: pagamento, cancelamento, outros | IA dentro do CHAT-CDT (continua no n8n) |

## Por que tudo num único Next.js

Webhook, composer, UI e push compartilham os mesmos clientes Supabase + Graph. Menos código de cola, menos deploy, menos coisa para depurar. Quando o volume crescer, dá pra extrair só o webhook (`/app/api/meta/webhook/route.ts`) num serviço próprio sem reescrever lógica.

## Onde isso roda

VPS Google compartilhada com várias instâncias n8n. Caddy reverse-proxia o Next na 3000 com TLS automático. PM2 mantém o processo vivo. Logs em `/var/log/chat-cdt/`. Detalhes em `07-deployment.md`.
