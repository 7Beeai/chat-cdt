# messages

## Identificação
- **Nome**: `public.messages`
- **Dono provável**: **CHAT-CDT** (criada na migration `0001_init.sql`; nome sem prefixo `chat_` por não colidir com o n8n — ver CLAUDE.md). Mas é **escrita também pela IA do n8n** via RPC, daí a classificação Compartilhada.
- **Linhas estimadas**: ~22.203 (n_live_tup 23.452) — bloco-01.
- **Tamanho**: 16 MB total (heap 11 MB) — bloco-01.
- **Classificação**: **Compartilhada**. Tabela núcleo do CHAT-CDT (histórico de toda mensagem da conversa), mas alimentada por três writers: webhook Meta (app), `chat_record_outbound_message` (n8n/IA) e `/api/messages/send` (operador). Lida por inbox, relatórios e Realtime.
- **Bloat / health**: ~743 bytes/linha (16 MB / 22,2k) — saudável para uma tabela com coluna `payload jsonb` (o corpo Meta inteiro é guardado). n_dead_tup 369 sobre 23k é baixo; autovacuum/autoanalyze recentes (01/06). **Sem `last_analyze` manual** (só autoanalyze) — esperado. `seq_scan = 0` e `idx_scan = 166.150`: 100% indexada, nenhuma varredura sequencial — excelente.

## Finalidade
Histórico append-quase-only de todas as mensagens de cada conversa de WhatsApp, em ambos os sentidos (`in` cliente → `out` IA/operador/sistema). Guarda o `payload` Meta cru (texto, template, mídia, interactive, reaction…), o estado de entrega (`status`/`error`) e a autoria (`sent_by`/`operator_id`). É a fonte do thread no inbox, dos KPIs de split de mensagens nos relatórios e do trigger que mantém a janela de 24h da Meta.

