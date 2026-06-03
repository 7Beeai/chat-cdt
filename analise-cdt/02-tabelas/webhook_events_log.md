# webhook_events_log

## Identificação
- **Nome**: `public.webhook_events_log`
- **Dono provável**: Cobrança / infra de gateways de pagamento (NÃO é do CHAT-CDT; CHAT-CDT mantém seu próprio audit em `chat_webhook_events`, ver `0001_init.sql` linhas 9-11 e 122-123, e `docs/03-database.md:23`).
- **Linhas**: contradição entre estatísticas. `linhas_estimadas` (reltuples) = **20.111**; `n_live_tup` = **383**. As estatísticas estão obsoletas (`last_analyze`/`last_autoanalyze` = null), então nenhum dos dois é confiável; o volume real provável está na casa das **dezenas de milhares** (consistente com 380 inserts só na janela de ~13h do snapshot e com o tamanho de disco). Fonte: bloco-01.
- **Tamanho**: 53 MB total / 10 MB heap → ~43 MB são TOAST (a coluna `payload` jsonb). Fonte: bloco-01.
- **Classificação**: **Cobrança / Compartilhada** (audit transversal de webhooks de pagamento + eventos Meta/WABA).
- **Alerta de bloat**: 53 MB para ~20k linhas ≈ 2,6 KB/linha — alto, dominado pelo `payload` jsonb (TOAST ~43 MB). `n_tup_del=0` e nenhum job de limpeza/TTL encontrado → **crescimento ilimitado**. Ver Observações.

