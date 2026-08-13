-- 0027_sales_only_role.sql
-- Acesso "somente vendas": operadores que só devem ver a Área de Vendas
-- (/vendas), sem Inbox de cobrança nem Relatórios.
--
-- Reusa o role system existente (public.user_roles + public.has_role + enum
-- app_role, que já traz 'sales_agent' desde a origem — estava morto até aqui).
-- Nenhuma tabela nova. Conceder/remover = 1 linha em user_roles
-- (user_id = auth.users.id, role = 'sales_agent').
--
-- IMPORTANTE: isto é gate de INTERFACE (sidebar + redirects nos layouts).
-- O RLS continua por unidade (chat_user_has_unit) — um sales_agent com o
-- próprio JWT ainda LÊ conversas de cobrança da unidade dele via PostgREST.
-- Aceitável para operadores de franquia; barreira dura exigiria RLS por
-- classe de número (vendas × cobrança), fora do escopo desta migration.
--
--   chat_is_sales_only()    -> boolean. true = tem 'sales_agent' E NÃO é
--                              admin. O "e não é admin" fica no SQL de
--                              propósito: admin que ganhar o role por engano
--                              nunca se tranca fora do app.
--   chat_admin_list_users() -> +coluna is_sales_agent p/ a tela /admin/users
--                              (badge + toggle).

-- --------------------------------------------------------------------------
-- chat_is_sales_only(): a sessão atual é um operador somente-vendas?
-- --------------------------------------------------------------------------
create or replace function public.chat_is_sales_only()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.has_role(auth.uid(), 'sales_agent'::app_role)
     and not public.has_role(auth.uid(), 'admin'::app_role);
$$;

-- CREATE (or replace) re-aplica o default grant a PUBLIC — revogar explícito
-- (ver gotcha DROP+CREATE/default grants) e conceder só a authenticated.
revoke all on function public.chat_is_sales_only() from public, anon;
grant execute on function public.chat_is_sales_only() to authenticated;

-- --------------------------------------------------------------------------
-- chat_admin_list_users(): +is_sales_agent. Mudança de return type exige
-- DROP (bare CREATE OR REPLACE não altera colunas). Seguro: nenhuma policy
-- depende desta função. O DROP derruba os grants — re-concedido abaixo.
-- --------------------------------------------------------------------------
drop function if exists public.chat_admin_list_users();

create function public.chat_admin_list_users()
returns table (
  auth_id          uuid,
  profile_id       uuid,
  email            text,
  name             text,
  is_active        boolean,
  is_admin         boolean,
  is_sales_agent   boolean,
  unit_ids         uuid[],
  last_sign_in_at  timestamptz,
  created_at       timestamptz,
  banned_until     timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    u.id                                              as auth_id,
    p.id                                              as profile_id,
    u.email::text                                     as email,
    p.name                                            as name,
    coalesce(p.is_active, true)                       as is_active,
    public.has_role(u.id, 'admin'::app_role)          as is_admin,
    public.has_role(u.id, 'sales_agent'::app_role)    as is_sales_agent,
    coalesce(
      array_agg(uu.unit_id) filter (where uu.unit_id is not null),
      '{}'::uuid[]
    )                                                 as unit_ids,
    u.last_sign_in_at                                 as last_sign_in_at,
    u.created_at                                      as created_at,
    u.banned_until                                    as banned_until
  from auth.users u
  left join public.profiles p   on p.user_id = u.id
  left join public.user_units uu on uu.user_id = p.id
  where public.has_role(auth.uid(), 'admin'::app_role)
  group by u.id, p.id, u.email, p.name, p.is_active,
           u.last_sign_in_at, u.created_at, u.banned_until
  order by u.email;
$$;

revoke all on function public.chat_admin_list_users() from public, anon;
grant execute on function public.chat_admin_list_users() to authenticated;
