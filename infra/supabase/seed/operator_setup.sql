-- ============================================================================
-- Setup permanente: operador ian@7bee.ai com acesso a todas as units.
--
-- Isto NÃO é seed descartável — é grant real de acesso. Rodar uma vez.
-- Para revogar, ver dev_cleanup.sql (seção opcional).
-- ============================================================================

-- 1) Profile do ian (linkado a auth.users)
insert into profiles (user_id, name)
select id, coalesce(raw_user_meta_data->>'name', 'Ian')
  from auth.users
 where email = 'ian@7bee.ai'
on conflict do nothing;

-- 2) Acesso a TODAS as units via user_units
-- (Atenção: user_units.user_id aponta para profiles.id, não auth.users.id)
insert into user_units (user_id, unit_id)
select p.id, u.id
  from profiles p
  cross join units u
 where p.user_id = (select id from auth.users where email = 'ian@7bee.ai')
on conflict do nothing;

-- Conferência
-- select u.code, u.name from user_units uu
--   join units u on u.id = uu.unit_id
--   join profiles p on p.id = uu.user_id
--   where p.user_id = (select id from auth.users where email = 'ian@7bee.ai')
--   order by u.name;
