-- ============================================================================
-- DEV CLEANUP — remove tudo que `dev_seed.sql` criou.
--
-- Como funciona: identifica rows pelo prefixo `__SEED__` em campos de texto
-- ou pela flag `seed: true` em jsonb. Não toca em nenhum dado real.
--
-- Idempotente. Ordem segue dependências (folhas → raízes).
-- ============================================================================

-- 1) Mensagens fake (folhas — não tem FK saindo)
delete from messages
 where wa_message_id like '__SEED__%'
    or payload->>'seed' = 'true';

-- 2) Conversations cujo contato é seed
delete from conversations
 where contact_id in (
   select id from contacts
    where wa_id like '__SEED__%' or profile->>'seed' = 'true'
 );

-- 3) Contacts fake
delete from contacts
 where wa_id like '__SEED__%'
    or profile->>'seed' = 'true';

-- 4) Phone_numbers fake (precisa ser depois das conversations que apontam pra ele)
delete from chat_phone_numbers
 where phone_number_id like '__SEED__%';

-- 5) WABAs fake (precisa ser depois dos phone_numbers e dos templates se houver)
delete from wabas
 where waba_id like '__SEED__%';

-- 6) Webhook events de teste (eventos manuais que possam ter sido enviados)
delete from chat_webhook_events
 where payload->>'seed' = 'true';

-- Conferência (deve retornar 0 linhas em cada bucket):
--   select count(*) from messages where wa_message_id like '__SEED__%' or payload->>'seed' = 'true';
--   select count(*) from conversations where contact_id in (
--     select id from contacts where wa_id like '__SEED__%' or profile->>'seed' = 'true'
--   );
--   select count(*) from contacts where wa_id like '__SEED__%' or profile->>'seed' = 'true';
--   select count(*) from chat_phone_numbers where phone_number_id like '__SEED__%';
--   select count(*) from wabas where waba_id like '__SEED__%';

-- ============================================================================
-- SEÇÃO OPCIONAL: revogar acesso do operador ian@7bee.ai
--
-- Descomente as linhas abaixo SE quiser também remover o setup do operador.
-- NÃO recomendado se você ainda quer usar ian@7bee.ai como operador real.
-- ============================================================================
-- delete from user_units
--  where user_id = (
--    select p.id from profiles p
--      join auth.users u on u.id = p.user_id
--     where u.email = 'ian@7bee.ai'
--  );
-- delete from profiles
--  where user_id = (select id from auth.users where email = 'ian@7bee.ai');
