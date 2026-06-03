# conversations

## Identificação

- **Nome:** `public.conversations`
- **Dono provável:** CHAT-CDT (criada em `0001_init.sql`); n8n é co-escritor via PostgREST/RPC.
- **Classificação:** **Compartilhada** — núcleo do CHAT-CDT (sessão de atendimento), mas o n8n insere/atualiza (criação de conversa, handoff `routing`). É a tabela que coordena o handoff IA↔humano (`routing`).
- **Linhas estimadas:** ~4.157 (n_live_tup 4.195) — fonte `bloco-01-tabelas.json`.
- **Tamanho:** 1.744 kB total (heap 608 kB; o resto são 5 índices). `bloco-01`.
- **Bloat:** ~426 bytes/linha de heap (608 kB / ~4,2k linhas) — normal para uma linha com 18 colunas, 11 das quais timestamptz/uuid. **Sem alerta de bloat.** n_dead_tup=350 (~8%), autovacuum rodou em 2026-06-01 22:51; `last_analyze` manual é null mas autoanalyze recente. Tabela quente: `idx_scan` 35.394 vs `seq_scan` 158 — leitura predominantemente indexada (bom).
- **RLS:** ativa (`rls_on=true`, não forçada). 1 policy.

## Finalidade

Representa uma **sessão de atendimento** (conversa) entre um contato WhatsApp e a CDT, dentro de uma unidade e atrelada a um número (`phone_number_id`). É o ponto de coordenação do **handoff**: `routing` (`ai`/`queued`/`human`) decide se a IA do n8n responde ou se um operador assumiu. Mantém a **janela de 24h da Meta** (`customer_window_expires_at`), o ciclo de vida do atendimento (queued/assigned/closed + desfecho) e serve de fonte para a inbox de 4 colunas e para os relatórios (`chat_report_*`). Há no máximo **uma conversa aberta por contato** (índice parcial `uniq_open_conv_per_contact`), guardando contra corrida entre n8n e CHAT-CDT na criação.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NO | `gen_random_uuid()` | DDL `0001_init.sql:67`. | PK; FK de `messages.conversation_id` e `chat_conversation_events.conversation_id` (bloco-03); lido por quase todas as queries da inbox e por `chat_record_outbound_message` (RETURNING). Realtime publica a linha. | confirmado (PK/FK em bloco-03; writers RETURNING id no bloco-10) |
| 2 | `unit_id` | uuid | NO | — | App INSERT (PostgREST 961c, `bloco-10b`) e `chat_record_outbound_message` (resolve via `chat_phone_numbers.waba_id→wabas.unit_id`, `functions-analysis`). | RLS `chat_user_has_unit(unit_id)` (bloco-09); índice `..._routing_priority_last_inbound_at_idx`; `chat_report_attendance`/`chat_report_overview`/`chat_debtor_context`/`chat_debtor_names` (functions-analysis); push fanout `chat_notify_handoff` (body do payload). | confirmado |
| 3 | `contact_id` | uuid | NO | — | App INSERT (961c) e `chat_record_outbound_message` (upsert contato → insere conversa). FK→`contacts(id)` ON DELETE CASCADE. | Índice `conversations_contact_id_status_idx` e `uniq_open_conv_per_contact`; SELECTs de existência de conversa aberta (3844c/3738c, `bloco-10b`); join `chat_debtor_context`/`_names`. | confirmado |
| 4 | `phone_number_id` | uuid | NO | — | App INSERT (961c) e `chat_record_outbound_message` (insere com `phone_number_id`). FK→`chat_phone_numbers(id)`. | Lido na inbox detail SELECT (98c, embeda `phone`); embed PostgREST `conversations_phone_1`. | confirmado |
| 5 | `status` | USER-DEFINED `chat_conversation_status` | NO | `'open'` | DDL default; app fecha (`status:'closed'`, `actions.ts:126,184`). n8n/IA não escreve status (só `routing`). | Filtro em quase todas as queries (3844c/3738c/`uniq_open_conv_per_contact` parcial WHERE status='open'); `chat_report_*`; trigger stamp/log usa transição de status. | confirmado |
| 6 | `routing` | USER-DEFINED `chat_routing_state` | NO | `'ai'` | **n8n/IA** UPDATE (PostgREST 171c: `SET handoff_reason, routing WHERE contact_id AND status`, `bloco-10b`); **app** server actions (`actions.ts`: `human`/`ai`); `agent-tools` edge (transfer_human). | Coração do handoff. Índice `..._routing_priority_...`; triggers `chat_stamp`/`chat_log`/`chat_notify_handoff` reagem a mudança de routing; `chat_report_overview`. | confirmado |
| 7 | `handoff_reason` | USER-DEFINED `chat_handoff_reason` | YES | — | **n8n/IA** UPDATE (171c, junto de `routing`); `agent-tools` edge atualiza. | `chat_report_attendance`/`_overview` (breakdown por motivo); payload do push (`chat_notify_handoff`); name-resolution explain (`handoff_reason is not null`). | confirmado |
| 8 | `priority` | integer | NO | `0` | DDL default `0`. **Nenhum writer encontrado** (app/n8n/triggers/migrations) — fica sempre 0. | **Lida**: chave-líder do índice `..._routing_priority_last_inbound_at_idx` e coluna do SELECT da inbox (98c/61c/52c). Não tem escritor → ordenação efetiva da fila cai em `last_inbound_at DESC`. | confirmado (write-dead) / inferido (sempre 0) |
| 9 | `assigned_operator_id` | uuid | YES | — | **App** server actions (`actions.ts:26,61,90,158`: assume/reassign=`user.id`; devolver à IA=`null`). FK→**`auth.users(id)`** (NO ACTION). | Trigger `chat_stamp` (carimba `assigned_at`) e `chat_log` (evento assigned/reassigned); `chat_report_attendance`/`_overview`; inbox detail SELECT. | confirmado |
| 10 | `last_inbound_at` | timestamptz | YES | — | Trigger **`chat_bump_conversation_window`** (AFTER INSERT em `messages`, direction='in' → `new.created_at`, `0001:144`). | Índice `..._routing_priority_last_inbound_at_idx` (ordenação da fila); inbox detail SELECT. | confirmado |
| 11 | `customer_window_expires_at` | timestamptz | YES | — | Trigger **`chat_bump_conversation_window`** (`new.created_at + interval '24 hours'`, `0001:145`). | Janela 24h da Meta; inbox detail SELECT (98c) exibe o estado da janela. | confirmado |
| 12 | `opened_at` | timestamptz | NO | `now()` | DDL default na criação da conversa (`0001:78`). | `chat_report_attendance`/`_overview` (início do funil/SLA). | confirmado |
| 13 | `closed_at` | timestamptz | YES | — | **App** seta explicitamente (`actions.ts:127,185`); trigger `chat_stamp` também carimba se nulo na transição p/ closed (`0011`). | `chat_report_attendance` (fechamento/SLA). | confirmado |
| 14 | `queued_at` | timestamptz | YES | — | Trigger **`chat_stamp_conversation_transition`** (BEFORE UPDATE, `routing→queued`, `0011`). | `chat_report_attendance` (tempo na fila). | confirmado |
| 15 | `assigned_at` | timestamptz | YES | — | Trigger **`chat_stamp_conversation_transition`** (quando `assigned_operator_id` muda p/ não-nulo, `0011`). | `chat_report_attendance` (tempo até atribuição). | confirmado |
| 16 | `closed_by` | uuid | YES | — | **App** (`actions.ts:128,186`=`user.id`). FK→**`auth.users(id)`** ON DELETE SET NULL (bloco-03 `on_delete:n`, `0011`). | Trigger `chat_log` usa `coalesce(new.closed_by, auth.uid())` como `actor_id` do evento closed; `chat_report_attendance`. | confirmado |
| 17 | `close_outcome` | USER-DEFINED `chat_close_outcome` | YES | — | **App** (`actions.ts:129,187`). Enum criado em `0011` (resolvido/nao_resolvido/fora_de_escopo/cliente_nao_respondeu). | Trigger `chat_log` copia p/ `chat_conversation_events.outcome`; `chat_report_attendance` (breakdown de desfecho). | confirmado |
| 18 | `close_note` | text | YES | — | **App** (`actions.ts:130`; o bulk-close em `:188` NÃO grava note). | Trigger `chat_log` copia p/ `chat_conversation_events.note` (`0011`). | confirmado |

