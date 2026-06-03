# user_roles

## Identificação
- **Nome:** `public.user_roles`
- **Dono provável:** Compartilhada (papéis globais de usuário; pré-existente). Consumida pelo CHAT-CDT (admin gate) e pela RLS de várias tabelas dos dois apps.
- **Linhas estimadas:** **7** (`linhas_estimadas = 7`, bloco-01). `n_live_tup = 0`, `last_analyze = null` → nunca ANALYZE-ada.
- **Tamanho:** 40 kB total / 8192 bytes heap (bloco-01) — a menor das 5.
- **Classificação:** **Compartilhada** (auth; pivô de RLS de admin).
- **Bloat:** sem bloat. **ACHADO CRÍTICO DE PERFORMANCE:** `seq_scan = 90.587.825` (≈90,6M) com `idx_scan = 0` (bloco-01), em uma tabela de **7 linhas**. É, de longe, a maior contagem de seq scan das 5 tabelas. Os 2 índices nunca foram usados. Causa real abaixo (não é o RPC `has_role` direto).

## Finalidade
`user_roles` guarda os papéis globais de cada usuário: `(user_id, role)` com `role` do enum `app_role` (`admin` / `collections_agent` / `user` / `sales_agent`). É a fonte de verdade do **admin gate**: a função `has_role(user_id, role)` lê esta tabela e é chamada por dezenas de policies RLS e funções. No CHAT-CDT, o gate de admin (`chat_is_admin` → `has_role`) controla a página `/admin/users` e o link de nav (`lib/auth/admin.ts`).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NÃO | `gen_random_uuid()` | default | PK; não lido por nome | inferido |
| 2 | `user_id` | uuid | NÃO | — | `assign_admin_role_by_email`/`create_emergency_admin`/`ensure_admin_permissions`/`handle_new_user`/edge `create-admin-users` inserem; **valor = `auth.users.id`** | `has_role` (`ur.user_id = _user_id`), policies RLS de `user_units`/`profiles`/`units`/etc. (`user_roles.user_id = auth.uid()`), `get_unit_details`/`get_user_accessible_units`/`user_has_access_to_unit`, edge `process-reembolso`; app admin (`from('user_roles')`, actions.ts l.170,208,266). FK → `auth.users.id` (bloco-03) | confirmado |
| 3 | `role` | app_role (enum) | NÃO | — | inserções acima (literais `admin`/`collections_agent`/`user`/`sales_agent`) | `has_role` (`ur.role = _role`), policies (`role='admin'`), edge `process-reembolso` (valida admin/collections_agent). Único `(user_id, role)` | confirmado |
| 4 | `created_at` | timestamptz | NÃO | `now()` | default; `ensure_admin_permissions` grava explicitamente | sem consumidor identificado (telemetria) | sem consumidor identificado |

## Relacionamentos (FKs)
- `user_roles_user_id_fkey`: `user_id → auth.users.id` (ON DELETE CASCADE). **Chave = `auth.users.id`** (como `user_unit_permissions`; ≠ `user_units`).
- Único `user_roles_user_id_role_key` (user_id, role).

## Índices
| índice | único | idx_scan | bytes | nota |
|--------|-------|----------|-------|------|
| `user_roles_pkey` (id) | sim/PK | 0 | 16 kB | nunca usado (estrutural) |
| `user_roles_user_id_role_key` (user_id, role) | sim | 0 | 16 kB | **NUNCA USADO** — apesar de `has_role` filtrar exatamente por `(user_id, role)` |

### Índices nunca usados (idx_scan=0)
- `user_roles_pkey` — PK, não removível.
- `user_roles_user_id_role_key` — **NUNCA USADO** apesar de cobrir perfeitamente o predicado de `has_role`. **Motivo:** com 7 linhas, o planner sempre escolhe **seq scan** (mais barato que descer no índice). Por isso o índice fica em idx_scan 0 e os 90,6M acessos viram seq scans. **Desperdício de disco: ~16 kB (0,016 MB)** — irrelevante; **manter** o índice (corrigir a causa raiz, abaixo, não o índice). O custo real dos 90,6M scans é **CPU**, não disco.

## Triggers
Nenhum (bloco-06 não lista triggers para `user_roles`).

## RLS / Policies
RLS **ON** (não forçada). 1 policy (bloco-09):
- **`Users can read their own roles`** — SELECT, `qual = (user_id = (SELECT auth.uid()))`. ✅ funciona (chave = `auth.users.id`). Escrita só por funções SECURITY DEFINER (não há policy de INSERT/UPDATE → ninguém escreve via RLS direta; writes vêm de funções privilegiadas).

