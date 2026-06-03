# chat_phone_numbers

## Identificação
- **Nome**: `public.chat_phone_numbers`
- **Dono provável**: CHAT-CDT (prefixo intencionalmente **sem** `chat_` no registry seria colisão; aqui é `chat_phone_numbers`, criada em `migrations/0001_init.sql`).
- **Linhas estimadas**: **registry pequeno** — `n_live_tup=-1`, `linhas_estimadas=-1`, `last_analyze=null` (ANALYZE nunca rodou). NÃO é zero: `phone_number_id_key` teve `idx_tup_read=88735` e `pkey idx_tup_read=1073`; trata-se de poucas linhas (1 número por WABA cadastrado) lidas dezenas de milhares de vezes.
- **Tamanho**: 48 kB total (heap 8 kB).
- **Classificação**: **CHAT-CDT** (registry de números de telefone Meta).
- **Bloat**: nenhum.

## Finalidade
Registry que mapeia o `phone_number_id` da Graph API da Meta para a WABA (`waba_id`) — e via ela, para a `unit`. É a porta de entrada de todo webhook: ao receber um inbound, o handler resolve `phone_number_id → unit_id` por aqui. Também usado pela RPC `chat_record_outbound_message` para registrar mensagens de saída do n8n/IA.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | PK; FK destino de `conversations.phone_number_id`; lido por `chat_record_outbound_message` e webhook (embed PostgREST) | confirmado |
| 2 | waba_id | uuid | NO | — | seed/cadastro manual (0002 comentado; insert via SQL/MCP) | FK→`wabas.id`; join no webhook (`wabas!inner`) e na RPC; usado pela policy RLS | confirmado (`functions-analysis`, query do stat) |
| 3 | phone_number_id | text | NO | — | cadastro manual (valor da Graph API) | **chave de busca dominante**: webhook `eq('phone_number_id', …)` e RPC `where cpn.phone_number_id=p_phone_number_id`; índice unique `_phone_number_id_key` (idx_scan=93835) | confirmado (def RPC + query stat 89.373 calls) |
| 4 | display_phone | text | YES | — | cadastro manual (ex.: `+55 31 ...`) | sem consumidor identificado (não aparece em RPC/app/webhook reads) | inferido (origem por seed comentado 0002; nenhum reader) |
| 5 | quality_rating | text | YES | — | desconhecida (campo de qualidade Meta; nenhum writer no repo) | sem consumidor identificado | inferido (sem writer e sem reader encontrados) |
| 6 | created_at | timestamptz | NO | `now()` | default | sem consumidor identificado | confirmado (origem) |

`pos` 1..6 contínuos — **nenhuma coluna droppada**. **Nenhuma coluna com espaço.**

## Relacionamentos (FKs)
- `waba_id` → `wabas.id` (`ON DELETE CASCADE`).
- **Destino de FK**: `conversations.phone_number_id` → `chat_phone_numbers.id` (`ON DELETE NO ACTION`).

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| `chat_phone_numbers_phone_number_id_key` | `unique(phone_number_id)` | **93835** | 16 kB |
| `chat_phone_numbers_pkey` | `unique(id)` | 1061 | 16 kB |

### Índices nunca usados (idx_scan=0)
Nenhum. Ambos os índices são quentes. **0 kB desperdiçados.**

## Triggers
Nenhum (bloco-06 vazio).

## RLS / Policies
- RLS **ON**. 1 policy, **sem sobreposição**.
- `chat_phones_select` (SELECT, public): `EXISTS (SELECT 1 FROM wabas w WHERE w.id = waba_id AND chat_user_has_unit(w.unit_id))`. Operador só enxerga números das WABAs da própria unidade.
- Sem policy de escrita → cadastro só por `service_role`/MCP. O webhook lê via `service_role` (bypassa RLS).

## Quem escreve / Quem lê
- **Escreve**: cadastro manual / `service_role` (seed 0002 está comentado; inserts feitos via SQL/MCP). Nenhum writer automatizado no app/funcs.
- **Lê** (confirmado):
  - **Webhook handler** `app/api/meta/webhook/route.ts`: `.from('chat_phone_numbers').select('id, waba_id, wabas!inner(unit_id)').eq('phone_number_id', …)`. Esta é a **query dominante do banco inteiro na janela**: 89.373 calls, `mean_ms=0.05` (bloco-10b) — explica `idx_scan` de 94k. Roda a cada inbound da Meta.
  - **RPC** `chat_record_outbound_message` (`functions-analysis`: read `id, phone_number_id, waba_id`, `confidence:confirmado`): join `chat_phone_numbers → wabas` para achar `unit_id` ao registrar saída.

## Observações
- A tupla **webhook embed phone→`wabas!inner`** (89.373 chamadas) é o consumidor número 1 do banco no snapshot; `chat_phone_numbers` + `wabas` herdam daí seus altíssimos `idx_scan`. Tabela minúscula, leitura massiva, latência ínfima — saudável.
- **`display_phone` e `quality_rating` sem leitor**: `display_phone` é apenas rótulo humano cadastrado; `quality_rating` não tem nem writer nem reader no repositório (provável placeholder para futura sincronização do health da Meta). Marcadas `sem consumidor identificado`.
- `linhas_estimadas=-1` + `last_analyze=null`: estatísticas de ANALYZE ausentes — **não** interpretar como tabela vazia.