> **Sem gaps de ordinal** (pos 1→18 contínuos): nenhuma coluna foi droppada.

## Relacionamentos (FKs)

Saindo de `conversations` (bloco-03):

| coluna | → tabela.coluna | on_delete | nota |
|--------|------------------|-----------|------|
| `unit_id` | `units(id)` | CASCADE | tenant. |
| `contact_id` | `contacts(id)` | CASCADE | apagar contato apaga conversas. |
| `phone_number_id` | `chat_phone_numbers(id)` | NO ACTION | número/WABA. |
| `assigned_operator_id` | **`auth.users(id)`** | NO ACTION | bloco-03 imprime `users`, mas DDL=`auth.users`. App grava `auth.uid()`. |
| `closed_by` | **`auth.users(id)`** | SET NULL | idem; `0011`. |

Entrando em `conversations` (filhas que referenciam `id`):

| tabela.coluna | on_delete |
|---------------|-----------|
| `messages.conversation_id` | CASCADE |
| `chat_conversation_events.conversation_id` | CASCADE |

## Índices

| índice | def | único | idx_scan | bytes | papel |
|--------|-----|-------|----------|-------|-------|
| `conversations_pkey` | `(id)` | sim/PK | 21.717 | 172 kB | lookups por id (joins, RETURNING). |
| `uniq_open_conv_per_contact` | `(contact_id) WHERE status='open'` | sim | 10.051 | 180 kB | race-guard 1 conversa aberta/contato; serve os SELECTs de existência (3844c/3738c). |
| `conversations_contact_id_status_idx` | `(contact_id, status)` | não | 2.594 | 262 kB | histórico de conversas do contato. |
| `conversations_unit_id_routing_priority_last_inbound_at_idx` | `(unit_id, routing, priority DESC, last_inbound_at DESC)` | não | 1.032 | 450 kB | **ordenação da fila/inbox**. Note: `priority` é sempre 0, então a ordenação real é por `last_inbound_at DESC`. |