## Colunas
`#` = ordinal (`pos`). Não há gaps de ordinal (1→11 contínuo) → nenhuma coluna droppada.

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NO | `gen_random_uuid()` | default do banco (DDL `0001_init`) | PK; lido pelo backfill de mídia (`media/backfill/route.ts` select `id`) e pelo thread; FK alvo de nada externo | inferido (nome genérico, mas writer único = default) |
| 2 | `conversation_id` | uuid | NO | — | app/RPC no INSERT (webhook, `chat_record_outbound_message`, `/messages/send`, composer) | FK→`conversations.id` (ON DELETE CASCADE); índice `(conversation_id, created_at DESC)`; lido por inbox thread (`WHERE conversation_id = $1`), por `chat_report_overview` (join), por queries PostgREST do stat | **confirmado** (FK `messages_conversation_id_fkey`; INSERTs literais em webhook L180+, send L128, RPC L84) |
| 3 | `wa_message_id` | text | YES | — | id retornado pela Graph API: `msg.id` no inbound (webhook L183), `result.waMessageId` no outbound (send L128), `p_wa_message_id` no RPC (L89). NULL para mensagens só-internas | **Chave de idempotência e de atualização de status.** UNIQUE `messages_wa_message_id_key`. Lido/usado por: status-update do webhook (`UPDATE … WHERE wa_message_id = $`, stat queryid 1554386718196490500, 80.425 calls), patch de mídia (queryid 8268714533283783000), upsert de inbound (`onConflict: 'wa_message_id'`), backfill de mídia | **confirmado** (constraint UNIQUE + uso literal em webhook L266/L322, send, RPC L96 `on conflict (wa_message_id)`) |
| 4 | `direction` | `chat_message_direction` (enum) | NO | — | hardcoded por writer: `'in'` no webhook (L184), `'out'` no send (L129), RPC (L91) e composer (L105) | **trigger** `chat_bump_conversation_window` (`if new.direction = 'in'`); `chat_report_overview` (split cliente/IA/operador); thread-client UI (`msg.direction === 'in'`, L56); stat select queryid -132043571575283760 | **confirmado** (trigger def lê `new.direction`; `chat_report_overview` reads confirmado; INSERTs literais) |
| 5 | `type` | text | NO | — | app/RPC: `msg.type` da Meta no inbound (webhook L185), `'text'` no send, `p_type` no RPC | thread-client (escolhe renderização: `payload[type]`, L199/L610); backfill de mídia (`select … type`, filtra mídia); stat select | **confirmado** (INSERT literal; leitura literal `row.type`/`msg.type` em thread e backfill) |
| 6 | `payload` | jsonb | NO | — | app/RPC: corpo Meta cru. Inbound = `msg` inteiro (webhook L186); outbound = `graphBody` (send L131) / `p_payload` (RPC); composer = `{text:{body,…}}`. **Mutável**: patcheado com `media.storage_path` (webhook L265, backfill L121) | thread-client (renderiza texto/template/imagem/reaction/interactive — L576-624); `chat_report_overview` (lido no CTE, embora só direction/sent_by/created_at sejam agregados); backfill; stat select queryid -132043571575283760 (lista N convs) | **confirmado** (INSERTs/UPDATEs literais; leituras literais `row.payload`/`msg.payload`) |
| 7 | `status` | `chat_message_status` (enum) | NO | `'pending'` | default `'pending'`; webhook outbound seta via status-update da Meta (`UPDATE … SET status` L319); RPC default `'sent'` (L94); send/composer não setam → default | webhook status-update (stat queryid 1554386718196490500, **80.425 calls** — o write mais quente da tabela na janela); thread-client (ticks de entrega, leitura indireta) | **confirmado** (UPDATE literal webhook L319; default no DDL) — nome genérico mas writer/reader rastreados |
| 8 | `error` | jsonb | YES | — | webhook: `st.errors ?? null` no status-update (L320) quando a Meta reporta falha de entrega | **lido** pelo thread full-row SELECT (stat queryid -7841077088137870000 seleciona as 11 colunas, inclusive `error`), mas **não é renderizado na UI nem agregado** em nenhum report → uso só diagnóstico/forense. Co-atualizado com `status` na mesma query de write (stat 1554386718196490500) | **confirmado** (UPDATE literal `SET error` webhook L320; SELECT literal de `error` no stat do thread) |
| 9 | `sent_by` | `chat_sender_kind` (enum) | NO | — | hardcoded por writer: `'customer'` inbound (webhook L187), `'operator'` send (L132)/composer (L110), `'ai'`/`'system'` no RPC (`p_sent_by` default `'ai'`, L93) | `chat_report_overview` (split cliente/IA/operador — reads confirmado); thread-client (`msg.sent_by === 'operator'`/`'ai'` decide bolha e label, L57-58) | **confirmado** (INSERTs literais; `chat_report_overview` reads confirmado; leitura literal no thread) |
| 10 | `operator_id` | uuid | YES | — | só preenchido no outbound do operador: `user.id` no `/messages/send` (L133) e composer (L111). NULL para inbound, IA e sistema | thread-client (resolve nome do operador na bolha: `group.messages[0]?.operator_id` → `operatorNames`, L383); FK→`auth.users.id` | **confirmado** (FK `messages_operator_id_fkey`→users; INSERT literal `operator_id: user.id` send L133; leitura literal thread L383) |
| 11 | `created_at` | timestamptz | NO | `now()` | default do banco | trigger `chat_bump_conversation_window` (usa `new.created_at` p/ `last_inbound_at` e `customer_window_expires_at = +24h`); índice `(conversation_id, created_at DESC)`; `chat_report_overview` (série temporal/hora); ordenação do thread (`ORDER BY created_at`, stat queryids -7841… e -132043…) | **confirmado** (trigger lê `new.created_at`; índice; ORDER BY literal nos stats) |

### Enums referenciados (origem dos domínios)
- `chat_message_direction` — `in` | `out` (definido em `0001_init`).
- `chat_message_status` — inclui `pending`/`sent`/`delivered`/`read`/`failed` (uso no RPC L94 e webhook).
- `chat_sender_kind` — `customer` | `operator` | `ai` | `system` (uso nos writers).

## Relacionamentos (FKs)
- **Saindo**:
  - `messages_conversation_id_fkey`: `conversation_id` → `conversations.id`, **ON DELETE CASCADE** (apagar conversa apaga mensagens), ON UPDATE no action. (bloco-03)
  - `messages_operator_id_fkey`: `operator_id` → `users.id` (auth.users), **ON DELETE no action** (apagar usuário NÃO é tratado em cascata — pode bloquear delete de auth user, mas deletes de usuário não ocorrem na prática). (bloco-03)
