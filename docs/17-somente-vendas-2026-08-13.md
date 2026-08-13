# 17 — Acesso "Somente Vendas" (2026-08-13)

Operadores que só devem enxergar a **Área de Vendas** (`/vendas`), sem Inbox de
cobrança nem Relatórios. Pedido do Victor: franquias com equipe de vendas
separada da cobrança.

## Modelo

Reusa o role system que já existia morto no schema: `public.user_roles`
(enum `app_role`, valor `sales_agent`) + `public.has_role()`. **Nenhuma tabela
nova.** Conceder/remover = 1 linha em `user_roles`.

⚠️ Os dois FKs de sempre: `user_roles.user_id` → `auth.users.id`;
`user_units.user_id` → `profiles.id`.

| Peça | O que faz |
|------|-----------|
| `chat_is_sales_only()` (migration 0027) | `true` = tem `sales_agent` **e NÃO é admin**. O "não é admin" fica no SQL: admin com o role por engano nunca se tranca fora. Grant só a `authenticated` (anon toma 42501). |
| `chat_admin_list_users()` (0027 re-cria) | +coluna `is_sales_agent` p/ a tela admin. |
| `lib/auth/sales.ts` → `getIsSalesOnly()` | Wrapper do RPC. **Fail-open**: RPC quebrada = acesso completo (não pode trancar a operação de cobrança inteira). |
| `app/(app)/inbox/layout.tsx` | Somente-vendas → `redirect('/vendas')`. Cobre `/inbox` e `/inbox/[id]`. |
| `app/(app)/reports/page.tsx` | Idem. (`/` e `/templates` já redirecionam p/ `/inbox`, que encadeia p/ `/vendas`.) |
| `app/(app)/layout.tsx` | Busca o flag 1x, repassa à sidebar; **pula a RPC `chat_inbox_vitals`** (badge) p/ somente-vendas. |
| `components/sidebar.tsx` | Nav vira só `Vendas`. |
| `/admin/users` | Badge "Vendas" + toggle "Somente vendas"/"Acesso completo" no menu ⋮ de cada usuário (`setSalesOnlyAction`). |

## Como conceder

- **UI**: `/admin/users` → menu ⋮ do usuário → "Somente vendas".
- **Script** (monorepo `cpt-ibirite/scripts/chat-cdt-create-users.sh`):
  `ROLE=vendas ./chat-cdt-create-users.sh "<unidade>" "email|Nome"`.
- **SQL**: `insert into user_roles (user_id, role) values ('<auth_id>','sales_agent');`

Rodar o script sem `ROLE` **não remove** o role de quem já é somente-vendas.

## Limite conhecido (decisão consciente)

É trava de **interface** (redirects + sidebar). O RLS continua por unidade
(`chat_user_has_unit`), então um somente-vendas com o próprio JWT ainda **lê**
conversas de cobrança da unidade dele via PostgREST, e as server actions da
inbox não checam o role. Aceitável para operador de franquia (mesmo círculo de
confiança). Barreira dura = RLS por classe de número (vendas × cobrança;
`chat_vendas_phone_rows()` da 0026 já sabe classificar) — só se um dia esses
usuários forem de fora do círculo.

## Validado em prod (2026-08-13, usuário descartável)

sem role → `false`; com `sales_agent` → `true`; `sales_agent`+`admin` →
`false`; anon → `42501`. Usuário de teste removido.
