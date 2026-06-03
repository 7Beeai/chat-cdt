# contacts

## Identificação
- **Nome:** `public.contacts`
- **Dono provável:** **CHAT-CDT** (criada e escrita pelo CHAT-CDT; lida também pela IA do n8n via edge function `agent-tools`).
- **Linhas estimadas:** ~4.188 (`n_live_tup` 4.194; `n_tup_ins` 962, `n_tup_upd` 7.348, `n_tup_del` 0) — fonte `bloco-01-tabelas.json`.
- **Tamanho:** 1.224 kB total (heap 472 kB; o resto é índice). `bytes_total` 1.253.376.
- **Classificação:** **Compartilhada.** Justificativa precisa: o CHAT-CDT **possui e escreve** a tabela (upsert no webhook da Meta e RPC `chat_record_outbound_message`), mas a IA do n8n **lê** `contacts` de forma cross-boundary através da edge function `agent-tools` (gate `ai_may_send` e ação `transfer_human`, que casa `unit_id+wa_id → contacts.id`). Esse read pela `agent-tools` é o que torna a tabela compartilhada — fonte `edge-functions.json`.
- **Bloat:** ~299 bytes/linha total, mas heap real ~112 bytes/linha (472 kB / 4.194) — saudável. O peso vem dos índices: 2 índices de ~272 kB **idênticos** (ver Observações). `n_dead_tup` 117 (~2,8%) — sem alerta de bloat de heap.

## Finalidade
Diretório de contatos WhatsApp do CHAT-CDT, com chave natural `(unit_id, wa_id)`: cada linha é um número de WhatsApp dentro de uma unidade (tenant = `units`). Serve de âncora para `conversations` (FK `conversations.contact_id`) e guarda o nome de perfil do WhatsApp para exibição. O `wa_id` é a ponte para o mundo de cobrança: as RPCs `chat_debtor_context`/`chat_debtor_names` partem de `contacts.wa_id` para casar (via `chat_phone_match_key`) com o dashboard de cobrança do n8n. A tabela **não** guarda o vínculo com a matrícula/débito — esse vínculo é resolvido em tempo de leitura por match de telefone (ver Observações, contradição doc↔banco).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NO | `gen_random_uuid()` | default do banco (DDL `0001_init.sql` l.54) | PK; lido por `agent-tools` (`select id`), `chat_debtor_context`/`chat_debtor_names` (`reads contacts.id`), e SELECT do app `contacts.id WHERE unit_id=$1 AND wa_id=ANY($2)` (stat 3.910 chamadas); FK alvo de `conversations.contact_id` | confirmado (`functions-analysis.json`, `edge-functions.json`, `bloco-10b`) |
| 2 | `unit_id` | uuid | NO | — | app: webhook upsert (`route.ts` l.160) e `chat_record_outbound_message` (upsert) | filtro em todo SELECT por chave natural; RLS `chat_user_has_unit(unit_id)`; lido por `agent-tools` | inferido (nome genérico; mas escrita literal confirmada no webhook e na RPC) |
| 3 | `wa_id` | text | NO | — | app: webhook upsert (`route.ts` l.161 `wa_id: msg.from`) e `chat_record_outbound_message` (upsert) | chave de match para `chat_debtor_context`/`chat_debtor_names` (via `chat_phone_match_key`); `agent-tools` `transfer_human`; SELECT do app `wa_id=ANY($2)`; exibido no inbox (`list-data.ts` l.153, `context-panel.tsx` l.44) | confirmado (escrita literal no webhook; leitura literal nas RPCs e edge) |
| 4 | `name` | text | YES | — | app: webhook upsert grava `name = contactProfileName` = `value.contacts[0].profile.name` da Meta (`route.ts` l.133, l.162); também `chat_record_outbound_message` (upsert colunas `unit_id,wa_id,name`) | exibição no inbox (`list-data.ts` l.152 filtro, `context-panel.tsx` l.43 fallback) | confirmado (escrita e leitura literais) — **demovido como fonte de nome:** a migration `0013` passou a usar o nome do dashboard de cobrança (não `contacts.name`); `name` é apenas o nome de perfil do WhatsApp, hoje fallback de display, não mais autoritativo |
| 5 | `profile` | jsonb | NO | `'{}'::jsonb` | default do banco; **nenhum writer escreve valor** — webhook e `chat_record_outbound_message` upsertam só `unit_id,wa_id,name` | **sem consumidor identificado** (nenhum SELECT/leitura em funções, edge, n8n, views ou stat) | confirmado que está estruturalmente não-cabeado (ausência de writer/reader em todas as fontes analisadas; não é conclusão da janela de 13h) |
| 6 | `crm_external_id` | text | YES | — | DDL `0001_init.sql` l.59; **nenhum writer** em webhook, RPCs, triggers ou qualquer fonte | **sem consumidor identificado** | confirmado estruturalmente não-cabeado (sem writer/reader em nenhuma fonte) |
| 7 | `created_at` | timestamptz | NO | `now()` | default do banco (`0001_init.sql` l.60) | **sem consumidor identificado** — nenhum SELECT/`order by created_at` em stat (10a/10b), funções, edge ou views | confirmado que não há leitor conhecido (verificado por grep em todas as fontes) |

