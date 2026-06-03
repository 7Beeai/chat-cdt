# todos

## Identificação
- **Nome**: `public.todos`
- **Dono provável**: **Nenhum do CHAT-CDT** — sem prefixo `chat_`, **sem migration** em `infra/supabase/migrations/` e **sem referência** em `app/`/`lib/`/`infra/`. Padrão de tabela de demo/quickstart do Supabase (ou resíduo de teste anterior). Não pertence ao fluxo de cobrança do n8n nem ao CHAT-CDT.
- **Linhas estimadas**: **0** (`n_live_tup=0`, `n_tup_ins=0`, `linhas_estimadas=-1`, `last_analyze=null`). Heap = **0 bytes**. Vazia.
- **Tamanho**: 8192 bytes (só a página inicial vazia + PK).
- **Classificação**: **Morta/Backup** (tabela de teste/demo vazia, sem schema útil).
- **Bloat**: N/A (vazia).

## Finalidade
Sem finalidade ativa no projeto. Tem apenas `id` + `created_at` — nem coluna de conteúdo (`task`/`title`/`done`). Vazia e nunca escrita. Compatível com o template "Quickstart: Todo List" do Supabase, deixado para trás. **Nenhuma evidência de uso real.**

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | — (nenhum default visível) | desconhecida (sem default/sequence visível no dump; tabela nunca recebeu insert) | sem consumidor identificado | confirmado (vazia; sem reference no repo) |
| 2 | created_at | timestamptz | NO | `now()` | default | sem consumidor identificado | confirmado |

`pos` 1..2 contínuos — **nenhuma coluna droppada**. **Nenhuma coluna com espaço.**

> Nota: `id` é `bigint NOT NULL` mas `column_default` veio **nulo** no bloco-02 — **não há identity/sequence visível** neste snapshot. Não afirmo `GENERATED`/`serial` que não consigo comprovar. Como a tabela está vazia, é inconsequente.

## Relacionamentos (FKs)
Nenhuma FK (entrada nem saída). Tabela isolada.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| `todos_pkey` | `unique(id)` | 1 | 8192 |

### Índices nunca usados (idx_scan=0)
Nenhum formalmente zerado (pkey idx_scan=1 — provavelmente uma sondagem de introspecção). **0 kB de desperdício relevante** (tabela vazia).

## Triggers
Nenhum (bloco-06 vazio).

## RLS / Policies
- RLS **ON**. 1 policy, **sem sobreposição**.
- `"Only admins can access todos"` (ALL, public): `has_role((SELECT auth.uid()), 'admin'::app_role)`. Nome de policy com aspas (contém espaços) — estilo "Supabase Dashboard", reforçando origem de demo/console, **não** das migrations versionadas (que usam nomes snake_case sem aspas).

## Quem escreve / Quem lê
- **Escreve**: ninguém (`n_tup_ins=0`, vazia). Nenhum writer no repo.
- **Lê**: **nenhum consumidor identificado**. Os 2 hits em `functions-analysis.json` são **falsos positivos** — a substring "todos" aparece em prosa portuguesa nos campos `purpose`/`notes` de `chat_admin_list_users` ("Lista **todos** os usuarios") e `motor_v2_cancel_future_disparos` ("**todos** os disparos PROGRAMADOS"), não referências à tabela. 0 hits em views/edge/n8n/stat.

## Observações
- **Forte candidata a DROP.** Vazia, sem schema útil, sem migration, sem código, sem consumidor. Provável resíduo de quickstart/teste do Supabase.
- Classificação de **tabela** = `Morta/Backup`; ainda assim, no nível de **coluna**, o rótulo de leitor permanece `sem consumidor identificado` (nunca "morta"), conforme regra.
- A policy admin-only com aspas e o `id bigint` sem default no schema versionado reforçam que **não foi criada pelas migrations do CHAT-CDT** — entrou pelo Dashboard.
