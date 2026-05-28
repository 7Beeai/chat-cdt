-- ============================================================================
-- DEV SEED — conversa fake para testar a UI localmente.
--
-- CONVENÇÃO DE IDENTIFICAÇÃO (essencial para cleanup):
--   * Todos os identifiers de texto inseridos AQUI começam com `__SEED__`.
--   * Todos os jsonb (contacts.profile, messages.payload) contêm `seed: true`.
--   * Idempotente: pode rodar múltiplas vezes sem duplicar.
--
-- Remoção: rodar `dev_cleanup.sql` apaga tudo isto sem tocar em dados reais.
-- ============================================================================

-- WABA fake, na unidade Ibirité (1ª criada, com dados ricos de cobrança).
with target_unit as (
  select id from units where code = 'ibirite' limit 1
)
insert into wabas (unit_id, waba_id, name)
select tu.id, '__SEED__WABA_001', '[SEED] WABA teste'
  from target_unit tu
on conflict (waba_id) do nothing;

-- Phone_number fake ligado à WABA fake.
with w as (select id from wabas where waba_id = '__SEED__WABA_001')
insert into chat_phone_numbers (waba_id, phone_number_id, display_phone, quality_rating)
select w.id, '__SEED__PHONE_001', '+55 31 0000-0001', 'GREEN'
  from w
on conflict (phone_number_id) do nothing;

-- Contact fake (wa_id `__SEED__5531999990001` é claramente identificável).
with u as (select id from units where code = 'ibirite' limit 1)
insert into contacts (unit_id, wa_id, name, profile, crm_external_id)
select u.id,
       '__SEED__5531999990001',
       'Maria (teste)',
       jsonb_build_object('seed', true, 'matricula', 'MAT-TEST-001'),
       'crm-test-001'
  from u
on conflict (unit_id, wa_id) do nothing;

-- Conversation fake — routing='queued', handoff_reason='cancel', janela aberta.
-- Idempotência: o UNIQUE INDEX uniq_open_conv_per_contact garante 1 'open' por contato.
with
  u as (select id from units where code = 'ibirite' limit 1),
  c as (select id from contacts where wa_id = '__SEED__5531999990001'),
  ph as (select id from chat_phone_numbers where phone_number_id = '__SEED__PHONE_001')
insert into conversations (
  unit_id, contact_id, phone_number_id, status, routing, handoff_reason, priority,
  last_inbound_at, customer_window_expires_at, opened_at
)
select u.id, c.id, ph.id, 'open', 'queued', 'cancel', 10,
       now() - interval '8 minutes',
       now() + interval '23 hours 52 minutes',
       now() - interval '10 minutes'
  from u, c, ph
where not exists (
  select 1 from conversations cv
   where cv.contact_id = c.id and cv.status = 'open'
);

-- 3 mensagens inbound fake. wa_message_id prefixado com __SEED__ para idempotência.
with conv as (
  select id from conversations
   where contact_id = (select id from contacts where wa_id = '__SEED__5531999990001')
     and status = 'open'
)
insert into messages (
  conversation_id, wa_message_id, direction, type, payload, status, sent_by, created_at
)
select conv.id, m.wamid, 'in', 'text',
       jsonb_build_object(
         'seed', true,
         'from', '__SEED__5531999990001',
         'type', 'text',
         'text', jsonb_build_object('body', m.body)
       ),
       'delivered', 'customer', m.ts
  from conv,
       (values
         ('__SEED__WAMID_001', 'Oi, preciso de ajuda', now() - interval '10 minutes'),
         ('__SEED__WAMID_002', 'Quero cancelar minha assinatura', now() - interval '9 minutes'),
         ('__SEED__WAMID_003', 'Alguém pode me ajudar?',         now() - interval '8 minutes')
       ) as m(wamid, body, ts)
on conflict (wa_message_id) do nothing;

-- ============================================================================
-- Resumo do que foi criado (rodar manualmente para conferir)
-- ============================================================================
--   select 'waba'            as kind, waba_id as ident   from wabas              where waba_id like '__SEED__%'
--   union all select 'phone',  phone_number_id            from chat_phone_numbers where phone_number_id like '__SEED__%'
--   union all select 'contact',wa_id                      from contacts           where wa_id like '__SEED__%'
--   union all select 'msg',    wa_message_id              from messages           where wa_message_id like '__SEED__%';
