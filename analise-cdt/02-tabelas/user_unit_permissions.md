# user_unit_permissions

## Identificação
- **Nome:** `public.user_unit_permissions`
- **Dono provável:** Compartilhada (controle de acesso granular operador→unidade do app de **cobrança/relatórios**; pré-existente). O CHAT-CDT **não** a usa para escopo de inbox (usa `user_units`).
- **Linhas estimadas:** ~61 (`linhas_estimadas = 61`, bloco-01). `n_live_tup = 0`, `last_analyze = null` → nunca ANALYZE-ada.
- **Tamanho:** 104 kB total / 16 kB heap (bloco-01) — a maior das 5 (5 índices).
- **Classificação:** **Compartilhada** (auth/cobrança; lida intensamente por RPCs de relatório).
- **Bloat:** sem bloat. Acesso **saudável**: `seq_scan = 953` e `idx_scan = 732.175` (bloco-01) — ao contrário de `user_units`/`user_roles`, esta tabela **usa índice** (`user_unit_permissions_user_id_unit_id_permission_key`, 730k scans). É o exemplo de como a checagem de acesso *deveria* se comportar.

## Finalidade
Controle de acesso **granular** (permissão por unidade): para cada `(user_id, unit_id, permission)` define se o usuário tem aquela capacidade (`permission_type` enum). **`user_id` referencia `auth.users.id`** (diferente de `user_units`). É a base das funções de relatório (todas filtram unidades acessíveis por aqui) e das funções `can_access_unit`/`has_unit_permission`. CLAUDE.md cita os helpers, e docs/03-database l.13 a chamava de "v1 não usa" — desatualizado (ver Observações).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NÃO | `gen_random_uuid()` | default na inserção | PK; não lido por nome em readers (acesso por chave natural) | inferido |
| 2 | `user_id` | uuid | NÃO | — | `grant_unit_permission`/`ensure_admin_permissions`/`handle_new_user` inserem; **valor = `auth.users.id`** | `can_access_unit`, `has_unit_permission`, `user_can_read_unit`(_code), `user_has_access_to_unit`, `get_user_accessible_units`, `get_unit_details`, **todos os `rpc_*`** (`rpc_dispatches_hourly`, `rpc_failure_codes`, `rpc_inbound_summary`, `rpc_message_cost`, `rpc_phone_health_last_change`) — filtram `user_id = auth.uid()`. FK → `auth.users.id` (bloco-03) | confirmado |
| 3 | `unit_id` | uuid | NÃO | — | `grant_unit_permission`/`ensure_admin_permissions`/`handle_new_user` (select de `units`) | mesmos readers da `user_id`; FK → `units.id` CASCADE. Índice `idx_user_unit_permissions_unit_id` (idx_scan 2056) | confirmado |
| 4 | `permission` | permission_type (enum) | NÃO | — | `grant_unit_permission` (param), `handle_new_user`/`ensure_admin_permissions` (literal 'admin') | `has_unit_permission`, `get_unit_details`, `get_user_accessible_units` (devolvem o conjunto de permissões); `revoke_unit_permission` filtra por ela | confirmado |
| 5 | `is_active` | boolean | SIM | `true` | `grant_unit_permission` (upsert), `revoke_unit_permission` (UPDATE → false) | `can_access_unit`, `has_unit_permission`, `user_can_read_unit`(_code), `user_has_access_to_unit`, `get_user_accessible_units`, `get_unit_details`, todos `rpc_*` (filtram `is_active`/`COALESCE(is_active,true)`) | confirmado |
| 6 | `granted_by` | uuid | SIM | — | `grant_unit_permission` (default `auth.uid()`) | sem reader identificado (auditoria); índice `idx_user_unit_permissions_granted_by` nunca usado. FK → `auth.users.id` (bloco-03) | sem consumidor identificado |
| 7 | `granted_at` | timestamptz | SIM | `now()` | `grant_unit_permission`/`ensure_admin_permissions` (insert) | sem reader identificado (auditoria) | sem consumidor identificado |
| 8 | `created_at` | timestamptz | SIM | `now()` | default | sem consumidor identificado | sem consumidor identificado |
| 9 | `updated_at` | timestamptz | SIM | `now()` | trigger `update_user_unit_permissions_updated_at` (bloco-06); `grant_/revoke_unit_permission` gravam | sem reader identificado (auditoria) | confirmado (origem = trigger) |

