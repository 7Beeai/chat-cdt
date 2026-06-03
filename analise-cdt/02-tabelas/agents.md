# agents

## Identificação

- **Nome:** `public.agents`
- **Dono provável:** **n8n / cobrança** (catálogo de prompts dos agentes de IA). Não aparece em nenhuma migration de `infra/supabase/migrations/` (grep vazio) nem na lista de tabelas que o CHAT-CDT criou em `docs/03-database.md`. A própria CLAUDE.md lista como não-prefixadas só `wabas`, `contacts`, `conversations`, `messages` — `agents` não está lá → não é do CHAT-CDT.
- **Linhas estimadas:** 13 (`n_live_tup=13`, `n_tup_ins=13`, `n_tup_del=0`; bloco-01)
- **Tamanho:** 504 kB total / heap = 8192 bytes (1 página). Fonte: bloco-01.
- **Classificação:** **Cobrança** (catálogo de prompts servindo TANTO o fluxo de cobrança QUANTO o de relacionamento — ver n8n-workflows).
- **Alerta de bloat:** Aparente, **não** patológico. O heap real é 1 página de 8 kB; os ~500 kB são quase todos TOAST do campo `prompt` (prompts longos de LLM) somados a 27 dead tuples nunca vacuumados (`n_dead_tup=27`, `last_vacuum=null`, `last_autovacuum=null`). Os 27 dead = 27 edições in-place de prompt (`n_tup_upd=27`, `n_tup_del=0`). Um `VACUUM`/autovacuum recuperaria espaço; não há bloat estrutural por linha.

## Finalidade

Catálogo dos agentes de IA (LLM) usados pelos workflows n8n. Cada linha é um "persona/prompt" nomeado (PK = `name`, ex.: `rafa_tt` para cobrança Tatuapé, `isa_tt` para relacionamento Tatuapé). Os workflows fazem `SELECT prompt FROM agents WHERE name = '<persona>'` e injetam esse `prompt` no nó "Render Prompt SS" que monta a system message do AI Agent. É a fonte de verdade dos prompts de produção do n8n, fora do versionamento do CHAT-CDT.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | name | text | NO | — | App/operador (catálogo manual; é a PK) | n8n: filtro `name eq 'rafa_tt'` (workflow "CDT Cobrança - Tatuapé-SP") e `name eq 'isa_tt'` (workflow "CDT Relacionamento - Tatuapé"); PostgREST `WHERE agents.name=$1` (3296 calls, bloco-10b) | **confirmado** (n8n-workflows.json reads; bloco-10) |
| 2 | prompt | text | NO | — | App/operador (texto do prompt editado in-place; 27 updates) | n8n: lido no code "Render Prompt SS" em ambos workflows; PostgREST `SELECT prompt FROM agents WHERE name=$1` (688 calls, bloco-10b) | **confirmado** (n8n-workflows.json reads; bloco-10) |
| 3 | unidade | text | YES | — | App/operador (preenchimento manual; sem writer identificado) | **sem consumidor identificado** — só aparece em `SELECT name, unidade, prompt FROM agents` ad-hoc via `pat:3649374` em 2026-06-01 (bloco-10a, 4 + 1 calls), que é inspeção manual via dashboard/PAT, não consumidor de produção. Nenhum workflow n8n, função, edge ou view lê `unidade`. | **inferido** (ausência de leitor em n8n-workflows/functions-analysis/edge-functions/views; só queries manuais no stat) |

Sem gaps de ordinal (pos 1,2,3) → nenhuma coluna droppada.

## Relacionamentos (FKs)

Nenhuma FK (bloco-03 vazio para `agents`, em qualquer direção). `name` é PK natural mas não é referenciada por FK de nenhuma outra tabela — o vínculo persona→workflow é só por string literal nos nós n8n.

## Índices

| índice | tipo | idx_scan | bytes | def |
|--------|------|----------|-------|-----|
| agents_pkey | UNIQUE/PRIMARY | 43 | 16384 | `CREATE UNIQUE INDEX agents_pkey ON public.agents USING btree (name)` |

PK em `name` (texto), não em `id` — a tabela **não tem coluna id**. `idx_scan=43` (usado). `seq_scan=4008` domina (tabela minúscula, planner prefere seq scan), o que é normal e barato em 13 linhas.

### Índices nunca usados (idx_scan=0)

Nenhum. Desperdício = 0 MB.

## Triggers

Nenhum (bloco-06 vazio para `agents`).

## RLS / Policies

- **RLS:** ON (`rls_on=true`, `rls_forced=false`).
- **Policy única:** `Only admins can access agents` — `cmd=ALL`, role `public`, `qual = has_role((SELECT auth.uid()), 'admin'::app_role)`.
- **Ponto de consistência:** a policy é admin-only, mas o n8n lê `agents` pesadamente via PostgREST (3296 + 688 calls). Logo o n8n só consegue ler **bypassando RLS via `service_role`** (service key ignora policies). Isso é coerente e reforça a posse n8n: usuários comuns do app não têm acesso; produção usa service_role.

## Quem escreve / Quem lê

- **Escreve:** nenhum writer programático identificado em functions-analysis, edge-functions ou n8n-workflows. Inserts (13) e updates (27) são manuais/curadoria — provavelmente via dashboard Supabase ou painel n8n. Origem do conteúdo: operação CDT.
- **Lê (produção):** workflows n8n "CDT Cobrança - Tatuapé-SP" e "CDT Relacionamento - Tatuapé" (`name`, `prompt`), via service_role/PostgREST. Volume real confirmado em pg_stat_statements (bloco-10): 3296 calls do `SELECT *` por name e 688 do `SELECT prompt` por name na janela ~13h.
- **Lê (ad-hoc):** PAT `pat:3649374` em 2026-06-01 fez `SELECT name, unidade, prompt` — inspeção manual, não consumidor.

## Observações

- **`unidade` sem consumidor real:** apesar de existir e ter sido lida em queries manuais no dia 2026-06-01, nenhum fluxo de produção a usa. Candidata a coluna vestigial/planejada (talvez para multi-unidade futuro), mas hoje sem leitor.
- **Sem coluna `id`:** PK natural em `name`. Acoplamento persona↔workflow é por string mágica nos nós n8n ('rafa_tt', 'isa_tt') — frágil a renomeação (o evento de rename de 2026-06-01 deixou os backups `agents_bak_*` como prova).
- **Bloat aparente:** ver Identificação — é TOAST de `prompt` + 27 dead tuples sem vacuum; rodar `VACUUM` resolve. Não é bloat por linha.
- **Contradição doc↔banco:** `agents` está **ausente de `docs/`** (não documentada). Como é central para a IA do n8n (prompts de produção), a ausência é uma lacuna de documentação, não uma divergência factual.
- **Versionamento:** prompts de produção vivem só no banco (fora de git/migrations). Risco operacional: edição in-place sem histórico (os 27 updates não deixam trilha além dos backups pontuais).
