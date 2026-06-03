# profiles

## Identificação
- **Nome:** `public.profiles`
- **Dono provável:** Compartilhada (identidade de operador/usuário; pré-existente, não criada por migration CHAT-CDT). É o **operador** do CHAT-CDT (CLAUDE.md: "Operador = `public.profiles`").
- **Linhas estimadas:** `linhas_estimadas = -1`, `n_live_tup = 0`, `last_analyze = null` → **nunca ANALYZE-ada**. Número real ≈ dezenas (ordem de `user_units` ~53 vínculos / `user_unit_permissions` ~61). Confiança: inferido.
- **Tamanho:** 48 kB total / 8192 bytes heap (bloco-01).
- **Classificação:** **Compartilhada** (auth dos dois apps; lida por CHAT-CDT, edge functions de admin e RLS).
- **Bloat:** sem bloat. `seq_scan = 10` (irrelevante) e `idx_scan = 1.219.315` (bloco-01) — acesso quase 100% por índice. **Quente** via `profiles_user_id_key`.

## Finalidade
`profiles` é a identidade aplicacional do usuário, espelhando `auth.users` (FK `user_id → auth.users.id`, ON DELETE CASCADE). Guarda `name` (rótulo humano do operador, usado em toda a UI do chat e nos relatórios), além de `phone`, `department`, `position` e `is_active`. É o **pivô da cadeia de RLS por unidade**: `auth.uid() → profiles.user_id → profiles.id → user_units.user_id`. O `profiles.id` (não o `auth.users.id`) é a chave usada em `user_units`.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NÃO | `gen_random_uuid()` | default na criação do profile | **Chave de vínculo** lida por `chat_my_units`, `chat_user_has_unit`, `chat_admin_list_users`, `chat_report_attendance`, `chat_report_overview` (join `user_units.user_id = profiles.id`); app `resolveProfileId`/`applyUnits` usa `profiles.id` p/ inserir em `user_units` (actions.ts l.29-54). FK alvo de `user_units.user_id` (bloco-03) | confirmado |
| 2 | `user_id` | uuid | NÃO | — | preenchido na criação (= `auth.users.id`); `handle_new_user`/`create_admin_user` inserem `user_id` | Ponte para auth: `chat_my_units`/`chat_user_has_unit` (`p.user_id = auth.uid()`), `chat_operator_names`, `get_users_with_emails`, `chat_admin_list_users`, edge `create-admin-users`; app layout.tsx l.27 (`eq('user_id', user.id)`). Único `profiles_user_id_key` (idx_scan **1,2M**) | confirmado |
| 3 | `name` | text | NÃO | — | app (metadado do usuário no signup → `handle_new_user`/`create_admin_user` gravam `name`); admin `updateUserAction` (`profiles.update({name})`, actions.ts l.95,148) | **Rótulo humano** do operador: `chat_operator_names`, `chat_admin_list_users`, `chat_report_attendance` (nome de quem fechou), `get_users_with_emails`, app sidebar (layout.tsx l.26,33) | confirmado |
| — | *(pos 4 ausente)* | — | — | — | **coluna droppada** (gap de ordinal). Ver Observações: forte indício de que era `unit_id` | inferido |
| 5 | `created_at` | timestamptz | NÃO | `now()` | default | `chat_admin_list_users`/telemetria | inferido |
| 6 | `updated_at` | timestamptz | NÃO | `now()` | trigger `update_profiles_updated_at` (bloco-06); admin grava em updates | telemetria | confirmado (origem = trigger) |
| 7 | `phone` | text | SIM | — | app/cadastro | sem consumidor identificado (não aparece em functions/edge/n8n/views/stat) | sem consumidor identificado |
| 8 | `department` | text | SIM | — | app/cadastro | sem consumidor identificado | sem consumidor identificado |
| 9 | `position` | text | SIM | — | app/cadastro | sem consumidor identificado | sem consumidor identificado |
| 10 | `is_active` | boolean | SIM | `true` | app; admin `setUserActiveAction` (`profiles.update({is_active})`, actions.ts l.239); `create_admin_user` upsert | `chat_admin_list_users` (flag na tela admin), `get_users_with_emails` (COALESCE default true) | confirmado |

## Relacionamentos (FKs)
- **Saída:** `profiles_user_id_fkey`: `user_id → auth.users.id` (ON DELETE CASCADE) — apagar o usuário de auth apaga o profile.
- **Entrada:** `user_units_user_id_fkey`: `user_units.user_id → profiles.id` (CASCADE). **Atenção:** este é o único vínculo de acesso que usa `profiles.id`; `user_roles` e `user_unit_permissions` usam `auth.users.id` (ver Observações).