## Relacionamentos (FKs)
- `user_unit_permissions_user_id_fkey`: `user_id → auth.users.id` (CASCADE). **Chave = `auth.users.id`** (≠ `user_units`, que usa `profiles.id`).
- `user_unit_permissions_unit_id_fkey`: `unit_id → units.id` (CASCADE).
- `user_unit_permissions_granted_by_fkey`: `granted_by → auth.users.id` (ON DELETE a).
- Único natural `(user_id, unit_id, permission)`.

## Índices
| índice | único | idx_scan | bytes | nota |
|--------|-------|----------|-------|------|
| `user_unit_permissions_user_id_unit_id_permission_key` (user_id, unit_id, permission) | sim | **730.119** | 16 kB | **quente** — chave natural de todas as checagens |
| `idx_user_unit_permissions_unit_id` (unit_id) | não | 2056 | 16 kB | usado |
| `user_unit_permissions_pkey` (id) | sim/PK | 0 | 16 kB | nunca usado (estrutural) |
| `idx_user_unit_permissions_granted_by` (granted_by) | não | 0 | 16 kB | **NUNCA USADO** |

### Índices nunca usados (idx_scan=0)
- `user_unit_permissions_pkey` — PK, não removível.
- `idx_user_unit_permissions_granted_by` — **removível** (col. `granted_by` é só auditoria, sem reader). **Desperdício de disco: ~16 kB (0,016 MB)** — irrelevante em disco; o ganho de removê-lo é só evitar manutenção de índice em writes (raros aqui).

## Triggers
- `update_user_unit_permissions_updated_at` — BEFORE UPDATE FOR EACH ROW → `update_updated_at_column()` (bloco-06).

## RLS / Policies
RLS **ON** (não forçada). 2 policies (bloco-09):
- **`Users can view their own unit permissions`** — SELECT, `qual = (user_id = (SELECT auth.uid()))`. ✅ **funciona** (a chave bate: `user_id` é `auth.users.id`). Contraste direto com `user_units`, onde a mesma fórmula quebra.
- **`Only admins can manage unit permissions`** — ALL, `qual = has_role((SELECT auth.uid()),'admin')`.

`has_role(...)` **não** está embrulhado em subquery (mesmo antipattern descrito em `user_roles.md`).

## Quem escreve / Quem lê
- **Escreve:** `grant_unit_permission` (upsert ON CONFLICT por chave natural), `revoke_unit_permission` (UPDATE `is_active=false`), `ensure_admin_permissions` (insert p/ todas as units), `handle_new_user` (insert 'admin' p/ todas as units quando o novo usuário é admin). (functions-analysis)
- **Lê:** **núcleo de autorização de cobrança/relatórios** — `can_access_unit`, `has_unit_permission`, `user_can_read_unit`(_code), `user_has_access_to_unit`, `get_user_accessible_units`, `get_unit_details`, e **todos os 5 `rpc_*`** de dashboard (cada um filtra unidades por aqui). Acesso via índice de chave natural (730k scans).

## Observações
- **Contradição doc↔banco direta (rule 5):** docs/03-database l.13 diz "`user_unit_permissions` ... v1 não usa." **Falso na prática:** `idx_scan 730.119`, é o filtro de escopo de **todos** os RPCs de relatório e das funções `can_access_unit`/`has_unit_permission`. É uma das tabelas de acesso **mais** usadas. A nota do doc deve ser corrigida.
- **Sistema de acesso #2** (ver `user_units.md`): esta é a perna que **funciona** — `user_id` aponta para `auth.users.id`, então a RLS de own-row bate e os helpers não precisam de SECURITY DEFINER por causa de chave (embora sejam SECURITY DEFINER por outras razões). A coexistência com `user_units` (chave `profiles.id`) é o achado de duplicidade arquitetural.
- **4 colunas de auditoria sem reader:** `granted_by`, `granted_at`, `created_at`, `updated_at`. Escritas mas não lidas no inventário — auditoria pura, não "mortas".
- **Nunca analisada** — `ANALYZE` recomendável.
- Diferente de `user_units`/`user_roles`, **esta tabela não tem patologia de seq scan** — serve de baseline de "como deveria ser" o acesso por unidade.
