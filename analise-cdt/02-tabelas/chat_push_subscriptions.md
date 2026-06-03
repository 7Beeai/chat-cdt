# chat_push_subscriptions

## Identificação
- **Nome**: `public.chat_push_subscriptions`
- **Dono provável**: CHAT-CDT (prefixo `chat_`; criada em `migrations/0001_init.sql`).
- **Linhas estimadas**: ~1 (`n_live_tup=1`, `n_tup_ins=1`; `linhas_estimadas=-1`, ANALYZE nunca rodou). Poucas linhas (1 por par usuário×device).
- **Tamanho**: 48 kB total (heap 8 kB).
- **Classificação**: **CHAT-CDT** (Web Push fanout).
- **Bloat**: nenhum.

## Finalidade
Armazena as Web Push subscriptions (endpoint + chaves VAPID `p256dh`/`auth`) de cada operador/device, para notificar handoff de conversa enfileirada. Gravada pela rota de subscribe do PWA e lida pela rota interna de fanout que dispara as notificações via `web-push`.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | PK; lido em `notify` (`select 'id'`) para deletar subscription stale | confirmado (app `notify/route.ts`) |
| 2 | user_id | uuid | NO | — | app `push/subscribe` (`user.id` = `auth.uid()`) | FK→`auth.users`; filtro de leitura `.in('user_id', authUserIds)`; chave da policy `(user_id = auth.uid())`; índice unique `(user_id, endpoint)` | confirmado (app subscribe+notify) |
| 3 | endpoint | text | NO | — | app `push/subscribe` (corpo validado por zod `z.string().url()`) | lido em `notify` (`select endpoint`) e usado no `.eq('endpoint', …)` do delete | confirmado (app) |
| 4 | p256dh | text | NO | — | app `push/subscribe` (`keys.p256dh`) | lido em `notify` (`select p256dh`) → payload do `web-push` | confirmado (app) |
| 5 | auth | text | NO | — | app `push/subscribe` (`keys.auth`) | lido em `notify` (`select auth`) → payload do `web-push` | confirmado (app) |
| 6 | user_agent | text | YES | — | app `push/subscribe` (`userAgent ?? null`) | **sem consumidor identificado** (gravado, nunca lido) | confirmado (escrita); sem reader |
| 7 | created_at | timestamptz | NO | `now()` | default | sem consumidor identificado | confirmado (origem) |

`pos` 1..7 contínuos — **nenhuma coluna droppada**. **Nenhuma coluna com espaço.**

## Relacionamentos (FKs)
- `user_id` → `users.id` (`auth.users`) (`ON DELETE CASCADE`). Apaga subscriptions quando o usuário é removido.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| `chat_push_subscriptions_pkey` | `unique(id)` | 2 | 16 kB |
| `chat_push_subscriptions_user_id_endpoint_key` | `unique(user_id, endpoint)` | 1 | 16 kB |

### Índices nunca usados (idx_scan=0)
Nenhum (ambos com idx_scan ≥ 1; o unique de `(user_id,endpoint)` sustenta o `onConflict` do upsert). **0 kB desperdiçados.**

## Triggers
Nenhum (bloco-06 vazio).

## RLS / Policies
- RLS **ON**. 1 policy, **sem sobreposição**.
- `chat_push_self` (ALL, public): `using (user_id = auth.uid())` e `with check (user_id = auth.uid())`. Cada usuário só CRUDa as próprias subscriptions — correto para o subscribe via cliente autenticado.
- A rota `notify` lê via `service_role` (bypassa RLS) para fazer fanout cross-user dentro da unidade.

## Quem escreve / Quem lê
- **Escreve**: `app/api/push/subscribe/route.ts` — `upsert` (`onConflict: 'user_id,endpoint'`) com `user_id, endpoint, p256dh, auth, user_agent`; e `delete` no unsubscribe (`.eq(user_id).eq(endpoint)`).
- **Lê**: `app/api/internal/push/notify/route.ts` — `select('id, endpoint, p256dh, auth').in('user_id', authUserIds)`; em erro 404/410 do push, faz `delete` da subscription stale por `id`.
- Não aparece em `functions-analysis`, edge, n8n, views nem stat (10a/10b = 0) — o caminho é 100% app-level (Next.js), não SQL/RPC.

## Observações
- **`user_agent` é write-only**: gravado no subscribe, nunca lido em lugar nenhum. Telemetria/diagnóstico latente — `sem consumidor identificado`.
- O par disparador no banco é o trigger `chat_notify_handoff` (em `conversations`), que faz `net.http_post` para `/api/internal/push/notify`; esta tabela só é tocada **depois**, dentro da rota Next.js. Por isso não há rastro em pg_stat (o SELECT roda no pooler do app, e a janela teve só 1 linha/1 subscriber).
- Estado inicial (1 subscriber) — feature recém-ligada; volume crescerá com adesão dos operadores.
