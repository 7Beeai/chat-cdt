-- demo_caraguatatuba.sql
-- Seed de DEMO: conversa de "recadastro de pagamento" em handoff, unidade
-- Caraguatatuba, contato 553198312704 (número do apresentador, pra o envio
-- ao vivo funcionar). Escreve SÓ em tabelas CHAT-CDT (contacts/conversations/
-- messages). Idempotente: limpa a demo anterior do mesmo contato antes.
--
-- Para o envio de TEXTO LIVRE ao vivo funcionar, o número 553198312704 precisa
-- ter mandado uma mensagem real para o número da Caraguatatuba (5512982760545)
-- nas últimas 24h — isso abre a janela da Meta. (Nosso DB já marca a janela
-- aberta, mas quem decide a entrega do texto livre é a Meta.)

do $seed$
declare
  v_unit    uuid := '72bb4e8c-c913-494a-876b-2c6fd812a010'; -- caraguatatuba001
  v_phone   uuid := '7abdc1fe-6ac4-44a2-88ea-8d4852e17d1c'; -- chat_phone_numbers.id
  v_contact uuid;
  v_conv    uuid;
begin
  insert into public.contacts (unit_id, wa_id, name)
  values (v_unit, '553198312704', 'Carlos Eduardo Ramos')
  on conflict (unit_id, wa_id) do update set name = excluded.name
  returning id into v_contact;

  delete from public.messages where conversation_id in (
    select id from public.conversations where contact_id = v_contact
  );
  delete from public.conversations where contact_id = v_contact;

  insert into public.conversations (
    unit_id, contact_id, phone_number_id, status, routing, handoff_reason,
    priority, last_inbound_at, customer_window_expires_at, opened_at
  ) values (
    v_unit, v_contact, v_phone, 'open', 'queued', 'payment_re_register',
    5, now() - interval '2 minutes', now() + interval '23 hours', now() - interval '28 minutes'
  ) returning id into v_conv;

  insert into public.messages (conversation_id, wa_message_id, direction, type, payload, sent_by, status, created_at) values
  (v_conv,'SEED-CARAGUA-01','out','text', jsonb_build_object('text',jsonb_build_object('body','Olá! Aqui é a equipe de cobrança da CDT — Caraguatatuba 🐝 Identificamos que a cobrança da sua mensalidade não foi processada: o cartão cadastrado parece ter expirado. Posso te ajudar a regularizar?'),'_seed',true),'ai','read', now() - interval '28 minutes'),
  (v_conv,'SEED-CARAGUA-02','in','text', jsonb_build_object('text',jsonb_build_object('body','oi'),'_seed',true),'customer','delivered', now() - interval '25 minutes'),
  (v_conv,'SEED-CARAGUA-03','in','text', jsonb_build_object('text',jsonb_build_object('body','como assim nao foi processada?'),'_seed',true),'customer','delivered', now() - interval '24 minutes'),
  (v_conv,'SEED-CARAGUA-04','out','text', jsonb_build_object('text',jsonb_build_object('body','Sua mensalidade de R$ 33,40 está em aberto porque a cobrança no cartão final 4412 falhou. Você prefere atualizar a forma de pagamento ou gerar um PIX pra quitar agora?'),'_seed',true),'ai','read', now() - interval '22 minutes'),
  (v_conv,'SEED-CARAGUA-05','in','text', jsonb_build_object('text',jsonb_build_object('body','prefiro atualizar o cartao'),'_seed',true),'customer','delivered', now() - interval '19 minutes'),
  (v_conv,'SEED-CARAGUA-06','out','text', jsonb_build_object('text',jsonb_build_object('body','Perfeito! Posso te enviar o link do portal de recadastro do cartão. Só confirma pra mim: o titular do novo cartão é você mesmo?'),'_seed',true),'ai','read', now() - interval '18 minutes'),
  (v_conv,'SEED-CARAGUA-07','in','text', jsonb_build_object('text',jsonb_build_object('body','sim sou eu'),'_seed',true),'customer','delivered', now() - interval '15 minutes'),
  (v_conv,'SEED-CARAGUA-08','in','text', jsonb_build_object('text',jsonb_build_object('body','o cartao novo é de outro banco, muda alguma coisa?'),'_seed',true),'customer','delivered', now() - interval '14 minutes'),
  (v_conv,'SEED-CARAGUA-09','out','text', jsonb_build_object('text',jsonb_build_object('body','Pode ser de qualquer banco, sem problema. Vou gerar o link de recadastro pra você agora.'),'_seed',true),'ai','read', now() - interval '12 minutes'),
  (v_conv,'SEED-CARAGUA-10','in','text', jsonb_build_object('text',jsonb_build_object('body','to tentando mas o link da erro quando coloco os dados do cartao'),'_seed',true),'customer','delivered', now() - interval '8 minutes'),
  (v_conv,'SEED-CARAGUA-11','out','text', jsonb_build_object('text',jsonb_build_object('body','Poxa, sinto muito pelo transtorno! Como o recadastro está dando erro no portal, vou te transferir para um de nossos atendentes, que vai concluir a atualização com você manualmente. Um instante 🙏'),'_seed',true),'ai','read', now() - interval '6 minutes'),
  (v_conv,'SEED-CARAGUA-12','in','text', jsonb_build_object('text',jsonb_build_object('body','ok, obrigado'),'_seed',true),'customer','delivered', now() - interval '2 minutes');
end
$seed$;

-- ============================================================================
-- LIMPEZA (rodar depois do demo para remover a conversa de teste):
-- ============================================================================
-- do $cleanup$
-- declare v_contact uuid;
-- begin
--   select id into v_contact from public.contacts
--   where unit_id='72bb4e8c-c913-494a-876b-2c6fd812a010' and wa_id='553198312704';
--   if v_contact is not null then
--     delete from public.messages where conversation_id in (
--       select id from public.conversations where contact_id = v_contact);
--     delete from public.conversations where contact_id = v_contact;
--     delete from public.contacts where id = v_contact;
--   end if;
-- end $cleanup$;