## Finalidade
Log de auditoria de eventos recebidos via webhook/HTTP, gravado pelas Edge Functions de gateway de pagamento (woovi, stripe, abacate), pelas funções de reconciliação por pulling e pela RPC `record_meta_account_event` (eventos de conta/WABA da Meta). Serve de trilha de defesa-em-profundidade: a `stripe-webhook` e outras logam o evento **antes** de validar assinatura (edge-functions notes [6]). O `processed`/`error` registram o resultado do processamento. Apesar do COMMENT/doc dizerem "do n8n", os escritores reais são Edge Functions Supabase e uma RPC — não o n8n. É um audit log **geral de webhooks**, não exclusivo de cobrança.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval(webhook_events_log_id_seq)` | sequence/default | woovi/stripe/abacate-webhook (select/update por id), notify-orphan-email (select); PK. | confirmado (edge-functions ops) |
| 2 | source | text | NO | — | App: cada writer escreve seu identificador (`woovi`/`stripe`/`abacate`/reconcile/`meta`...) | lido por notify-orphan-email (select) e por query ad-hoc do stat | confirmado (writer único por função; edge-functions columns) |
| 3 | event_type | text | YES | — | App: writers (ex.: `OPENPIX:CHARGE_COMPLETED`, `charge.refunded`, eventos Meta) | PostgREST select (stat, calls=515), notify-orphan-email | confirmado (edge-functions) |
| 4 | correlation_id | text | YES | — | App: writers (id da cobrança/charge; p/ Stripe é UUID interno) | process-reembolso (select), woovi/stripe/abacate-webhook (select), query ad-hoc do stat | confirmado (edge-functions) |
| 5 | unit_code | text | YES | — | App: generate-payment-link(-abacate), woovi/stripe/abacate-webhook (insert/update) | RLS `health_select_webhook_events` usa em `user_can_read_unit_code(unit_code)` | confirmado (edge-functions + policy) |
| 6 | payload | jsonb | YES | — | App: writers gravam o corpo bruto do webhook | PostgREST select (stat), query ad-hoc faz `payload::text ilike` | confirmado (edge-functions + stat) |
| 7 | processed | boolean | YES | `false` | App: writers (insert) e webhooks/reconcile (update) | índice parcial `idx_webhook_events_unprocessed`; UPDATE via PostgREST (stat, calls=378) | confirmado (edge-functions + stat) |
| 8 | error | text | YES | — | App: writers gravam mensagem de erro de processamento | leitura humana/diagnóstico; sem leitor automatizado dedicado identificado | inferido (escrito por woovi/stripe/abacate; nenhum leitor de `error` isolado) |
| 9 | created_at | timestamptz | YES | `now()` | default | process-reembolso, notify-orphan-email, PostgREST `order by created_at desc` | confirmado (edge-functions + stat) |

Sem gaps de ordinal (9 colunas contíguas) — nenhuma coluna droppada.

## Relacionamentos (FKs)
Nenhuma FK (nem como origem nem como destino) — bloco-03 não retornou linhas. Vínculo com cobrança é lógico via `correlation_id`/`unit_code`, não referencial.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| webhook_events_log_pkey | UNIQUE btree(id) | 386 | 770 KB |
| idx_webhook_events_correlation | btree(correlation_id) | **0** | 1,7 MB |
| idx_webhook_events_unprocessed | btree(processed) WHERE processed=false | **0** | 104 KB |

### Índices nunca usados (idx_scan=0)
- `idx_webhook_events_correlation` (1,7 MB) — além de nunca usado, é **inutilizável pela própria query que justificaria sua existência**: a busca por correlation_id no stat é `WHERE correlation_id=$1 OR payload::text ilike $2 OR payload::text ilike $3` — o `OR` sobre `payload::text` força seq scan e anula o índice.
- `idx_webhook_events_unprocessed` (104 KB) — índice parcial nunca usado; o UPDATE de `processed` é feito por id (via PostgREST), não varrendo pendentes.
- **Desperdício total: ~1,8 MB.**

## Triggers
Nenhum trigger nesta tabela (bloco-06 não retornou linhas).

## RLS / Policies
RLS **ON** (não forçado). Duas policies, ambas PERMISSIVE para SELECT:
- `Authenticated users can read webhook logs` — roles `authenticated`, `qual = true`.
- `health_select_webhook_events` — roles `authenticated`, `qual = (unit_code IS NULL OR user_can_read_unit_code(unit_code))`.

⚠ **Policies sobrepostas / restrição morta**: policies PERMISSIVE são combinadas por **OR**. Como a primeira tem `qual = true`, ela **anula completamente** o escopo por unidade da `health_select_webhook_events`. Qualquer usuário autenticado lê todas as linhas, de todas as unidades. O scoping por `unit_code` está efetivamente morto. Inserts/updates não têm policy (feitos por service_role nas Edge Functions, que ignoram RLS).

## Quem escreve / Quem lê
**Escrevem (todos via SERVICE_ROLE, ignorando RLS):**
- Edge Functions de gateway: `woovi-webhook` (insert/select/update), `stripe-webhook` (insert/select/update), `abacate-webhook` (insert/update), `generate-payment-link` (insert), `generate-payment-link-abacate` (insert), `process-payouts` (insert) — edge-functions.json, confidence `confirmado`.
- Edge Functions de reconciliação: `reconcile-woovi-pull`, `reconcile-stripe-pull`, `reconcile-abacate-pull` (insert).
- RPC `record_meta_account_event` (insert de source/event_type/correlation_id/payload/processed/error) — functions-analysis, `confirmado`. Loga eventos de conta/WABA da Meta.
- Confirmado no stat: INSERT via PostgREST (calls=380) e UPDATE de `processed`+`unit_code` (calls=378).

**Leem:**
- `process-reembolso` (insert+select), `notify-orphan-email` (select+insert) — edge-functions.
- Stat: SELECT via PostgREST (calls=515 e 44) e query ad-hoc por correlation_id (calls=1).

## Observações
- **Crescimento ilimitado**: sem TTL/cleanup, `n_tup_del=0`, `payload` jsonb gera ~43 MB de TOAST sobre ~10 MB de heap. Candidato número 1 a política de retenção/particionamento nesta lista.
- **Contradição doc↔banco**: `docs/03-database.md:23` e `0001_init.sql` afirmam que é "audit do webhook do n8n". Na prática os escritores são Edge Functions Supabase (gateways de pagamento) e a RPC `record_meta_account_event` (Meta/WABA). É um audit de webhooks **geral**, não do n8n. Avaliar como impreciso.
- **Risco de segurança**: a policy `qual=true` torna o log inteiro legível por qualquer autenticado, anulando o isolamento por unidade pretendido (ver RLS acima).
- **Estatísticas obsoletas**: `last_analyze`/`last_autoanalyze` null; reltuples (20.111) vs n_live_tup (383) divergem ~50x. Rodar `ANALYZE` para confiar em planos.
