-- 0018_must_reset_password.sql
-- Troca de senha obrigatória no 1º login. A senha inicial criada pelo admin
-- (createUserAction) é temporária; com esta flag, o layout autenticado força
-- o usuário a definir uma senha própria antes de usar o sistema, e a página
-- /reset-password limpa a flag quando ele troca.
--
-- Aditiva, default false → usuários existentes não são afetados.

alter table public.profiles
  add column if not exists must_reset_password boolean not null default false;

comment on column public.profiles.must_reset_password is
  'true = usuário precisa trocar a senha no próximo login (senha inicial temporária); limpado quando define a nova senha em /reset-password.';
