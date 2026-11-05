-- 0035 — horário de atendimento e "atende chat" por unidade + RPC de disponibilidade (04/11/2026, GO Victor)
-- Fase 0 de docs/PLANO-PRESENCA-HORARIO-CHAT-CDT-2026-11-04.md (repo CPT). `units` é tabela do n8n/CPT: não se mexe.
-- Seed = horário OBSERVADO (mensagens de operador, 14 dias): abre = floor(p10), fecha = ceil(p90), seg–sex; sábado onde
-- houve >=10 msgs de fim de semana. 10 unidades sem nenhuma msg de operador → atende_chat=false. Unidade sem linha = aberta.

create table if not exists public.chat_unit_hours (
  unit_id uuid not null references public.units(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),          -- 0 = domingo (extract(dow))
  abre time not null, fecha time not null,
  tz text not null default 'America/Sao_Paulo',
  primary key (unit_id, dow, abre)
);
create table if not exists public.chat_unit_atendimento (
  unit_id uuid primary key references public.units(id) on delete cascade,
  atende_chat boolean not null default true,
  telefone text,                                               -- NULL = a IA usa o telefone do rodapé do prompt
  observacao text,
  updated_at timestamptz not null default now()
);
alter table public.chat_unit_hours enable row level security;
alter table public.chat_unit_atendimento enable row level security;
drop policy if exists chat_unit_hours_select on public.chat_unit_hours;
create policy chat_unit_hours_select on public.chat_unit_hours for select to authenticated using (unit_id in (select public.chat_my_unit_ids()));
drop policy if exists chat_unit_atendimento_select on public.chat_unit_atendimento;
create policy chat_unit_atendimento_select on public.chat_unit_atendimento for select to authenticated using (unit_id in (select public.chat_my_unit_ids()));

