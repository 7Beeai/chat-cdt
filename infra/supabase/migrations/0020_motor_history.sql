-- ---------------------------------------------------------------------------
-- 0020 — chat_motor_history: histórico de disparos do Motor V2 na thread
--
-- Substitui chat_cadence_history (0019), desligada em 2026-06-10 porque o
-- message_log tinha parado de ser alimentado. Em 2026-06-12 os 27 workflows
-- de disparo (14 cobrança + 13 relacionamento) foram instrumentados e TODA
-- franquia passou a gravar cada envio em message_log — agora com
-- `mensagem_texto` (corpo do template já renderizado, {{n}} substituídos).
-- Isso elimina a reconstrução via template_inventory + heurística de exemplos
-- da 0019; o inventário vira só fallback (raro: template fora do inventory).
--
-- Mudanças vs 0019:
--   1. Corpo vem de message_log.mensagem_texto (validado com envios reais).
--   2. Corte de data (p_since, default 2026-06-12): NUNCA mostrar disparos
--      retroativos — decisão do Victor em docs/13 (linhas antigas do
--      message_log não têm mensagem_texto e confundiriam as operadoras).
--   3. disparos_log removido: nunca foi populado (0 linhas em produção).
--   4. Inbound de message_inbound entra como rede de segurança, dedupado por
--      wamid contra messages — cobre janelas em que o webhook do CHAT-CDT
--      perdeu eventos (o n8n recebe o próprio webhook em paralelo).
--      Dedup do inbound é GLOBAL (qualquer conversation), não por conversa:
--      verificado em produção (2026-06-12) que todo "gap" por-conversa era
--      mensagem vivendo em OUTRA conversa do mesmo contato (fechada vs nova)
--      — dedup por conversa injetaria duplicatas visuais. Outbound segue
--      dedup por conversa (motor nunca grava em messages; comportamento 0019).
--
-- Somente leitura, SECURITY DEFINER gated por chat_user_has_unit, nenhuma
-- tabela do n8n é alterada.
--
-- PRÉ-REQUISITO (rodar UMA vez, fora de transação — mesma estratégia da 0019;
-- idx_ml_unit_matchkey já existe):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mi_unit_matchkey
--     ON public.message_inbound (unit_id, public.chat_phone_match_key(from_phone));
-- ---------------------------------------------------------------------------

drop function if exists public.chat_cadence_history(uuid);

create or replace function public.chat_motor_history(
  p_conversation_id uuid,
  p_since timestamptz default '2026-06-12 00:00:00-03'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_unit  uuid;
  v_wa    text;
  v_key   text;
  v_waba  text;
  v_out   jsonb;
begin
  select co.unit_id, ct.wa_id, w.waba_id
    into v_unit, v_wa, v_waba
  from public.conversations co
  join public.contacts ct on ct.id = co.contact_id
  left join public.chat_phone_numbers pn on pn.id = co.phone_number_id
  left join public.wabas w on w.id = pn.waba_id
  where co.id = p_conversation_id;

  if v_unit is null then return null; end if;
  if not public.chat_user_has_unit(v_unit) then return null; end if;

  v_key := public.chat_phone_match_key(v_wa);
  if v_key is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(r.obj order by r.ts), '[]'::jsonb)
    into v_out
  from (
    select * from (
      -- OUT: disparos do motor (message_log)
      select ml.sent_at as ts,
             jsonb_build_object(
               'id',            'ml-' || ml.id::text,
               'dir',           'out',
               'ts',            ml.sent_at,
               'status',        ml.status,
               'wa_message_id', ml.wa_message_id,
               'template_name', ml.template_name,
               'fase',          ml.cadence_fase,
               'texto',         ml.mensagem_texto,
               'body',          case when ml.mensagem_texto is null then ti.body_text end,
               'example',       case when ml.mensagem_texto is null then ti.example end
             ) as obj
      from public.message_log ml
      left join lateral (
        select coalesce(
                 t.body_text,
                 (select comp->>'text'
                  from jsonb_array_elements(t.components) comp
                  where comp->>'type' = 'BODY'
                  limit 1)
               ) as body_text,
               (select comp->'example'->'body_text'->0
                from jsonb_array_elements(t.components) comp
                where comp->>'type' = 'BODY'
                limit 1) as example
        from public.template_inventory t
        where t.waba_id = v_waba
          and t.template_name = ml.template_name
        limit 1
      ) ti on true
      where ml.unit_id = v_unit
        and public.chat_phone_match_key(ml.to_whatsapp) = v_key
        and ml.sent_at >= p_since
        and (ml.wa_message_id is null or not exists (
              select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.wa_message_id = ml.wa_message_id
            ))

      union all

      -- IN: respostas do cliente que o webhook do CHAT-CDT não capturou
      select mi.received_at,
             jsonb_build_object(
               'id',            'mi-' || mi.id::text,
               'dir',           'in',
               'ts',            mi.received_at,
               'wa_message_id', mi.wamid,
               'texto',         mi.body
             )
      from public.message_inbound mi
      where mi.unit_id = v_unit
        and public.chat_phone_match_key(mi.from_phone) = v_key
        and mi.received_at >= p_since
        and mi.body is not null
        -- dedup GLOBAL: messages_wa_message_id_key (unique) torna isso barato
        and (mi.wamid is null or not exists (
              select 1 from public.messages m
              where m.wa_message_id = mi.wamid
            ))
    ) u
    order by u.ts desc
    limit 100
  ) r;

  return v_out;
end;
$$;

comment on function public.chat_motor_history(uuid, timestamptz) is
  'Histórico do Motor V2 para o telefone+unidade da conversa: disparos de template (message_log, corpo renderizado em mensagem_texto) + inbounds não capturados pelo webhook próprio (message_inbound), ambos dedupados contra messages por wa_message_id/wamid e cortados em p_since (default 2026-06-12, início da instrumentação). Somente leitura, gated por chat_user_has_unit.';

revoke all on function public.chat_motor_history(uuid, timestamptz) from public;
grant execute on function public.chat_motor_history(uuid, timestamptz) to authenticated;
