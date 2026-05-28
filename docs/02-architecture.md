# 2. Arquitetura

## Diagrama mental

```
                 +--------------------+
                 |  Meta WhatsApp     |
                 |  Cloud API + WABAs |
                 +----+-----------+---+
                      |           |
       (mesma WABA assinada em 2 apps simultaneamente)
                      |           |
              +-------v---+   +---v--------+
              | Meta App  |   | Meta App   |
              |   "n8n"   |   | "CHAT-CDT" |
              +-----+-----+   +-----+------+
                    |               |
                    v               v
              n8n webhook    /api/meta/webhook (este projeto)
                    |               |
                    +-------+-------+
                            v
                  +-------------------+
                  |     Supabase      |   <- fonte de verdade
                  |  (Postgres + RLS) |
                  +---------+---------+
                            ^
                            |
            +---------------+----------------+
            |                                |
        n8n (IA)                       CHAT-CDT (operador)
        - cadência                     - inbox + thread
        - decide handoff               - composer + templates
        - escreve em messages          - envia via Graph
        - lê conversations.routing     - Realtime + push
```

## Stack por camada

| Camada | Escolha | Onde roda | Por que |
|---|---|---|---|
| App (UI + API + Webhook) | Next.js 15 App Router único | VPS (PM2 + Caddy/TLS) | Compartilha clientes Supabase/Graph, menos deploy |
| Linguagem | TypeScript estrito | — | Tipagem do payload Meta + zod |
| UI | Tailwind 4 + shadcn/ui base | — | Custo zero de design system, identidade própria |
| Banco + Auth + Realtime + Storage | Supabase Cloud | sa-east-1 | Já usado pelo n8n; reuso de auth.users |
| Push notifications | `web-push` + service worker | VPS (VAPID key local) | Sem dependência de FCM |
| Reverse proxy + TLS | Caddy | VPS | Cert automático |
| Process manager | PM2 | VPS | Restart em crash + memória |
| Cron / sync templates | crontab do sistema | VPS | Sem necessidade de scheduler dedicado |

## Decisões grandes (resumo)

### D1. Dois Meta Apps assinados na mesma WABA
Não há outra forma de ter dois apps recebendo a mesma fita do WhatsApp sem migrar o n8n. Detalhe: outbound do CHAT-CDT usa o token do System User, então o "dono" do app é irrelevante para envio.

### D2. Single Next.js (webhook + UI + API)
Menos pontos de falha. Se um dia o webhook saturar, extrai-se o route.ts para serviço próprio sem reescrever lógica.

### D3. Reusar o Supabase existente
O banco já tem `units`, `profiles`, `user_units`, `template_inventory`. Criar tabelas paralelas seria duplicação. Decidimos:
- **Reusar**: `units` (tenant), `profiles` + `user_units` (operadores), `template_inventory` (templates).
- **Criar (aditivo, prefixo `chat_` quando há risco de colisão)**: `wabas`, `chat_phone_numbers`, `contacts`, `conversations`, `messages`, `chat_push_subscriptions`, `chat_webhook_events`.
- **Nunca alterar**: `message_log`, `message_inbound`, `clientes_cobranca_*`, `disparadores_whatsapp` (territórios do n8n).

### D4. `conversations.routing` como fonte de verdade do handoff
Alternativas avaliadas:
- (a) Reusar `clientes_cobranca_setembro.cadence_branch_state` que já tem `em_conversa_ia`. **Rejeitado** porque a base é volátil (clientes entram/saem todo dia) e não deve definir nossa modelagem.
- (b) Coluna nova `routing` em `conversations`. **Escolhido**. Limpo, custo é 2-3 mudanças no fluxo n8n.

### D5. Contacts por `wa_id`, matrícula em jsonb opcional
- Vantagem: contato sobrevive ao churn da base de cobrança.
- Operador puxa contexto do débito via JOIN sob demanda.

### D6. n8n grava cópia do outbound da IA na nossa tabela `messages`
Sem isso, operador não vê o que a IA falou antes do handoff = contexto perdido = falha de UX. Uma linha SQL adicional no fluxo n8n. Ver `04-n8n-contract.md`.

### D7. Race contra n8n criar conversa duplicada
Resolvido com `UNIQUE INDEX uniq_open_conv_per_contact ON conversations (contact_id) WHERE status = 'open'`. Webhook trata violação `23505` com re-SELECT.

### D8. Push fanout via trigger pg_net
Quando `conversations.routing` transita para `queued`, trigger chama `/api/internal/push/notify`. Endpoint interno faz fanout via `web-push`. Sem precisar de fila externa.

### D9. RLS sempre on, helpers `SECURITY DEFINER` com search_path fixo
Padrão Supabase. Funções internas (`chat_user_has_unit`, `chat_notify_handoff`) têm EXECUTE revogado de `anon`/`authenticated` para não serem chamáveis via RPC pública.

## Trade-offs assumidos

- **VPS compartilhada com n8n**: economia + latência zero entre apps, mas single point of failure. Mitiga com PM2 `max_memory_restart`.
- **Service worker + push em iOS Safari**: só funciona com PWA instalado (iOS 16.4+). Comunicado como requisito.
- **Sem editor de templates**: usar Meta Business Manager. UI consome `template_inventory`.
- **Sem round-robin v1**: operador "pega" manualmente da fila.
