# 18 — Notificações push: atribuição + resposta do cliente (2026-08-17)

**Pedido da franquia Patrocínio:** _"seria possível configurar a plataforma para
que sejam enviadas notificações automaticamente quando houver alguma
atualização, pendência ou retorno do cliente?"_

## O que existia (e o que estava quebrado)

O CHAT-CDT já nasceu com Web Push: `chat_push_subscriptions`, banner "Ativar
notificações" (`components/push-setup.tsx`), service worker (`public/sw.js`),
endpoint `/api/internal/push/notify` e o trigger `chat_notify_handoff`
(0001/0003) que dispara na transição `routing→'queued'` com fanout para todos
os operadores da unidade. 17 operadores já tinham subscription ativa — incluindo
Melyna e Sabrina de Patrocínio.

Dois problemas:

1. **O push de handoff estava MORTO em prod.** `chat_config.cron_secret`
   (gravado 2026-05-28) não batia com o `CRON_SECRET` do `.env.local` da VPS —
   todo `net.http_post` levava **401** (223 em 6h medidos em 17/08). Corrigido
   com `UPDATE chat_config SET value=<CRON_SECRET do .env.local> WHERE
   key='cron_secret'` (fora do repo, carrega secret). Smoke test: post com IDs
   dummy → `200 {"ok":true,"sent":0}`.
2. **Patrocínio nunca passaria por esse push, nem consertado.** O rodízio
   (0022, BEFORE trigger) reescreve `queued→human` + dono na mesma UPDATE, então
   o AFTER de handoff nunca vê `'queued'`. E não existia notificação nenhuma de
   **resposta do cliente** em conversa já atribuída.

## O que foi feito

### Migração 0028 (aplicada via Management API, como sempre)

- **`trg_chat_notify_assignment`** (conversations, AFTER UPDATE): dispara quando
  `assigned_operator_id` muda para alguém em conversa `open`. Push **só para o
  novo dono** (`event='assigned'`). Cobre rodízio 0022, devolução por SLA 0025 e
  reatribuição por terceiro. `auth.uid()` = quem fez o UPDATE via PostgREST:
  se for o próprio atribuído (Assumir/tomada no app), **não** notifica.
- **`trg_chat_notify_inbound`** (messages, AFTER INSERT, `direction='in'`):
  cliente respondeu em conversa `open` + `routing='human'` + com dono → push
  **só para o dono** (`event='inbound'`) com preview do texto (120 chars) ou
  rótulo do tipo de mídia. Conversas com a IA e fila sem dono ficam de fora:
  a IA responde sozinha, e a fila já ganhou o push de handoff no enqueue.

Ambos com `EXCEPTION WHEN OTHERS → return new` — push é best-effort, nunca
derruba o INSERT do webhook nem a transição da conversa. `net.http_post` é
assíncrono (só enfileira).

### Endpoint `/api/internal/push/notify`

Ganhou `event` (`handoff`|`assigned`|`inbound`), `operator_user_id` e
`preview`. Eventos direcionados consultam `chat_push_subscriptions` direto pelo
`user_id` alvo; `handoff` mantém o fanout por unidade. Títulos:

| event    | título                      | corpo                              |
|----------|-----------------------------|-------------------------------------|
| handoff  | Novo handoff                | rótulo do motivo / "Conversa aguardando atendimento" |
| assigned | Novo atendimento para você  | rótulo do motivo / "Conversa atribuída a você" |
| inbound  | Cliente respondeu           | preview da mensagem                 |

`tag` = conversation_id → rajada de mensagens substitui a notificação em vez de
empilhar; clique abre `/inbox/<id>` (sw.js já fazia isso).

## Ordem de deploy (importa)

1. Deploy do app (push na main) — endpoint novo entende os 3 eventos.
2. `UPDATE chat_config` do secret (já feito antes, independente).
3. Migração 0028 em prod — só depois do app, senão o endpoint antigo faria
   fanout de unidade com título de handoff para eventos direcionados.

## O que o operador precisa fazer

Nada além do que já existia: aceitar o banner "Ativar notificações" no
navegador (uma vez por dispositivo). Quem já aceitou (17 usuários) começa a
receber imediatamente. iPhone/iPad: só funciona com o app "instalado" na tela
de início (limitação do iOS para Web Push, iOS 16.4+).

## Verificação pós-deploy

- `net._http_response` com status 200 e `sent>0` nos eventos reais;
- teste dirigido: `UPDATE conversations SET assigned_operator_id=<auth uid>`
  numa conversa de teste via SQL (auth.uid() NULL → notifica) e push chega.