- **Entrando**: nenhuma FK referencia `messages` (bloco-03 sem `ref_tabela==messages`). O backfill de mídia e o thread referenciam logicamente por `wa_message_id`/`id`, sem constraint.

## Índices
(bloco-04) Todos os 3 índices são **muito usados** — nenhum desperdício.

| índice | tipo | idx_scan | bytes | nota |
|--------|------|----------|-------|------|
| `messages_conversation_id_created_at_idx` `(conversation_id, created_at DESC)` | btree | 72.153 | 1,18 MB | Serve o thread (`WHERE conversation_id ORDER BY created_at`) e os reports. Ponta de lança. |
| `messages_wa_message_id_key` `(wa_message_id)` UNIQUE | btree | 89.269 | 2,94 MB | Idempotência + status-update/patch por `wa_message_id`. O mais escaneado (status updates da Meta são altíssima frequência). |
| `messages_pkey` `(id)` UNIQUE/PK | btree | 4.745 | 1,02 MB | PK. |

### Índices nunca usados (idx_scan=0)
**Nenhum.** Desperdício = **0 MB**. Cobertura de índices ótima para esta tabela.

## Triggers
(bloco-06) Um único trigger:
- **`trg_chat_bump_window`** — `AFTER INSERT … FOR EACH ROW`, executa `chat_bump_conversation_window()`. A função (bloco-05b) só age quando `new.direction = 'in'`: atualiza `conversations.last_inbound_at = new.created_at` e `customer_window_expires_at = new.created_at + interval '24 hours'`. É o mecanismo que mantém a **janela de 24h da Meta** mencionado no CLAUDE.md (que cita o trigger por esse mesmo nome). Não há trigger em UPDATE/DELETE.

## RLS / Policies
- **RLS ligada** (`rls_on=true`), `rls_forced=false` → service_role (webhook fallback, RPC SECURITY DEFINER) **bypassa** a policy.
- **1 policy** (bloco-09): `chat_msg_all` — PERMISSIVE, role `public`, cmd **ALL**:
  ```sql
  EXISTS (SELECT 1 FROM conversations c
          WHERE c.id = messages.conversation_id
            AND chat_user_has_unit(c.unit_id))
  ```
  Isto é: o operador só vê/escreve mensagens de conversas das suas unidades, via o helper SECURITY DEFINER `chat_user_has_unit` (consistente com a memória sobre RLS de `user_units`). `with_check = null` → para INSERT/UPDATE o Postgres usa o `qual` como check.
- **Sem policies duplicadas/sobrepostas** (uma só, cobrindo ALL). Limpo.
- Observação de segurança: como o `qual` faz `EXISTS` em `conversations`, qualquer INSERT por usuário `authenticated` exige que a conversa já pertença à unidade dele. Os writers de produção que poderiam falhar nisso (`chat_record_outbound_message` para o n8n) são SECURITY DEFINER e contornam RLS de forma controlada (ver migration 0011_record_outbound_message, L8-10). O `/messages/send` faz fallback para service-role se o insert com cookie-client falhar (send L139-142).

## Quem escreve / Quem lê
**Escrevem (3 writers + 1 patch):**
1. **Webhook Meta** `app/api/meta/webhook/route.ts` — INSERT/upsert de inbound do cliente (`onConflict: wa_message_id`, L180-190, `sent_by='customer'`, `direction='in'`); UPDATE de `payload` com `storage_path` de mídia (L264-266); UPDATE de `status`+`error` a partir dos `statuses[]` da Meta (L317-322). É o write mais quente: status-update com **80.425 calls** na janela (stat 1554386718196490500).
2. **`chat_record_outbound_message`** (RPC SECURITY DEFINER, migration `0011_record_outbound_message.sql`) — INSERT do outbound da **IA do n8n** (`direction='out'`, `sent_by='ai'`/`'system'`, idempotente por `wa_message_id`). Corresponde ao INSERT de 7 colunas no stat (queryid 6685195972638397000, 3.844 calls). **Único ponto de escrita do n8n** — não toca tabelas do fluxo n8n.
3. **`/api/messages/send`** + **composer-bar** — INSERT do outbound do **operador** (`sent_by='operator'`, `operator_id=user.id`, L128-137); fallback service-role em falha de RLS (L140).
4. (patch) **`/api/internal/media/backfill`** — UPDATE de `payload` para reanexar `storage_path` de mídia faltante (L120-121).