### Índices nunca usados (idx_scan=0)

| índice | bytes | MB | porquê está morto |
|--------|-------|-----|-------------------|
| `conversations_assigned_operator_id_idx` | 57.344 | **~0,055 MB** | A claim/assume localiza por **PK** (`.eq('id').is('assigned_operator_id', null)`) e os relatórios filtram por `unit_id`; ninguém faz seek só por `assigned_operator_id`. |

**Desperdício total de índice nunca usado: ~0,055 MB** (57.344 bytes). Pequeno, mas é candidato a DROP — toda escrita em conversa mantém esse btree sem retorno de leitura.

## Triggers

Todos ROW, sobre `conversations` (bloco-06 + DDL):

| trigger | timing/evento | função | efeito |
|---------|---------------|--------|--------|
| `trg_chat_stamp_transition` | BEFORE UPDATE (WHEN routing/status/operator mudou) | `chat_stamp_conversation_transition` (`0011`) | carimba `queued_at`/`assigned_at`/`closed_at` na própria linha. Não-trivial: o analyzer registrou `writes:[]` porque é atribuição `NEW.*` (statement-level não detecta). |
| `trg_chat_log_transition` | AFTER UPDATE (mesmo WHEN) | `chat_log_conversation_transition` (SECURITY DEFINER, `0011`) | insere 1 evento em `chat_conversation_events` (queued/returned_to_ai/assigned/reassigned/closed); copia `close_outcome`→outcome, `close_note`→note. |
| `trg_chat_notify_handoff` | AFTER UPDATE OF `routing` | `chat_notify_handoff` (SECURITY DEFINER) | em `routing→queued`, dispara `net.http_post` p/ `/api/internal/push/notify` (push fanout). **Ver Observações: a versão viva lê `chat_config`, não GUC.** |

Trigger relacionado (em `messages`, escreve nesta tabela): `chat_bump_conversation_window` mantém `last_inbound_at`/`customer_window_expires_at` (`0001:137-152`).

## RLS / Policies

| policy | cmd | roles | qual | with_check |
|--------|-----|-------|------|------------|
| `chat_conv_all` | ALL | public | `chat_user_has_unit(unit_id)` | `chat_user_has_unit(unit_id)` |

- **Uma única policy ALL** (sem duplicação/sobreposição). Escopo = unidades do operador via helper SECURITY DEFINER `chat_user_has_unit` (cadeia `auth.uid()→profiles→user_units`).
- O n8n escreve com **service_role**, que ignora RLS — por isso o INSERT (961c) e o UPDATE de handoff (171c) passam sem precisar de policy.

## Quem escreve / Quem lê

