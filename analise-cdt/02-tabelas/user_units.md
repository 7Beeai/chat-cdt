# user_units

## Identificação
- **Nome:** `public.user_units`
- **Dono provável:** Compartilhada (tabela de acesso operador→unidade; pré-existente, mas é a que o **CHAT-CDT** usa para escopo de inbox). App escreve nela (admin actions); helpers do chat leem.
- **Linhas estimadas:** ~53 (`linhas_estimadas = 53`, bloco-01). `n_live_tup = 0` e `last_analyze = null` → nunca ANALYZE-ada (53 é estimativa do catálogo, não de stats vivas).
- **Tamanho:** 56 kB total / 8192 bytes heap (bloco-01).
- **Classificação:** **Compartilhada** (auth; consumida pelo CHAT-CDT para escopo de unidade).
- **Bloat:** sem bloat. **ALERTA DE ACESSO:** `seq_scan = 1.219.180` e `idx_scan = 0` (bloco-01) — **100% dos acessos são sequential scan; os 3 índices nunca foram usados.** Em 53 linhas o custo por scan é baixo, mas o padrão (full scan em vez de índice) ecoa o de `user_roles` e indica RLS/joins varrendo a tabela inteira.

## Finalidade
Tabela N:N que liga **operador → unidade**: `(user_id, unit_id)` com PK composta. **`user_id` referencia `profiles.id`** (NÃO `auth.users.id`) — esta é a peculiaridade central. É a fonte de verdade do escopo de unidade do **inbox do CHAT-CDT**, lida via `chat_my_units()` / `chat_user_has_unit()` (helpers SECURITY DEFINER que traduzem a cadeia `auth.uid() → profiles → user_units`).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `user_id` | uuid | NÃO | — | app admin (`applyUnits` insere `{user_id: profileId}`, actions.ts l.52-54); **valor = `profiles.id`** | `chat_my_units` (join `profiles.id = uu.user_id`), `chat_user_has_unit`, `chat_admin_list_users`, `chat_report_attendance`/`overview` (functions-analysis); FK → `profiles.id` (bloco-03) | confirmado |
| 2 | `unit_id` | uuid | NÃO | — | app admin (`applyUnits` insere `{unit_id}`, actions.ts l.54) | `chat_my_units`/`chat_user_has_unit` (devolvem unit_id do escopo), relatórios; FK → `units.id` CASCADE (bloco-03) | confirmado |
| 3 | `created_at` | timestamptz | NÃO | `now()` | default na inserção | sem consumidor identificado (não projetado por nenhum reader) | sem consumidor identificado |

## Relacionamentos (FKs)
- `user_units_user_id_fkey`: `user_id → profiles.id` (ON DELETE CASCADE). **Chave = `profiles.id`, não `auth.users.id`.**
- `user_units_unit_id_fkey`: `unit_id → units.id` (ON DELETE CASCADE).
- PK composta `(user_id, unit_id)`.

## Índices
| índice | único | idx_scan | bytes | nota |
|--------|-------|----------|-------|------|
| `user_units_pkey` (user_id, unit_id) | sim/PK | 0 | 16 kB | nunca usado (mas estrutural) |
| `idx_user_units_user_id` (user_id) | não | 0 | 16 kB | **NUNCA USADO** |
| `idx_user_units_unit_id` (unit_id) | não | 0 | 16 kB | **NUNCA USADO** |

### Índices nunca usados (idx_scan=0)
- **Todos os 3** têm idx_scan 0. `user_units_pkey` é PK (não removível). **Removíveis:** `idx_user_units_user_id` e `idx_user_units_unit_id` (16 kB cada). **Desperdício de disco: ~32 kB (0,03 MB)** — irrelevante em disco; o custo real é que o planner ignora os índices e faz **seq scan** (1,2M no snapshot). Como a tabela tem 53 linhas, o seq scan é barato per-query, mas o volume (1,2M) sugere que toda checagem de escopo varre a tabela. Em 53 linhas, índice não ajudaria muito; o ganho real viria de cortar a *frequência* das checagens (cache no app).

## Triggers
Nenhum (bloco-06 não lista triggers para `user_units`).

## RLS / Policies
RLS **ON** (não forçada). 3 policies (bloco-09):
- **`Users can view their own unit associations`** — SELECT, `qual = (user_id = (SELECT auth.uid())) OR EXISTS(SELECT 1 FROM user_roles WHERE user_id = (SELECT auth.uid()) AND role='admin')`.
- **`Only admins can insert unit associations`** — INSERT, `with_check = EXISTS(SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin')` (aqui `auth.uid()` **não** está embrulhado em SELECT).
- **`Only admins can delete unit associations`** — DELETE, `qual = EXISTS(SELECT 1 FROM user_roles WHERE user_id = (SELECT auth.uid()) AND role='admin')`.

**RLS QUEBRADA (achado central, confirmado):** a branch "own associations" compara `user_units.user_id = auth.uid()`, mas `user_units.user_id` é **`profiles.id`**, enquanto `auth.uid()` é **`auth.users.id`**. Eles **nunca batem** — o operador comum vê **zero** linhas por select direto; só a branch admin (`OR EXISTS user_roles`) funciona. Isto está **documentado e contornado**: migration `0005_my_units_helper.sql` cria `chat_my_units()` SECURITY DEFINER exatamente por causa disso ("Eles nunca batem — só admins... veem rows"), e `app/(app)/layout.tsx` l.39-44 usa o helper com comentário explicando. docs/03-database l.12 também alerta. **Antipattern adicional:** as 3 policies fazem `EXISTS(SELECT 1 FROM user_roles ...)` inline — cada checagem RLS de `user_units` re-varre `user_roles` (que já é a tabela de 90,6M seq scans). Ver `user_roles.md`.

## Quem escreve / Quem lê
- **Escreve:** **app admin** (`applyUnits`: delete-then-insert do conjunto completo de unidades de um usuário, actions.ts l.44-55). Único writer no código. (Trigger `handle_new_user` provisiona `user_unit_permissions`, **não** `user_units`.)
- **Lê:** `chat_my_units` (inbox — RPC chamado 48× no snapshot, bloco-10b), `chat_user_has_unit` (RLS de outras tabelas), `chat_admin_list_users`, `chat_report_attendance`, `chat_report_overview` (functions-analysis). Todos via **SECURITY DEFINER** (contornam a RLS quebrada).

## Observações
- **Dois sistemas paralelos de acesso por unidade (achado arquitetural-chave):**
  1. **`user_units`** (`user_id → profiles.id`) — consumido por `chat_my_units`/`chat_user_has_unit` → escopo do **inbox CHAT-CDT**. RLS própria **quebrada** (compara contra `auth.uid()`), contornada por SECURITY DEFINER.
  2. **`user_unit_permissions`** (`user_id → auth.users.id`) — consumido por `can_access_unit`/`has_unit_permission`/`get_user_accessible_units` e por **todos os RPCs de relatório** → escopo de **cobrança/relatórios**. RLS própria **funciona** (a chave bate com `auth.uid()`).
  Mesma necessidade (operador↔unidade), **duas tabelas, duas bases de chave** — é exatamente *por isso* que uma RLS quebra e a outra não. Candidato a unificação no plano de reorg.
- **Nunca analisada** — `ANALYZE public.user_units` recomendável (barato).
- **Contradição doc↔banco:** docs/03-database l.14 diz "user_roles — v1 não filtra por role"; porém as policies de `user_units` filtram por role (admin) via `user_roles`. A afirmação do doc está desatualizada.
- A coluna `created_at` é a única sem consumidor — telemetria pura.
