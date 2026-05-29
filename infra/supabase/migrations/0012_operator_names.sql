-- 0012_operator_names.sql
-- ---------------------------------------------------------------------------
-- Resolve nomes de operadores para exibição na thread (badge "quem enviou").
--
-- `messages.operator_id` guarda o auth.uid() do operador. Para mostrar o NOME
-- na bolha, precisamos de profiles.name. Mas a RLS de profiles só deixa o
-- operador ler o PRÓPRIO perfil (outros = só admin) — então um SELECT direto
-- não traz o nome de colegas. Esta função SECURITY DEFINER devolve só
-- (user_id, name) para um conjunto de ids — nada sensível (sem phone/depto).
--
-- Mesmo padrão de chat_my_units / chat_user_has_unit.
-- ---------------------------------------------------------------------------

create or replace function public.chat_operator_names(p_ids uuid[])
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.user_id, p.name
  from public.profiles p
  where p.user_id = any(p_ids)
$$;

comment on function public.chat_operator_names(uuid[]) is
  'Nomes (user_id, name) de operadores por auth.uid(). Para a badge de autoria na thread. Read-only, só nome.';

revoke all on function public.chat_operator_names(uuid[]) from public;
grant execute on function public.chat_operator_names(uuid[]) to authenticated, service_role;
