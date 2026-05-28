-- ============================================================================
-- 0005 — Helper chat_my_units() para listar unidades do operador autenticado.
--
-- Motivo: a RLS pré-existente em public.user_units compara
--   user_units.user_id  =  auth.uid()
-- mas user_units.user_id é FK pra profiles.id, enquanto auth.uid() é
-- auth.users.id. Eles nunca batem — só admins (via OR has_role) veem rows.
-- Resultado: select direto em user_units não retorna nada pro operador
-- comum. O helper SECURITY DEFINER faz a tradução correta via profiles.
--
-- Aplicada via MCP como `chat_cdt_my_units_helper`.
-- ============================================================================

create or replace function public.chat_my_units()
returns table (id uuid, code text, name text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select u.id, u.code, u.name
    from public.units u
    join public.user_units uu on uu.unit_id = u.id
    join public.profiles p on p.id = uu.user_id
   where p.user_id = auth.uid()
   order by u.name;
$$;

revoke execute on function public.chat_my_units() from anon, public;
grant  execute on function public.chat_my_units() to authenticated;