> Sem gaps de ordinal (pos 1→7 contínuo): nenhuma coluna foi droppada. Nenhuma coluna tem espaço no nome.

## Relacionamentos (FKs)
- **Saindo:** `contacts.unit_id → units.id` (`contacts_unit_id_fkey`, ON DELETE CASCADE). Apagar a unidade apaga seus contatos.
- **Entrando:** `conversations.contact_id → contacts.id` (`conversations_contact_id_fkey`, ON DELETE CASCADE). Apagar o contato apaga suas conversas (e por cascata, mensagens).
- Fonte: `bloco-03-fks.json`.

## Índices
| índice | único | colunas | idx_scan | bytes | obs |
|--------|-------|---------|----------|-------|-----|
| `contacts_pkey` | sim | (id) | 38.807 | 168 kB | PK, muito usado |
| `contacts_unit_id_wa_id_key` | sim | (unit_id, wa_id) | 8.310 | 272 kB | backing da constraint `unique(unit_id,wa_id)` (DDL l.61); usado |
| `contacts_unit_id_wa_id_idx` | não | (unit_id, wa_id) | 4.563 | 272 kB | **REDUNDANTE** — mesma chave/ordem do `_key`, criado explicitamente em `0001_init.sql` l.63 |

Fonte: `bloco-04-indices.json`.

### Índices nunca usados (idx_scan=0)
Nenhum índice com `idx_scan == 0`. **Porém há desperdício de índice escaneado:** `contacts_unit_id_wa_id_idx` (não-único, ~272 kB / 278.528 bytes) é totalmente redundante com `contacts_unit_id_wa_id_key` (único, mesmas colunas e ordem). Ambos mostram `idx_scan > 0` apenas porque o planner escolhe arbitrariamente um dos dois para probes de igualdade — `idx_scan` não-zero **não** prova que o índice redundante se paga. O índice **não-único** (`_idx`) é o descartável; o `_key` deve permanecer pois sustenta a constraint UNIQUE. **Economia ao dropar: ~272 kB.**

## Triggers
Nenhuma trigger nesta tabela (`bloco-06-triggers.json` retornou vazio).

## RLS / Policies
- `rls_on = true`, `rls_forced = false` (`bloco-01`).
- Policy única: **`chat_contacts_all`** — `PERMISSIVE`, role `public`, `cmd = ALL`, `USING = chat_user_has_unit(unit_id)`, `WITH CHECK = chat_user_has_unit(unit_id)` (`bloco-09-policies.json`; DDL `0001_init.sql` l.239-241). Sem split read/write — uma só policy cobre tudo.
- **Caminho de escrita por service-role:** o upsert do webhook da Meta (stat: 3.822 chamadas, colunas `name,unit_id,wa_id`) e as RPCs `SECURITY DEFINER` rodam fora da sessão do operador e **bypassam** `chat_user_has_unit` (por isso o INSERT não tem gate de unidade). Como `rls_forced=false`, o service-role ignora a policy. Leituras de sessão de operador (inbox) passam pela policy. Isso explica a assimetria escrita-livre / leitura-gated.

