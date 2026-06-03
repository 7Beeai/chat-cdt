# chat_webhook_events

## Identificação
- **Nome**: `public.chat_webhook_events`
- **Dono provável**: CHAT-CDT (prefixo `chat_`; criada em `migrations/0001_init.sql`, retenção em `0004_webhook_events_retention.sql`).
- **Linhas estimadas**: ~17.296 (`n_live_tup=17296`; `linhas_estimadas=16849`; `n_tup_ins=4734` na janela; `n_tup_upd=0`, `n_tup_del=0` na janela mas há purge diário). `last_autoanalyze=2026-06-01`.
- **Tamanho**: **19 MB** total (heap 17 MB). É a maior das 7 tabelas desta lista.
- **Classificação**: **CHAT-CDT** (audit log / deny-all de webhooks da Meta).
- **Bloat**: ~17 MB heap / ~17k linhas ≈ **~1 KB/linha** — esperado (cada linha é um payload JSONB de inbound da Meta). O design 0004 mira "~10 MB estável"; está em 19 MB, **acima da meta** — ver Observações.

## Finalidade
Audit log bruto dos webhooks da Meta, para replay/depuração. Por decisão de custo (0004), o handler **só persiste inbound real de cliente** (descarta ~91% que são status updates) e um pg_cron diário apaga o que tiver > 7 dias (janela de retry da Meta). Acesso de leitura é **deny-all** — é uma tabela de "caixa preta" só acessível por `service_role`.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | PK | confirmado |
| 2 | app_event_id | text | YES | — | **nenhum writer** — o INSERT do app grava só `payload` | **sem consumidor identificado**; índice `_app_event_id_idx` NUNCA USADO | confirmado (insert PostgREST `("payload")`; `n_tup_upd=0`) |
| 3 | payload | jsonb | NO | — | app `meta/webhook` (`.insert({ payload: body })`) | nenhum reader de aplicação; `chat_purge_webhook_events` filtra por `received_at`, não lê payload | confirmado (app + def da função purge) |
| 4 | received_at | timestamptz | NO | `now()` | default | **lido pelo purge**: `delete where received_at < now()-7d`; índices `_received_at_idx` e `pkey` | confirmado (`functions-analysis` write delete columns:[received_at]; def da função) |

`pos` 1..4 contínuos — **nenhuma coluna droppada**. **Nenhuma coluna com espaço.**

## Relacionamentos (FKs)
Nenhuma FK (entrada nem saída). Tabela isolada, append-only.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| `chat_webhook_events_pkey` | `unique(id)` | 2 | 640 kB |
| `chat_webhook_events_received_at_idx` | `(received_at DESC)` | 2 | 760 kB |
| `chat_webhook_events_app_event_id_idx` | `(app_event_id)` | **0** | 192 kB |

### Índices nunca usados (idx_scan=0)
`chat_webhook_events_app_event_id_idx` = **~192 kB desperdiçados**. Indexa a coluna `app_event_id`, que **não tem writer** (sempre NULL) e **nenhum leitor** — índice 100% inútil no estado atual. Candidato direto a drop (junto com a coluna, ou ambos preservados se houver plano de dedupe por event id).

## Triggers
Nenhum (bloco-06 vazio).

## RLS / Policies
- RLS **ON**. 1 policy, **sem sobreposição**.
- `chat_webhook_events_deny_all` (ALL, public): `using (false) with check (false)`. **Deny-all total**: ninguém via PostgREST/anon/authenticated lê ou escreve. As gravações vêm do `service_role` (bypassa RLS), conforme intenção de "caixa preta".

## Quem escreve / Quem lê
- **Escreve**: `app/api/meta/webhook/route.ts` — `.from('chat_webhook_events').insert({ payload: body })`, **somente quando há inbound real** (`hasInboundMessages()`). Confirmado também no stat: INSERT PostgREST `INSERT INTO chat_webhook_events("payload")` com **4.735 calls** (bloco-10b) — bate com `n_tup_ins=4734`.
- **"Lê"/apaga**: `chat_purge_webhook_events()` (`functions-analysis`: write `delete`, columns `[received_at]`, `confidence:confirmado`) via pg_cron `chat_purge_webhook_events_daily` (`0 3 * * *`, jobid 11, 5 runs succeeded — bloco-11). Não lê `payload`, só filtra por `received_at`.
- **Nenhum reader de payload**: não aparece em edge, n8n, views nem em SELECTs do stat. O propósito de replay é manual/ad-hoc.

## Observações
- **Headline**: `app_event_id` é coluna **sem origem (nunca escrita)** E carrega um **índice NUNCA USADO** (`_app_event_id_idx`, 192 kB) sobre ela. Dois desperdícios sobrepostos na mesma coluna. Provavelmente provisão para dedupe idempotente que nunca foi ligada no handler.
- **Tamanho acima da meta**: 0004 projetava "~10 MB estável"; está em **19 MB**. Possíveis causas: purge só de 7 dias com ~4.7k inserts/janela de ~13h (taxa alta de inbound), ou inbounds maiores que o previsto. Não é bloat de dead-tuples (`n_dead_tup=0`); é volume real dentro da janela de 7 dias. Vale revisar se a meta de 10 MB ainda é realista ou reduzir a retenção.
- Design de custo bem documentado (0004) e funcionando: filtro no handler + purge cron ativo. Coerência doc↔banco **confirmada** (função e cron existem como descrito).