**Escrevem:**
- **App (server actions `app/(app)/inbox/[id]/actions.ts`)** — assume/reassign/devolver (`routing`, `assigned_operator_id`), fechar (`status`, `closed_at`, `closed_by`, `close_outcome`, `close_note`). Confirmado por leitura do código.
- **App (PostgREST INSERT, 961c, bloco-10b)** — cria conversa com `contact_id, phone_number_id, unit_id`.
- **n8n/IA** — UPDATE de handoff `SET handoff_reason, routing WHERE contact_id AND status` (171c, bloco-10b) — bate com o contrato de routing (docs/04: n8n só faz UPDATE de routing).
- **`chat_record_outbound_message`** (RPC chamada pelo n8n) — ensure-open: INSERT `unit_id, contact_id, phone_number_id` se não houver conversa aberta (functions-analysis, confirmado). Segundo caminho de insert, distinto do PostgREST direto.
- **Edge `agent-tools`** — select+update de `routing/handoff_reason/status` (transfer_human; edge-functions.json, confirmado).
- **Triggers** — `chat_bump_conversation_window` (`last_inbound_at`, `customer_window_expires_at`); `chat_stamp_conversation_transition` (`queued_at`, `assigned_at`, `closed_at`).

**Leem:**
- **App / inbox** — SELECTs PostgREST (98c/61c/52c embedando contact/phone/unit; 3844c/3738c de existência de conversa aberta).
- **Realtime** — `conversations` está na publicação `supabase_realtime` (`0001:265`): a inbox recebe a linha inteira em tempo real. Consumidor de **todas** as colunas, fácil de esquecer por não ser função/query.
- **RPCs de relatório** — `chat_report_attendance`, `chat_report_overview` (funil/SLA/KPIs).
- **RPCs de cobrança/nome** — `chat_debtor_context`, `chat_debtor_names` (resolvem devedor/nome a partir de `id/unit_id/contact_id`).
- **Name-resolution** (explain queries, bloco-10a) — joga `conversations` join `contacts` filtrando por `status`/`routing`/`handoff_reason`.

## Observações

1. **Contradição doc↔banco — `chat_notify_handoff` (GUC vs `chat_config`).** `CLAUDE.md` e `0001_init.sql` dizem que o push fanout depende de 2 **GUCs** (`app.app_origin`, `app.cron_secret`). Mas `0003_config_table.sql:37-46` **redefine** a função para ler `select value ... from public.chat_config where key='app_origin'/'cron_secret'`, e o `functions-analysis.json` (DB vivo) confirma `reads:[chat_config(key,value)]`, sem GUC. **A versão viva usa a tabela `chat_config`, não GUCs.** Doc desatualizada — corrigir o "depende de 2 GUCs no banco" do CLAUDE.md.

2. **`priority` é write-dead.** Default 0 e nenhum writer (app/n8n/trigger/migration). É lido (líder do índice de fila e coluna do SELECT da inbox), então **não** é "sem consumidor" — mas a ordenação da fila prometida por prioridade na prática colapsa em `last_inbound_at DESC`. Ou há uma feature de priorização planejada e não implementada, ou a coluna deveria sair do índice.

3. **Índice morto `conversations_assigned_operator_id_idx`** (idx_scan=0, ~0,055 MB): candidato a DROP. Nada faz seek só por operador (claim usa PK; relatórios filtram por unit).

4. **FKs apontam para `auth.users`, não `public.users`.** bloco-03 imprime `ref_tabela:"users"` para `assigned_operator_id` e `closed_by`, mas o DDL (`0001:75`, `0011`) e o código (grava `auth.uid()`) confirmam `auth.users(id)`. Importante porque o projeto separa deliberadamente `auth.users`/`profiles` — "users" enganaria.

5. **Dois caminhos de criação de conversa** (PostgREST direto 961c vs `chat_record_outbound_message` ensure-open) — ambos respeitam `uniq_open_conv_per_contact`; o webhook trata `23505` com re-SELECT (CLAUDE.md). Sem antipattern, mas duas portas de entrada para o mesmo invariante.

6. **`close_note` só é gravado no fechamento individual.** O bulk-close (`actions.ts:182-189`) grava `status/closed_at/closed_by/close_outcome` mas **não** `close_note` — fechamentos em lote ficam sem nota. Comportamento, não bug, mas vale notar.

7. **Tabela quente e saudável de índice:** idx_scan/seq_scan ≈ 224:1. Nenhum sinal de varredura sequencial dominante. Os 4 índices úteis somam ~1,06 MB contra 608 kB de heap — razão alta mas justificada pelos padrões de acesso (fila por unit/routing, existência por contato, histórico).