## Quem escreve / Quem lê
**Escreve:**
- **Webhook da Meta (app)** — `app/api/meta/webhook/route.ts` l.156-167: `from('contacts').upsert({unit_id, wa_id, name}, {onConflict:'unit_id,wa_id'})`. Writer primário (stat `bloco-10b`: INSERT INTO contacts(name,unit_id,wa_id) — **3.822 chamadas** na janela). Só grava `name,unit_id,wa_id`.
- **`chat_record_outbound_message`** (RPC, `SECURITY DEFINER`) — `writes: contacts upsert (unit_id,wa_id,name)` (`functions-analysis.json`; migration `0011`). Registra mensagens outbound (IA ou operador), upserta o contato.
- Nenhum writer grava `profile`, `crm_external_id` ou um valor explícito em `created_at` (todos ficam no default).

**Lê:**
- **`agent-tools`** (edge function) — `contacts: select (id,unit_id,wa_id)` para `transfer_human` (busca `contacts.id` por `unit_id+wa_id`) e gate `ai_may_send`. É a IA do n8n lendo (`edge-functions.json`).
- **`chat_debtor_context`** e **`chat_debtor_names`** (RPCs) — `reads contacts(id, wa_id)`, partem do `wa_id` para o match com o dashboard de cobrança (`functions-analysis.json`).
- **App / inbox** — SELECT `contacts.id WHERE unit_id=$1 AND wa_id=ANY($2)` (stat: **3.910 chamadas**); join `conversations → contacts` lendo `wa_id, name` no inbox (`list-data.ts`, `context-panel.tsx`, `messages/send/route.ts`).

## Observações
1. **Contradição doc↔banco (headline): `profile` e `crm_external_id` foram desenhadas mas nunca cabeadas.** O comentário do DDL (`0001_init.sql` l.51-52) declara a intenção: `profile.matricula` "permite vincular ao débito sem depender da volatilidade de clientes_cobranca_*". Na prática, a migration `0013_crm_name_resolution.sql` implementou a resolução de nome/débito por **match de telefone** (`chat_phone_match_key` → `clientes_cobranca_dashboard`), **não** via `profile` nem `crm_external_id`. As duas colunas são designed-but-never-wired. Essa afirmação se apoia em **evidência estrutural** (nenhum writer/reader em webhook, RPCs, triggers, edge, n8n, views ou stat), não na janela de ~13h do snapshot — é um fato permanente de estrutura de código.
2. **`name` foi demovido.** O `0013` corrigiu a premissa de que o nome exibido devia vir de `contacts.name` (perfil do WhatsApp, "que com frequência" estava errado) — passou a usar o nome do dashboard de cobrança. `contacts.name` segue como fallback de display, mas não é mais o nome autoritativo.
3. **Índice duplicado (desperdício escaneado, não zero-scan):** `contacts_unit_id_wa_id_idx` (não-único) duplica `contacts_unit_id_wa_id_key` (único). Dropar o não-único economiza ~272 kB sem perda — o `_key` já cobre as buscas por `(unit_id,wa_id)` e sustenta a constraint. Origem da duplicação: a constraint `unique(unit_id,wa_id)` (l.61) já cria o índice; o `create index on contacts (unit_id, wa_id)` redundante na l.63 do mesmo `0001_init.sql`.
4. **`created_at` sem leitor conhecido** — não aparece em nenhum SELECT/ordenação nas fontes. É barato (parte do default), mas registrado como "sem consumidor identificado" (não "morto").
5. **RLS via `public` + service-role bypass:** o desenho é intencional (webhook/RPCs escrevem sem gate de unidade; operadores leem com gate `chat_user_has_unit`). Com `rls_forced=false`, vale lembrar que qualquer conexão service-role tem acesso total — esperado nesta arquitetura de processo único.
6. **`seq_scan=2` vs `idx_scan=51.680`** — acesso é quase 100% por índice; a tabela está bem indexada para seu padrão de uso (lookup por PK e por chave natural).