## Índices
| índice | único | idx_scan | bytes | nota |
|--------|-------|----------|-------|------|
| `profiles_user_id_key` (user_id) | sim | **1.219.315** | 16 kB | **quente** — todo lookup `por auth.uid()` passa aqui |
| `profiles_pkey` (id) | sim/PK | 0 | 16 kB | ver abaixo |

### Índices nunca usados (idx_scan=0)
- `profiles_pkey` — idx_scan 0. Surpreendente (joins usam `profiles.id`), mas como as tabelas são minúsculas o planner resolve os joins por seq scan / nested loop sobre o índice `user_id` e nunca precisa do PK como ponto de entrada. **Não é removível** (PK estrutural, alvo de FK). Desperdício real: 16 kB / CPU desprezível.

## Triggers
- `update_profiles_updated_at` — BEFORE UPDATE FOR EACH ROW → `update_updated_at_column()` (bloco-06).

## RLS / Policies
RLS **ON** (não forçada). 4 policies (bloco-09):
- **`Users can view their own profile`** — SELECT, `qual = (user_id = (SELECT auth.uid()))`. ✅ funciona (compara `user_id`, que é `auth.users.id`).
- **`Users can update their own profile`** — UPDATE, mesmo `qual`. ✅
- **`Admins can view all profiles`** — SELECT, `qual = has_role((SELECT auth.uid()),'admin')`.
- **`Admins can modify all profiles`** — ALL, mesmo `qual`.

`auth.uid()` está corretamente embrulhado em `(SELECT auth.uid())` (avaliado uma vez). `has_role(...)` **não** está embrulhado em subquery — ver nota de performance em `user_roles.md`.

## Quem escreve / Quem lê
- **Escreve:** `handle_new_user` (trigger em `auth.users`, insere `user_id`,`name`), `create_admin_user` (upsert `user_id`,`name`,`is_active`), edge `create-admin-users` (insert), app admin actions (`update name`, `update is_active`). (functions-analysis, edge-functions, actions.ts)
- **Lê:** núcleo de identidade — `chat_my_units`, `chat_user_has_unit`, `chat_operator_names`, `chat_admin_list_users`, `chat_report_attendance`/`overview`, `get_users_with_emails`; app layout.tsx (sidebar). Acesso quase 100% via `profiles_user_id_key` (1,2M scans).

## Observações
- **Gap de ordinal pos-4 = coluna droppada.** Não há `create table profiles` em nenhuma migration CHAT-CDT (tabela pré-existente), então a DDL não está disponível localmente. **Forte indício de que a coluna droppada era `unit_id`:** a análise da edge function `create-admin-users` (edge-functions.json) lista as colunas de `profiles` como `[id, user_id, name, unit_id]` — mas o schema atual **não tem `unit_id`** em `profiles`. Interpretação: o modelo antigo vinculava operador→unidade direto em `profiles.unit_id` (1:1); isso foi substituído pela tabela N:N `user_units`, e `profiles.unit_id` foi dropado (deixando o gap pos-4). A edge function carrega referência **stale** a essa coluna — *possível bug latente* se ela tentar inserir `unit_id` (a confirmar no código real da edge function). **Segunda testemunha contra "email":** `get_users_with_emails` busca o email em `auth.users` (join), não em `profiles` — se `profiles` tivesse coluna `email`, o join a auth seria desnecessário; isso reforça que a coluna droppada **não** era `email` e é coerente com `unit_id`. Confiança: inferido (evidências = gap de ordinal pos-4 + lista de colunas `[id,user_id,name,unit_id]` da edge `create-admin-users` + email vindo de `auth.users`).
- **Três campos sem consumidor identificado:** `phone`, `department`, `position` — preenchíveis no cadastro mas nenhum reader em functions/edge/n8n/views/stat. Não marcar como "mortas": são campos de perfil que a UI pode exibir; apenas não há leitura no inventário analisado.
- **Nunca analisada** (sem estatística de planner) — recomendável `ANALYZE public.profiles`.
- **Divergência de chave de acesso (achado arquitetural):** `profiles.id` é a chave de `user_units`, enquanto `user_roles.user_id` e `user_unit_permissions.user_id` referenciam `auth.users.id` diretamente. Dois sistemas paralelos de acesso por unidade convivem — detalhado em `user_units.md` e `user_unit_permissions.md`.
