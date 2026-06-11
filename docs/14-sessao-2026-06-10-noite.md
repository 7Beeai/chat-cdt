# Sessão 2026-06-10 (noite) — execução do plano docs/13

Commit `af4c153`. Executa os itens A–D do feedback do teste real do Victor
(docs/13). Item E (cadência no histórico) segue desligado por flag, aguardando
o motor v2 popular `disparos_log`.

## A. Realtime morto — causa raiz ENCONTRADA e corrigida

Diagnóstico direto no banco (`realtime.subscription`): as subscriptions do
canal `inbox-workspace` estavam registradas com **claims anon** (`role=anon`,
`sub=null`), enquanto as do canal da thread (criadas ~2s depois) vinham
`authenticated`. Ou seja:

- O `useEffect` de primeira montagem assinava o canal ANTES do supabase-js
  carregar a sessão e propagar o JWT pra conexão Realtime.
- Os claims são **congelados no momento do subscribe** — o setAuth posterior
  não conserta a subscription já criada.
- A RLS (`chat_user_has_unit`, que usa `auth.uid()`) avaliava como anon →
  WALRUS entregava **zero eventos**. Lista e thread (em full page load)
  ficavam surdas.

Não era publication (conferida: `conversations` e `messages` estão na
`supabase_realtime`) nem timeout de subquery.

**Fix**: `lib/supabase/realtime.ts` → `ensureRealtimeAuth()` (getSession +
`realtime.setAuth(token)`) awaited ANTES de criar o channel, nos dois
componentes. `subscribe()` agora tem callback de status que loga
`CHANNEL_ERROR`/`TIMED_OUT` no console.

**Plano B (fica mesmo com realtime ok)**:
- Lista: `router.refresh()` a cada 60s com aba visível + refresh imediato no
  `visibilitychange` (o effect `setItems(initial)` já re-sincroniza).
- Thread: refetch das **100 mensagens mais recentes** (desc+reverse — o fetch
  da page é asc limit 100, inútil como fallback em conversa longa) a cada 30s
  com aba visível. Merge = união com servidor ganhando por id/wa_message_id;
  preserva otimistas em voo (`temp-`) e sintéticas (`mlog-`).

## B. Bolha de anexo otimista

- `appendOptimistic` agora seta `mediaUrls[tempId] = {url:null, pending:true}`
  pra mídia → spinner em vez de "não disponível".
- No `r.ok` do `/api/messages/media`, o client usa o `storage_path` que a
  rota já devolvia e resolve a signed URL na hora
  (`resolveOptimisticMedia` no ThreadClient, novo prop
  `onOptimisticMediaResolved` do ComposerBar) — bolha renderiza sem depender
  de realtime. O storage_path também é gravado no payload do otimista pra
  merges futuros não regredirem pro spinner.
- Dedupe de eco: se o INSERT realtime chega antes do response HTTP, o handler
  procura bolha `temp-` recente (<30s, mesmo type/operador, sem
  wa_message_id) e faz merge em vez de append; o estado de mídia é
  transferido do tempId pro id real.

## C. Composer travado fora da janela

- `insideWindow` agora TICKA (interval 30s no ThreadClient) — janela que
  expira com a conversa aberta trava o campo ao vivo.
- `Textarea disabled={!insideWindow || sending}` (antes só bloqueava o envio).
  Botão de templates continua ativo (único caminho fora da janela).
- Estado divergente (janela local aberta, Meta recusa): Graph **131047/131026**
  nas rotas send/media → `lib/meta/window.ts` zera
  `customer_window_expires_at` via service role e devolve o MESMO 409 do gate
  local. No client, o 409 além do toast+picker agora faz `router.refresh()`
  → conversa recarrega com janela zerada → composer trava.
- 131026 só é tratado assim em free-form (em template, deixa o 502 aparecer).

## D. Picker de retomada (1 clique)

- `/api/templates?purpose=reopen`: `LIKE 'retomada_%'` + APPROVED +
  `paused_by_sentinel IS NOT TRUE`, mais recente por base via prefixo
  (`retomada_recadastro_pagamento*` → Recadastro, `retomada_suporte*` →
  Suporte — resolve as variações do Sentinel tipo `_s1_1781042898`).
- **Gotcha real encontrado**: muitas linhas APPROVED do inventário estão sem
  `body_text` E sem `components` (verificado no banco). Sem corpo não dá pra
  saber a contagem de {{n}} — mandar errado a Meta rejeita (132000). Fallback
  na rota: resolve o corpo via `graphListTemplates` (Graph API, read-only,
  sem escrever na tabela do n8n). Último recurso no client: assume 1 variável
  (todos os retomada_* têm {{1}}).
- `template-picker.tsx` reescrito: 2 cards fixos com preview do corpo já
  preenchido com o primeiro nome, botão Enviar único, SEM inputs de variável.
  `{{1}}` = primeiro nome validado (CRM via page.tsx; fallback nome do
  WhatsApp; nunca vazio — "cliente").
- O catálogo completo da WABA saiu do fluxo do operador (o modo default da
  rota continua existindo, sem consumidor de UI).

## Pendências

1. Teste real do Victor: realtime na lista + thread, anexo (spinner →
   render), trava fora da janela, retomada 1 clique.
2. Conferir em `realtime.subscription` que as novas subscriptions nascem
   `authenticated` (role) após o deploy.
3. Item E (docs/13): religar `SHOW_CADENCE_HISTORY` só com motor v2 +
   corte de data.