**Leem:**
- **Inbox thread** — `thread-client.tsx` (render por `type`/`payload`/`direction`/`sent_by`/`operator_id`), via `WHERE conversation_id ORDER BY created_at` (stat -7841077088137870000, 96 calls) e Realtime (subscribe em INSERT/UPDATE de `messages`).
- **Lista do inbox** — query de última mensagem por conversa (stat -132043571575283760, **mean 279 ms**, lê `conversation_id, payload, direction, created_at, type` por `conversation_id = ANY($1)`).
- **`chat_report_overview`** (migration `0012_report_rpcs.sql`) — agrega `direction`/`sent_by`/`created_at`/`conversation_id` para split cliente/IA/operador, série diária e distribuição por hora (functions-analysis: reads confirmado).
- **`chat_bump_conversation_window`** (trigger) — lê `direction`/`created_at`/`conversation_id`.
- **Backfill de mídia** — lê `id, conversation_id, wa_message_id, type, payload`.

**Não consomem**: edge-functions.json não tem `messages` nas `tables` (edge functions falam via RPC/outras tabelas). As ocorrências de "messages" em n8n-workflows.json são do campo `change.field='messages'` do payload Meta / nomes de workflow de relacionamento, **não** acesso à tabela — o n8n só escreve via a RPC.

## Observações
- **`error` é lida mas nunca usada num produto** — entra no SELECT full-row do thread (stat -7841077088137870000), mas nenhuma superfície de UI a renderiza nem nenhum report a agrega. Tecnicamente tem consumidor de leitura (a query do thread), porém de uso só diagnóstico/forense. Não é "morta" nem "sem consumidor".
- **`wa_message_id` é nullable mas é a espinha dorsal operacional** — toda a máquina de status/idempotência depende dela. Mensagens internas sem `wa_message_id` (ex.: futuras notas) escapariam do UNIQUE (múltiplos NULL permitidos) e do status-update. Hoje todos os writers preenchem (webhook/send/RPC), então o risco é latente, não atual.
- **Hot path real ≠ "histórico append-only"**: a tabela recebe muito mais UPDATE de `status` (80k+ calls/janela) do que INSERT (3,8k+0,5k). O custo dominante é manter `status`/`error`/`payload` sincronizados com a Meta, não inserir. O índice UNIQUE em `wa_message_id` é o que sustenta isso.
- **Query de lista cara**: o stat -132043571575283760 (lista de últimas mensagens por conjunto de conversas) tem **mean 279 ms** — de longe a query mais lenta que toca `messages`. Candidata a otimização (ex.: `DISTINCT ON (conversation_id) … ORDER BY conversation_id, created_at DESC` apoiado no índice, ou uma coluna `last_message` materializada em `conversations`). Não é bug, mas é o gargalo da tabela.
- **Comentário da tabela: NULL** (bloco-01) — sem `COMMENT ON TABLE`. A função-writer tem comentário rico, mas a tabela em si não documenta finalidade no banco. Pequena dívida de documentação.
- **Coerência doc↔banco**: a migration `0011_record_outbound_message.sql` tem cabeçalho `-- 0009_record_outbound_message.sql` (numeração interna divergente do nome do arquivo). Não afeta runtime, mas é uma inconsistência de rastreabilidade. `docs/04-n8n-contract.md` e `docs/03-database.md` descrevem `messages` — consistentes com o DDL observado.
- **CLAUDE.md** lista `messages` entre as tabelas "que não colidiam" com o n8n (sem prefixo `chat_`) e cita o trigger `chat_bump_conversation_window` — ambos confirmados no banco.
- Nenhuma coluna com espaço no nome; nenhuma coluna droppada (ordinais contínuos).
