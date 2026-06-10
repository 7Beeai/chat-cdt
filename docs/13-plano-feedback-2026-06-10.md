# Plano — feedback do Victor pós-teste (2026-06-10, noite)

Plano de execução para a próxima sessão. Contexto completo da sessão anterior
em `docs/12-sessao-2026-06-10.md`. Estado: tudo da sessão 12 está em produção;
o item "templates de régua no histórico" foi DESLIGADO a pedido do Victor
(flag `SHOW_CADENCE_HISTORY = false` em `app/(app)/inbox/[id]/page.tsx`).

## Feedback recebido (teste real do Victor, conversa 51b047dc em Ibirité)

1. ✅ Anexo de PDF funcionou de ponta a ponta (falhou primeiro por janela 24h
   real fechada — esperado; depois do inbound "ola", enviou).
2. 🐛 A bolha do anexo aparece como "não disponível" logo após o envio; só
   renderiza depois de sair e voltar na conversa.
3. 🐛 **A lista da inbox não atualiza em tempo real**: ele mandou "ola"
   (inbound) e enviou documento, e o preview/ordem da linha não mudou.
   Indício forte: a thread aberta também não atualizou sozinha (item 2) —
   ou seja, **o realtime de `messages` provavelmente não está chegando no
   browser**, em lista E thread.
4. 🔒 Fora da janela de 24h o composer deixa digitar (só bloqueia no envio).
   Operadores limitados vão "conversar com ninguém". Travar o campo.
5. 📋 O picker de templates lista TODOS os aprovados da WABA. Tem que mostrar
   SÓ os 2 de retomada definidos (`retomada_suporte`,
   `retomada_recadastro_pagamento`), sem campos de variável: operador clica,
   template sai preenchido.
6. ↩️ Cadência no histórico: réguas NÃO pararam em 05/06 — **os workflows só
   deixaram de gravar `message_log`**. Não retroalimentar (confunde
   operadoras). Já desligado por flag; religar SÓ quando o motor v2 popular
   `disparos_log`, com corte de data (nunca mostrar passado).

## Execução (ordem recomendada)

### A. Investigar realtime quebrado (causa raiz dos itens 2 e 3) — PRIMEIRO

Hipóteses, em ordem de probabilidade:

1. **RLS × Realtime**: `postgres_changes` só entrega a linha se o subscriber
   passar na policy de SELECT. A policy de `messages` usa subquery em
   `conversations` (`chat_user_has_unit`); avaliação por evento pode estar
   falhando/estourando timeout silenciosamente no worker do Realtime.
2. **Subscribe falhando silencioso**: nem `inbox-workspace.tsx` nem
   `thread-client.tsx` passam callback de status no `.subscribe()`. Adicionar
   `subscribe((status, err) => console.log(...))` e olhar o console:
   `CHANNEL_ERROR`/`TIMED_OUT` confirmam.
3. Publication: `alter publication supabase_realtime` deve conter
   `conversations` e `messages` (docs/03 diz que sim — CONFERIR no banco:
   `select * from pg_publication_tables where pubname='supabase_realtime'`).

Teste objetivo: logado como operador, abrir console, inserir uma message de
teste via SQL na conversa do Victor e ver se o evento chega.

**Plano B (robusto, vale fazer mesmo se o realtime voltar)**: polling de
fallback — na lista, `router.refresh()` a cada 60s quando a aba está visível
(`document.visibilityState`); na thread, refetch leve das messages da conversa
aberta a cada 30s. Realtime vira acelerador, não dependência.

### B. Bolha do anexo "não disponível" no pós-envio

Causas no código atual (`thread-client.tsx` / `composer-bar.tsx`):

- O otimista de mídia não tem entrada em `mediaUrls` → `media = {url: null,
  pending: false}` → renderiza "não disponível" (deveria ser spinner).
- O response de `/api/messages/media` JÁ devolve `storage_path`, mas o client
  não usa — fica esperando realtime (que está quebrado, item A).
- Race de eco: o INSERT realtime pode chegar ANTES do response HTTP → como o
  temp ainda não tem `wa_message_id`, não casa por `byWaId` nem `byId` →
  bolha duplicada.

Fix:
1. `appendOptimistic`: se `MEDIA_TYPES.has(msg.type)`, setar
   `mediaUrls[tempId] = { url: null, pending: true }` (spinner).
2. No `r.ok` do `sendMedia`: pegar `storage_path` do response e resolver a
   signed URL na hora (`createMediaSignedUrl` com client browser) →
   `setMediaUrls`/patch — bolha renderiza sem depender de realtime. Expor um
   callback `onMediaResolved(tempId, url)` do ThreadClient pro ComposerBar
   (ou mover o resolve pro ThreadClient via patch).