insert into public.chat_unit_hours (unit_id, dow, abre, fecha) values
('654f3546-d363-4461-be8f-e8bd05df9c75',1,'09:00','18:00'),
('654f3546-d363-4461-be8f-e8bd05df9c75',2,'09:00','18:00'),
('654f3546-d363-4461-be8f-e8bd05df9c75',3,'09:00','18:00'),
('654f3546-d363-4461-be8f-e8bd05df9c75',4,'09:00','18:00'),
('654f3546-d363-4461-be8f-e8bd05df9c75',5,'09:00','18:00'),
('654f3546-d363-4461-be8f-e8bd05df9c75',6,'09:00','18:00'),
('c6db5796-b260-4b8a-8ec3-f30750d8c08f',1,'09:00','17:00'),
('c6db5796-b260-4b8a-8ec3-f30750d8c08f',2,'09:00','17:00'),
('c6db5796-b260-4b8a-8ec3-f30750d8c08f',3,'09:00','17:00'),
('c6db5796-b260-4b8a-8ec3-f30750d8c08f',4,'09:00','17:00'),
('c6db5796-b260-4b8a-8ec3-f30750d8c08f',5,'09:00','17:00'),
('c6db5796-b260-4b8a-8ec3-f30750d8c08f',6,'09:00','17:00'),
('18205c5d-2723-491f-b42d-451d5c9484f1',1,'10:00','18:00'),
('18205c5d-2723-491f-b42d-451d5c9484f1',2,'10:00','18:00'),
('18205c5d-2723-491f-b42d-451d5c9484f1',3,'10:00','18:00'),
('18205c5d-2723-491f-b42d-451d5c9484f1',4,'10:00','18:00'),
('18205c5d-2723-491f-b42d-451d5c9484f1',5,'10:00','18:00'),
('72bb4e8c-c913-494a-876b-2c6fd812a010',1,'09:00','17:00'),
('72bb4e8c-c913-494a-876b-2c6fd812a010',2,'09:00','17:00'),
('72bb4e8c-c913-494a-876b-2c6fd812a010',3,'09:00','17:00'),
('72bb4e8c-c913-494a-876b-2c6fd812a010',4,'09:00','17:00'),
('72bb4e8c-c913-494a-876b-2c6fd812a010',5,'09:00','17:00'),
('72bb4e8c-c913-494a-876b-2c6fd812a010',6,'09:00','17:00'),
('8892c30a-3f82-4f1e-a724-c1854d78df93',1,'09:00','16:00'),
('8892c30a-3f82-4f1e-a724-c1854d78df93',2,'09:00','16:00'),
('8892c30a-3f82-4f1e-a724-c1854d78df93',3,'09:00','16:00'),
('8892c30a-3f82-4f1e-a724-c1854d78df93',4,'09:00','16:00'),
('8892c30a-3f82-4f1e-a724-c1854d78df93',5,'09:00','16:00'),
('0236ef6b-3d71-42fa-a268-31970a762306',1,'09:00','17:00'),
('0236ef6b-3d71-42fa-a268-31970a762306',2,'09:00','17:00'),
('0236ef6b-3d71-42fa-a268-31970a762306',3,'09:00','17:00'),
('0236ef6b-3d71-42fa-a268-31970a762306',4,'09:00','17:00'),
('0236ef6b-3d71-42fa-a268-31970a762306',5,'09:00','17:00'),
('9bd27341-172d-4ded-bc54-d7168b600702',1,'09:00','17:00'),
('9bd27341-172d-4ded-bc54-d7168b600702',2,'09:00','17:00'),
('9bd27341-172d-4ded-bc54-d7168b600702',3,'09:00','17:00'),
('9bd27341-172d-4ded-bc54-d7168b600702',4,'09:00','17:00'),
('9bd27341-172d-4ded-bc54-d7168b600702',5,'09:00','17:00'),
('6cbf6efc-1f7f-4aba-b1dc-ba130be23873',1,'09:00','17:00'),
('6cbf6efc-1f7f-4aba-b1dc-ba130be23873',2,'09:00','17:00'),
('6cbf6efc-1f7f-4aba-b1dc-ba130be23873',3,'09:00','17:00'),
('6cbf6efc-1f7f-4aba-b1dc-ba130be23873',4,'09:00','17:00'),
('6cbf6efc-1f7f-4aba-b1dc-ba130be23873',5,'09:00','17:00'),
('fbdc508c-6397-4e96-bcb4-252e1f3ff18c',1,'09:00','17:00'),
('fbdc508c-6397-4e96-bcb4-252e1f3ff18c',2,'09:00','17:00'),
('fbdc508c-6397-4e96-bcb4-252e1f3ff18c',3,'09:00','17:00'),
('fbdc508c-6397-4e96-bcb4-252e1f3ff18c',4,'09:00','17:00'),
('fbdc508c-6397-4e96-bcb4-252e1f3ff18c',5,'09:00','17:00'),
('78d18121-fbfc-4900-a6a1-3f4933d86cbe',1,'10:00','16:00'),
('78d18121-fbfc-4900-a6a1-3f4933d86cbe',2,'10:00','16:00'),
('78d18121-fbfc-4900-a6a1-3f4933d86cbe',3,'10:00','16:00'),
('78d18121-fbfc-4900-a6a1-3f4933d86cbe',4,'10:00','16:00'),
('78d18121-fbfc-4900-a6a1-3f4933d86cbe',5,'10:00','16:00'),
('78d18121-fbfc-4900-a6a1-3f4933d86cbe',6,'10:00','16:00'),
('b5e800a0-48ec-41af-aae9-03ecc70de758',1,'09:00','16:00'),
('b5e800a0-48ec-41af-aae9-03ecc70de758',2,'09:00','16:00'),
('b5e800a0-48ec-41af-aae9-03ecc70de758',3,'09:00','16:00'),
('b5e800a0-48ec-41af-aae9-03ecc70de758',4,'09:00','16:00'),
('b5e800a0-48ec-41af-aae9-03ecc70de758',5,'09:00','16:00'),
('17c5408b-b7b8-4248-b676-b60cccdb2080',1,'11:00','17:00'),
('17c5408b-b7b8-4248-b676-b60cccdb2080',2,'11:00','17:00'),
('17c5408b-b7b8-4248-b676-b60cccdb2080',3,'11:00','17:00'),
('17c5408b-b7b8-4248-b676-b60cccdb2080',4,'11:00','17:00'),
('17c5408b-b7b8-4248-b676-b60cccdb2080',5,'11:00','17:00'),
('61f27c42-7c01-4c98-9471-24896ee0cef2',1,'09:00','17:00'),
('61f27c42-7c01-4c98-9471-24896ee0cef2',2,'09:00','17:00'),
('61f27c42-7c01-4c98-9471-24896ee0cef2',3,'09:00','17:00'),
('61f27c42-7c01-4c98-9471-24896ee0cef2',4,'09:00','17:00'),
('61f27c42-7c01-4c98-9471-24896ee0cef2',5,'09:00','17:00'),
('d6e66926-c42c-4ec6-970b-c38d3642fa59',1,'08:00','18:00'),
('d6e66926-c42c-4ec6-970b-c38d3642fa59',2,'08:00','18:00'),
('d6e66926-c42c-4ec6-970b-c38d3642fa59',3,'08:00','18:00'),
('d6e66926-c42c-4ec6-970b-c38d3642fa59',4,'08:00','18:00'),
('d6e66926-c42c-4ec6-970b-c38d3642fa59',5,'08:00','18:00'),
('4d0aebc6-ce24-4afd-9e0b-d01086c9ba4b',1,'09:00','18:00'),
('4d0aebc6-ce24-4afd-9e0b-d01086c9ba4b',2,'09:00','18:00'),
('4d0aebc6-ce24-4afd-9e0b-d01086c9ba4b',3,'09:00','18:00'),
('4d0aebc6-ce24-4afd-9e0b-d01086c9ba4b',4,'09:00','18:00'),
('4d0aebc6-ce24-4afd-9e0b-d01086c9ba4b',5,'09:00','18:00'),
('72850698-6fcd-45b4-87ff-0c6fddab8f33',1,'10:00','16:00'),
('72850698-6fcd-45b4-87ff-0c6fddab8f33',2,'10:00','16:00'),
('72850698-6fcd-45b4-87ff-0c6fddab8f33',3,'10:00','16:00'),
('72850698-6fcd-45b4-87ff-0c6fddab8f33',4,'10:00','16:00'),
('72850698-6fcd-45b4-87ff-0c6fddab8f33',5,'10:00','16:00'),
('d054c5fa-b123-4f18-827b-0dd6dadb7309',1,'10:00','18:00'),
('d054c5fa-b123-4f18-827b-0dd6dadb7309',2,'10:00','18:00'),
('d054c5fa-b123-4f18-827b-0dd6dadb7309',3,'10:00','18:00'),
('d054c5fa-b123-4f18-827b-0dd6dadb7309',4,'10:00','18:00'),
('d054c5fa-b123-4f18-827b-0dd6dadb7309',5,'10:00','18:00'),
('d054c5fa-b123-4f18-827b-0dd6dadb7309',6,'10:00','18:00'),
('6cc157e9-5816-4c4a-b421-4382df1eecb0',1,'10:00','18:00'),
('6cc157e9-5816-4c4a-b421-4382df1eecb0',2,'10:00','18:00'),
('6cc157e9-5816-4c4a-b421-4382df1eecb0',3,'10:00','18:00'),
('6cc157e9-5816-4c4a-b421-4382df1eecb0',4,'10:00','18:00'),
('6cc157e9-5816-4c4a-b421-4382df1eecb0',5,'10:00','18:00'),
('ad10acde-0f7d-4da0-910d-5ed6d34955ff',1,'10:00','18:00'),
('ad10acde-0f7d-4da0-910d-5ed6d34955ff',2,'10:00','18:00'),
('ad10acde-0f7d-4da0-910d-5ed6d34955ff',3,'10:00','18:00'),
('ad10acde-0f7d-4da0-910d-5ed6d34955ff',4,'10:00','18:00'),
('ad10acde-0f7d-4da0-910d-5ed6d34955ff',5,'10:00','18:00'),
('376d9320-aeed-4960-b3de-a2df9fb6baa0',1,'10:00','18:00'),
('376d9320-aeed-4960-b3de-a2df9fb6baa0',2,'10:00','18:00'),
('376d9320-aeed-4960-b3de-a2df9fb6baa0',3,'10:00','18:00'),
('376d9320-aeed-4960-b3de-a2df9fb6baa0',4,'10:00','18:00'),
('376d9320-aeed-4960-b3de-a2df9fb6baa0',5,'10:00','18:00'),
('18acf8d2-2d71-476d-bd16-18e140336032',1,'10:00','17:00'),
('18acf8d2-2d71-476d-bd16-18e140336032',2,'10:00','17:00'),
('18acf8d2-2d71-476d-bd16-18e140336032',3,'10:00','17:00'),
('18acf8d2-2d71-476d-bd16-18e140336032',4,'10:00','17:00'),
('18acf8d2-2d71-476d-bd16-18e140336032',5,'10:00','17:00'),
('e4fb1bab-0f92-4984-9e17-581527f64d0b',1,'11:00','15:00'),
('e4fb1bab-0f92-4984-9e17-581527f64d0b',2,'11:00','15:00'),
('e4fb1bab-0f92-4984-9e17-581527f64d0b',3,'11:00','15:00'),
('e4fb1bab-0f92-4984-9e17-581527f64d0b',4,'11:00','15:00'),
('e4fb1bab-0f92-4984-9e17-581527f64d0b',5,'11:00','15:00'),
('b0497816-0ccd-43c3-be9c-81d822e25ec4',1,'13:00','18:00'),
('b0497816-0ccd-43c3-be9c-81d822e25ec4',2,'13:00','18:00'),
('b0497816-0ccd-43c3-be9c-81d822e25ec4',3,'13:00','18:00'),
('b0497816-0ccd-43c3-be9c-81d822e25ec4',4,'13:00','18:00'),
('b0497816-0ccd-43c3-be9c-81d822e25ec4',5,'13:00','18:00'),
('25814c85-9e3f-4a0e-a5a3-35485e2e3042',1,'13:00','15:00'),
('25814c85-9e3f-4a0e-a5a3-35485e2e3042',2,'13:00','15:00'),
('25814c85-9e3f-4a0e-a5a3-35485e2e3042',3,'13:00','15:00'),
('25814c85-9e3f-4a0e-a5a3-35485e2e3042',4,'13:00','15:00'),
('25814c85-9e3f-4a0e-a5a3-35485e2e3042',5,'13:00','15:00')
on conflict do nothing;
insert into public.chat_unit_atendimento (unit_id, atende_chat, observacao) values
('654f3546-d363-4461-be8f-e8bd05df9c75',true,'mogidascruzes001: horário observado 14 d (p10/p90), 2 operador(es)'),
('c6db5796-b260-4b8a-8ec3-f30750d8c08f',true,'bhvendanova001: horário observado 14 d (p10/p90), 1 operador(es)'),
('18205c5d-2723-491f-b42d-451d5c9484f1',true,'vitoria001: horário observado 14 d (p10/p90), 4 operador(es)'),
('72bb4e8c-c913-494a-876b-2c6fd812a010',true,'caraguatatuba001: horário observado 14 d (p10/p90), 4 operador(es)'),
('8892c30a-3f82-4f1e-a724-c1854d78df93',true,'ibirite: horário observado 14 d (p10/p90), 2 operador(es)'),
('0236ef6b-3d71-42fa-a268-31970a762306',true,'bhoeste001: horário observado 14 d (p10/p90), 1 operador(es)'),
('9bd27341-172d-4ded-bc54-d7168b600702',true,'colatina001: horário observado 14 d (p10/p90), 2 operador(es)'),
('6cbf6efc-1f7f-4aba-b1dc-ba130be23873',true,'trescoracoes001: horário observado 14 d (p10/p90), 1 operador(es)'),
('fbdc508c-6397-4e96-bcb4-252e1f3ff18c',true,'portoalegre001: horário observado 14 d (p10/p90), 1 operador(es)'),
('78d18121-fbfc-4900-a6a1-3f4933d86cbe',true,'sapopemba001: horário observado 14 d (p10/p90), 1 operador(es)'),
('b5e800a0-48ec-41af-aae9-03ecc70de758',true,'itapecerica001: horário observado 14 d (p10/p90), 6 operador(es)'),
('17c5408b-b7b8-4248-b676-b60cccdb2080',true,'campolimpo001: horário observado 14 d (p10/p90), 1 operador(es)'),
('61f27c42-7c01-4c98-9471-24896ee0cef2',true,'araruama001: horário observado 14 d (p10/p90), 1 operador(es)'),
('d6e66926-c42c-4ec6-970b-c38d3642fa59',true,'patrocinio001: horário observado 14 d (p10/p90), 3 operador(es)'),
('4d0aebc6-ce24-4afd-9e0b-d01086c9ba4b',true,'saojoaodelrey001: horário observado 14 d (p10/p90), 2 operador(es)'),
('72850698-6fcd-45b4-87ff-0c6fddab8f33',true,'tatuape001: horário observado 14 d (p10/p90), 1 operador(es)'),
('d054c5fa-b123-4f18-827b-0dd6dadb7309',true,'cabofrio001: horário observado 14 d (p10/p90), 1 operador(es)'),
('6cc157e9-5816-4c4a-b421-4382df1eecb0',true,'guriri001: horário observado 14 d (p10/p90), 3 operador(es)'),
('ad10acde-0f7d-4da0-910d-5ed6d34955ff',true,'itauna001: horário observado 14 d (p10/p90), 1 operador(es)'),
('376d9320-aeed-4960-b3de-a2df9fb6baa0',true,'mariana001: horário observado 14 d (p10/p90), 3 operador(es)'),
('18acf8d2-2d71-476d-bd16-18e140336032',true,'freguesia001: horário observado 14 d (p10/p90), 1 operador(es)'),
('e4fb1bab-0f92-4984-9e17-581527f64d0b',true,'setelagoas001: horário observado 14 d (p10/p90), 1 operador(es)'),
('b0497816-0ccd-43c3-be9c-81d822e25ec4',true,'parademinas001: horário observado 14 d (p10/p90), 2 operador(es)'),
('25814c85-9e3f-4a0e-a5a3-35485e2e3042',true,'aracruz001: horário observado 14 d (p10/p90), 1 operador(es)'),
('b4b497d0-03df-499a-8a88-03f2a9640244',false,'barradesaofrancisco001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('938c9dd8-c9c5-4cfe-be28-46bba0b2a397',false,'barueri001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('1ddf352e-6653-4c04-be47-0bfb28778f3f',false,'estancia001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('a346bc48-3453-437c-9cd9-861b2c0d3515',false,'formiga001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('34724787-560b-43bd-93a8-e16ef22e21d5',false,'itaguai001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('5077433e-6a4a-484b-845c-dddbe34fa9b6',false,'marica001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('4a12ba7c-cb88-428c-a0f0-a294d486ab06',false,'pousoalegre001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('28f72f49-ad0b-49f4-b46f-19818f498bc4',false,'teixeiradefreitas001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('a8a4a300-2f97-438c-a840-edf25cf08e86',false,'valedoaco001: nenhuma mensagem de operador em 14 d até 04/11/2026'),
('b16e7ad5-09bc-48cc-94f1-bca236b0f64c',false,'varginha001: nenhuma mensagem de operador em 14 d até 04/11/2026')
on conflict (unit_id) do nothing;

create or replace function public.chat_unit_disponibilidade(p_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_at       public.chat_unit_atendimento%rowtype;
  v_atende   boolean;
  v_tz       text;
  v_local    timestamp;
  v_dow      int;
  v_tem_h    boolean;
  v_dentro   boolean;
  v_prox     text;
  v_rec      record;
  v_dias     text[] := array['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
begin
  select * into v_at from public.chat_unit_atendimento where unit_id = p_unit_id;
  v_atende := coalesce(v_at.atende_chat, true);
  select tz into v_tz from public.chat_unit_hours where unit_id = p_unit_id limit 1;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_local := now() at time zone v_tz;
  v_dow := extract(dow from v_local)::int;
  v_tem_h := exists (select 1 from public.chat_unit_hours where unit_id = p_unit_id);
  if not v_tem_h then
    v_dentro := true;
  else
    v_dentro := exists (select 1 from public.chat_unit_hours h
                         where h.unit_id = p_unit_id and h.dow = v_dow
                           and v_local::time >= h.abre and v_local::time < h.fecha);
  end if;
  if v_tem_h and not v_dentro then
    -- próxima faixa nos próximos 7 dias (hoje mais tarde conta)
    select d.off, h.abre into v_rec
      from generate_series(0, 7) as d(off)
      join public.chat_unit_hours h on h.unit_id = p_unit_id and h.dow = ((v_dow + d.off) % 7)
     where d.off > 0 or h.abre > v_local::time
     order by d.off, h.abre limit 1;
    if v_rec.off is not null then
      v_prox := case when v_rec.off = 0 then 'hoje às ' when v_rec.off = 1 then 'amanhã às '
                     else v_dias[((v_dow + v_rec.off) % 7) + 1] || ' às ' end || to_char(v_rec.abre, 'HH24:MI');
    end if;
  end if;
  return jsonb_build_object(
    'atende_chat', v_atende, 'dentro_horario', v_dentro,
    'disponivel', (v_atende and v_dentro),
    'operadores_online', null,            -- fase 1 (presença) preenche
    'proximo_horario', v_prox, 'telefone', v_at.telefone,
    'motivo', case when not v_atende then 'unidade_sem_chat' when not v_dentro then 'fora_horario' else null end,
    'agora_local', to_char(v_local, 'Dy HH24:MI'));
end;
$$;
revoke all on function public.chat_unit_disponibilidade(uuid) from public, anon, authenticated;
grant execute on function public.chat_unit_disponibilidade(uuid) to service_role;
comment on function public.chat_unit_disponibilidade(uuid) is 'Fase 0 (04/11/2026): a edge agent-tools consulta antes de enfileirar repasse; a IA deixa de prometer equipe fora do horário / em unidade sem chat.';

-- amostra fina (<=3 dias ativos): errar pro lado aberto
delete from public.chat_unit_hours where unit_id in ('25814c85-9e3f-4a0e-a5a3-35485e2e3042','b0497816-0ccd-43c3-be9c-81d822e25ec4','18acf8d2-2d71-476d-bd16-18e140336032','17c5408b-b7b8-4248-b676-b60cccdb2080');
insert into public.chat_unit_hours (unit_id, dow, abre, fecha)
select u, d, '09:00', '18:00' from unnest(array['25814c85-9e3f-4a0e-a5a3-35485e2e3042','b0497816-0ccd-43c3-be9c-81d822e25ec4','18acf8d2-2d71-476d-bd16-18e140336032','17c5408b-b7b8-4248-b676-b60cccdb2080']::uuid[]) u, generate_series(1,5) d on conflict do nothing;
update public.chat_unit_atendimento set observacao = observacao || ' | amostra fina: 09–18 seg–sex' where unit_id in ('25814c85-9e3f-4a0e-a5a3-35485e2e3042','b0497816-0ccd-43c3-be9c-81d822e25ec4','18acf8d2-2d71-476d-bd16-18e140336032','17c5408b-b7b8-4248-b676-b60cccdb2080');