## Quem escreve / Quem lê
- **Escreve:** `assign_admin_role_by_email`, `create_emergency_admin`, `ensure_admin_permissions`, `handle_new_user` (trigger em `auth.users`), edge `create-admin-users` — todas inserções idempotentes (`ON CONFLICT (user_id, role) DO NOTHING`). App admin actions (gerencia roles, actions.ts l.170-266). (functions-analysis, edge-functions)
- **Lê (intenso):** `has_role` é o leitor dominante. Tabelas cuja **RLS referencia `has_role`/`user_roles`** (grep no bloco-09 **não-filtrado**): `clientes_cobranca_dashboard` (SELECT/UPDATE via `has_role`, DELETE via `EXISTS ... FROM user_roles`), `clientes_cobranca_setembro` (ALL + DELETE inline), `pagamentos` (DELETE inline `EXISTS FROM user_roles`), `profiles`, `units`, `user_unit_permissions`, `user_units` (3 policies inline `EXISTS FROM user_roles`), `disparadores_whatsapp`, `agents`, `sales_leads`, `todos`, `webhook_configs`. **Não** carregam `has_role` na RLS: `message_log`, `conversations`, `contacts` (verificado — ausentes do grep). Além da RLS, `has_role` é chamado por `grant_/revoke_unit_permission`, `can_access_unit`, `has_unit_permission`, todos `rpc_*`, `chat_is_admin`.

## Observações
- **De onde vêm os 90,6M seq scans (correção importante):** **NÃO** são causados pelas 1.961 chamadas diretas do RPC `has_role` vistas no `pg_stat_statements` (bloco-10b). São métricas diferentes em **bases de tempo diferentes**:
  - `1.961 calls` = `pg_stat_statements`, janela do **snapshot (~13h)**, chamadas PostgREST diretas de `has_role(_user_id, _role)` (o front-end checando admin). Isso gera ~1.961 leituras de `user_roles` — um arredondamento.
  - `90,6M seq_scan` = `pg_stat_user_tables`, **acumulado desde o último reset de estatísticas** (não a janela de 13h). 1.961 chamadas não podem produzir 90,6M (≈46.000× de diferença).
  - **Driver real (mecanismo confirmado; magnitude inferida):** `has_role()` está embutido no `qual` de policies RLS, e várias policies fazem `EXISTS(SELECT 1 FROM user_roles ...)` **inline**. **`has_role` é `STABLE` mas NÃO está embrulhado em subquery escalar** — então é avaliado **por linha** durante o scan de cada tabela cuja RLS o usa. As tabelas que efetivamente carregam isso (grep no bloco-09 **não-filtrado**, `confirmado`): `clientes_cobranca_dashboard` e `clientes_cobranca_setembro` (tabelas **grandes** de cobrança, com policies `ALL`/`SELECT`/`UPDATE`/`DELETE`), `pagamentos`, `user_units`, `profiles`, `units`, `user_unit_permissions` e config. Varrer uma tabela grande de cobrança sob RLS = uma avaliação de `has_role` (→ seq scan de `user_roles`) **por linha**; repetido por milhões de linhas-lidas de leitores autenticados ao longo do acumulado → ordem de 90,6M. **Magnitude exata = `inferido`** (o mecanismo é certo; a atribuição linha-a-linha não está cravada). Ressalva: RPCs `SECURITY DEFINER` e as leituras service-role do n8n **bypassam RLS**, então as avaliações por-linha vêm de **leituras autenticadas diretas** (PostgREST do app/operadores), não de todo scan. **Importante:** `message_log`/`conversations`/`contacts` **NÃO** têm `has_role` na RLS (verificado, ausentes do grep) — portanto **não** são a fonte, ao contrário do que uma intuição "tabela maior" sugeriria.
- **A correção (nomear no plano de reorg):** note que `auth.uid()` **já** está embrulhado `(SELECT auth.uid())` nas policies — o que o colapsa a **um** initplan por query. **`has_role(...)` precisa do mesmo tratamento:** trocar `has_role((SELECT auth.uid()),'admin')` por `(SELECT has_role((SELECT auth.uid()),'admin'))` faz o Postgres avaliá-lo **uma vez por query** (initplan) em vez de por linha — eliminando a quase totalidade dos 90,6M scans. Custo: reescrever as policies (sem mudança de schema). É o antipattern clássico de RLS do Supabase ("wrap function calls in a subselect").
- **Flag de janela vs acumulado:** sempre tratar `seq_scan`/`idx_scan` de bloco-01 como **acumulados** (desde o reset), e os números de bloco-10a/b como **janela ~13h**. Não somar nem igualar.
- **Contradição doc↔banco (rule 5):** docs/03-database l.14 diz "`user_roles` — v1 não filtra por role". **Falso:** `user_roles` é o pivô do admin gate (via `has_role`) e dirige a RLS responsável pelos 90,6M scans — é a tabela de auth **mais** exercitada do banco. Corrigir a nota.
- **Nunca analisada** — `ANALYZE` não muda a escolha de seq scan em 7 linhas, mas é higiene.
- `created_at` é a única coluna sem reader (telemetria).
