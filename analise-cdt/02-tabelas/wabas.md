# wabas

## Identificação
- **Nome**: `public.wabas`
- **Dono provável**: CHAT-CDT (sem prefixo `chat_` por **não colidir** com tabelas do n8n — exceção documentada no CLAUDE.md, ao lado de `contacts`/`conversations`/`messages`). Criada em `migrations/0001_init.sql`.
- **Linhas estimadas**: **registry pequeno** — `n_live_tup=-1`, `linhas_estimadas=-1`, `last_analyze=null` (ANALYZE nunca rodou). NÃO é zero: `wabas_pkey idx_scan=88931`, `idx_tup_read=88931`; poucas linhas (1 por WABA/unidade) lidas dezenas de milhares de vezes.
- **Tamanho**: 48 kB total (heap 8 kB).
- **Classificação**: **CHAT-CDT** (registry de WhatsApp Business Accounts).
- **Bloat**: nenhum.

## Finalidade
Registry das WABAs (WhatsApp Business Accounts) por unidade: cada linha amarra um `waba_id` (Graph API) e opcionalmente `business_id`/`name` à `unit_id`. É o nó intermediário da cadeia `phone_number_id → waba → unit` usada para resolver a unidade de cada inbound e de cada saída registrada.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | PK (idx_scan=88931); destino de FK `chat_phone_numbers.waba_id`; join no webhook e na RPC outbound | confirmado |
| 2 | unit_id | uuid | NO | — | seed/cadastro manual (0002 comentado; insert via SQL/MCP) | FK→`units.id`; **lido por `chat_record_outbound_message`** (`w.unit_id`) e pelo webhook (`wabas!inner(unit_id)`); chave da policy RLS | confirmado (`functions-analysis` read `[id,unit_id]`; query stat) |
| 3 | waba_id | text | NO | — | cadastro manual (valor Graph API) | índice unique `wabas_waba_id_key` (idx_scan=3); usado no `on conflict (waba_id)` do seed | inferido (origem confirmada; reader só pelo unique de upsert, idx_scan baixo) |
| 4 | business_id | text | YES | — | cadastro manual (opcional) | sem consumidor identificado | inferido (sem reader encontrado) |
| 5 | name | text | YES | — | cadastro manual (ex.: `'CDT Cobrança'`) | sem consumidor identificado (rótulo humano; nenhum reader em app/funcs/views) | inferido (origem por seed comentado; sem reader) |
| 6 | created_at | timestamptz | NO | `now()` | default | sem consumidor identificado | confirmado (origem) |

`pos` 1..6 contínuos — **nenhuma coluna droppada**. **Nenhuma coluna com espaço.**

## Relacionamentos (FKs)
- `unit_id` → `units.id` (`ON DELETE CASCADE`). WABAs somem com a unidade (tenant).
- **Destino de FK**: `chat_phone_numbers.waba_id` → `wabas.id` (`ON DELETE CASCADE`).

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| `wabas_pkey` | `unique(id)` | 88931 | 16 kB |
| `wabas_waba_id_key` | `unique(waba_id)` | 3 | 16 kB |

### Índices nunca usados (idx_scan=0)
Nenhum. `wabas_waba_id_key` é pouco usado (idx_scan=3, só no upsert de cadastro), mas **não** zerado. **0 kB desperdiçados.**

## Triggers
Nenhum (bloco-06 vazio).

## RLS / Policies
- RLS **ON**. 1 policy, **sem sobreposição**.
- `chat_wabas_select` (SELECT, public): `chat_user_has_unit(unit_id)`. Operador só vê WABAs da própria unidade. Sem policy de escrita → cadastro por `service_role`/MCP.

## Quem escreve / Quem lê
- **Escreve**: cadastro manual / `service_role` (seed 0002 comentado; inserts via SQL/MCP). Sem writer automatizado.
- **Lê** (confirmado):
  - **Webhook handler** (`app/api/meta/webhook/route.ts`): join `chat_phone_numbers ... wabas!inner(unit_id)`. Faz parte da **query dominante do banco** (89.373 calls, bloco-10b) — explica o `idx_scan=88931` do pkey.
  - **RPC** `chat_record_outbound_message` (`functions-analysis`: read `wabas [id, unit_id]`, `confidence:confirmado`): `join public.wabas w on w.id = cpn.waba_id` para obter `unit_id`.
- Não aparece em edge/n8n/views como reader próprio (só via o embed do webhook).

## Observações
- `wabas` + `chat_phone_numbers` compartilham a mesma query quente (resolução `phone_number_id → unit` por inbound). Os 88.931 idx_scans vêm **majoritariamente** desse embed, não de acesso direto.
- **`business_id` e `name` sem leitor**: metadados/rótulo do cadastro Meta; nenhum consumidor no repositório. Marcados `sem consumidor identificado` (não "mortos").
- `linhas_estimadas=-1` + `last_analyze=null`: estatísticas ausentes — **não** é tabela vazia. Considerar rodar `ANALYZE` para o planner.
- Convivência com n8n: nome sem prefixo é proposital (não colide). Tabela é do CHAT-CDT, não do fluxo de cobrança.