3. Dedupe de eco: no handler de INSERT, antes de append, se existir mensagem
   `pending` do mesmo operador+type sem `wa_message_id` criada há <30s,
   fazer merge nela em vez de append.

### C. Travar composer fora da janela 24h

`composer-bar.tsx`:
- `disabled={!insideWindow || sending}` no Textarea (hoje só `sending`).
- `insideWindow` precisa TICKAR: hoje é `useMemo` estático do page load — se a
  janela expira com a conversa aberta, o campo continua liberado. Reusar o
  ticker de 60s que já existe (`tick`) no cálculo.
- Manter botão de templates ativo (único caminho fora da janela) e o banner
  vermelho existente.
- Caso de hoje: janela LOCAL aberta (DB) mas Meta recusou (estado divergente,
  conversa reaberta por SQL). Tratar erro Graph `131047`/`131026` no 502 do
  send/media como out-of-window: mesma UX do 409 (toast + abrir picker), e
  idealmente zerar `customer_window_expires_at` da conversa via server pra
  realinhar o estado.

### D. Picker de retomada (só os 2 templates, 1 clique)

- `/api/templates/route.ts`: novo modo `?purpose=reopen` →
  `template_name LIKE 'retomada_%'` + `status='APPROVED'` +
  `paused_by_sentinel IS NOT TRUE`, mais recente por "base" (o Sentinel cria
  variações tipo `retomada_suporte_s1_1781042898` quando a Meta reclassifica —
  caso real: Porto Alegre, WABA 607576795368419. Resolver "base" por prefixo:
  `retomada_suporte*` → Suporte, `retomada_recadastro_pagamento*` → Recadastro).
- `template-picker.tsx`: virar picker de retomada — 2 cards fixos
  ("Retomar atendimento — Suporte" / "Retomar — Recadastro de pagamento") com
  preview do corpo, SEM inputs de variável: `{{1}}` = primeiro nome do contato
  (nome validado da conversa; fallback: string vazia não pode — usar "tudo
  bem?" não, usar primeiro nome do WhatsApp ou "cliente"). Clique único envia
  (`components: [{type:'body', parameters:[{type:'text', text: firstName}]}]`).
  Os templates têm botão quick-reply "Continuar atendimento" — não precisa de
  parâmetro.
- O picker hoje recebe `wabaId` — manter; só muda a query e a UI.

### E. Cadência no histórico — recondicionar (depois, baixa prioridade)

- Manter `SHOW_CADENCE_HISTORY=false` até o motor v2 popular `disparos_log`
  (estava vazio em 2026-06-10; réguas atuais disparam SEM log).
- Ao religar: adicionar parâmetro de corte na RPC `chat_cadence_history`
  (ex.: `and sent_at >= '<data go-live motor v2>'`) pra NUNCA puxar
  retroativo. A RPC já lê as duas fontes (message_log + disparos_log) e já
  devolve `example` pro preenchimento de variáveis (nome/matrícula reais,
  valor vira ‹valor› — implementado em `fillTemplateBody` no page.tsx).

## Infra/gotchas pra próxima sessão (não tropeçar)

- Repo: `~/servidor/chat-cdt` (fork 7Beeai/chat-cdt). Push na main →
  GitHub Actions → deploy na VPS (PM2 `chat-cdt`, porta 3007, nginx com
  `client_max_body_size 25m`).
- Build local ANTES de push: `node_modules/.bin/next build` (pnpm 11 barra
  scripts; NÃO mexer no pnpm-workspace.yaml).
- SQL no Supabase: Management API com PAT de
  `~/servidor/clients/cpt-ibirite/dashboard/revenuepulse-board/.env.supabase`
  (`set -a; source ...` para exportar). Corpo via arquivo (`-d @/tmp/q.json`)
  — `.in()`/URLs grandes morrem (lição 2× no mesmo dia).
- `template_inventory`: a coluna é `template_name`, NÃO `name`.
- Funções já em produção (migration 0019): `chat_conversation_previews`,
  `chat_conversation_trilhos`, `chat_debtor_context` (estendida),
  `chat_cadence_history`. Índices: `idx_ml_unit_matchkey`,
  `idx_dl_unit_matchkey`.
- Conversa de teste do Victor: `51b047dc-852f-4f05-bb9a-f960a4ece724`
  (Ibirité, wa_id 553198923636; número da unidade 5531933013848). Janela Meta
  real exige inbound dele — mandar "oi" antes de testar free-form.
