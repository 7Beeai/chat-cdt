# clientes_cobranca_dashboard

## Identificação

| Campo | Valor |
|---|---|
| Nome | `public.clientes_cobranca_dashboard` |
| Schema | `public` |
| Dono provável | **n8n / cobrança** (god-table operacional; CLAUDE.md classifica `clientes_cobranca_*` como tabelas do n8n, não tocar) |
| Linhas estimadas | **95.685** (`n_live_tup`, bloco-01) |
| Tamanho total | **1793 MB** (heap 950 MB + índices 842 MB) (bloco-01) |
| Nº de colunas | 52 (mas ordinais vão até 55 — 3 colunas droppadas) |
| Nº de índices | 23 |
| Nº de policies | 8 |
| Nº de triggers | 3 |
| RLS | habilitado (`rls_on=true`), não forçado (`rls_forced=false`) |
| Acesso | `seq_scan=3`, `idx_scan=89.501` — acesso quase 100% via índice (bloco-01) |
| Mutação | `n_tup_ins=0`, `n_tup_upd=48.358`, `n_tup_del=0`, `n_dead_tup=0` (bloco-01) |
| COMMENT da tabela | *"This is a duplicate of clientes_cobranca_setembro"* — **avaliado abaixo como impreciso** |

> **ALERTA DE BLOAT (crítico).** 1793 MB / 95.685 linhas ≈ **~19,6 KB por linha** para uma tabela de colunas majoritariamente escalares (text/bool/timestamptz). O heap sozinho é 950 MB (~**10,4 KB/linha**). Comparada à irmã `clientes_cobranca_setembro` (heap 16 MB / 49.633 linhas ≈ **0,33 KB/linha**), o heap desta tabela está **~31x mais inchado por linha** — para um esquema quase idêntico. (Total: dashboard 1793 MB vs setembro 43 MB.) Como `n_tup_ins=0` mas `n_tup_upd=48.358`, isto é coerente com bloat histórico de UPDATEs (HOT/dead tuples acumulados antes de um autovacuum recente) e/ou carga bulk com `pg_stat` resetado. `n_dead_tup=0` + `last_autovacuum=2026-06-02 03:01` indicam vacuum recente, mas o espaço já não foi devolvido ao SO (precisa `VACUUM FULL`/`pg_repack`). Dos 842 MB de índices, **548 MB (12 índices) nunca foram usados** (ver seção Índices). Fonte: bloco-01, bloco-04.

## Finalidade

Tabela-mãe da operação de cobrança da CDT: representa cada **devedor (matrícula) por unidade/franquia** com seu valor inadimplente, régua/cadência de disparos, estado de pagamento e telemetria de WhatsApp. É a "god-table" porque concentra três domínios num só lugar — (1) cadastro do devedor sincronizado da planilha Power BI (`sync_cobranca_v2`), (2) máquina de cadência/disparo espelhada de outra tabela (`mirror_disparo_fields_to_dashboard`), e (3) estado de pagamento/reembolso/baixa alimentado por edge functions de gateway (Stripe/Woovi/Abacate) e triggers. O CHAT-CDT a consome em modo **read-only** via RPCs (`chat_debtor_context`, `chat_debtor_names`) para enriquecer o inbox com nome validado e contexto de dívida. Fontes: functions-analysis.json, edge-functions.json, n8n-workflows.json, migrations 0007/0008/0013.

## Colunas

Origem = de onde vem o VALOR. Consumidores = quem LÊ a coluna. Confiança: `confirmado` = referência inequívoca por nome; `inferido` = nome genérico, só via `SELECT *`, ou trigger via `NEW`.

> Convenção sobre `SELECT *`: vários consumidores PostgREST e a RPC `chat_debtor_context` (0008) fazem `SELECT clientes_cobranca_dashboard.*` / `select d.*`. Esses **varrem as 52 colunas**, mas não provam uso real de cada uma. Onde a coluna só aparece via `SELECT *` (nunca nomeada), marca-se "via SELECT * (uso real não verificável)" + `inferido`. Onde nenhum reader/writer a toca: "sem consumidor identificado".

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|---|---|---|---|---|---|---|
| 1 | matricula | text | NO | — | sync planilha (`sync_cobranca_v2`/`sync_cobranca_batch` upsert; chave natural) | **chave de quase tudo**: `buscar_links_resgate`, `get_pay_receipt`, `register_payment`, `reconcile_orfao`, `resolve_orfao_matricula`, edges Stripe/Woovi/Abacate (`WHERE matricula=`), `chat_debtor_context`/`chat_debtor_names`; UPDATEs PostgREST `WHERE matricula` (qid 637386917892463000, -3564996486162206000) | confirmado |
| 2 | name | text | NO | — | sync planilha (`sync_cobranca_v2` upsert) | `get_pay_receipt`, `reconcile_orfao`, **`chat_debtor_names`** (nome validado do inbox, 0013), `chat_debtor_context` (0007), edges woovi/stripe/abacate (select) | confirmado |
| 3 | whatsapp | text | YES | — | sync planilha (`sync_cobranca_v2` upsert/update) | n8n "Update a row1" e UPDATE PostgREST `WHERE whatsapp` (qid -4274453401728832500, 2828 calls); `reconcile_orfao`, `resolve_orfao_matricula`, RPCs via `chat_phone_match_key(whatsapp)` (0008/0013); índice `idx_ccd_unit_matchkey` | confirmado |
| 4 | valor_inadimplente | numeric | YES | — | sync planilha (`sync_cobranca_v2` upsert/update) | `chat_debtor_context` (0007), edges woovi/stripe/abacate (select), query PostgREST `valor_inadimplente,pagamento_feito` (qid -8837341933236940000) | confirmado |
| 5 | status | text | YES | — | sync planilha (`sync_cobranca_v2` upsert) **e** mirror cadência (`mirror_disparo_fields_to_dashboard`) | `chat_debtor_context` (0007); índice composto `idx_dashboard_cobranca_time`; query ad-hoc `status ilike` (qid 1329481298477219800) | confirmado |
| 6 | regua | text | YES | — | sync planilha (`sync_cobranca_v2` upsert/update) | `reconcile_orfao`, `chat_debtor_context`/`chat_debtor_names`, edges woovi/stripe/abacate (select); índice `idx_dashboard_cobranca_time` | confirmado |
| 7 | data_ultima_mensagem | text | YES | — | **desconhecida** — sem writer em nenhuma função (grep literal em bloco-05b: 0 escritas à coluna TEXT; os 4 hits de substring são todos `_temp`); coluna TEXT legada distinta de `_temp` | `chat_debtor_context` (0007), enriched (0008 `d.*`); migration 0007 projeta `d.data_ultima_mensagem` | confirmado (leitura) / origem desconhecida — **ver antipattern col.7 vs col.37** |
| 8 | plataforma_pagamento_utilizada | text | YES | — | edges `generate-payment-link`/`-abacate` (update); `register_payment`, `guard_recent_payment_dashboard` | via `SELECT *` (chat_debtor_context 0008) | confirmado (escrita) |
| 9 | link_pagamento_enviado | boolean | YES | false | edges `generate-payment-link`/`-abacate` (update) | filtros PostgREST `WHERE link_pagamento_enviado=true` (qids -1904973191576707800, -8837341933236940000); índice parcial `idx_ccd_link_gerado` | confirmado |
| 10 | respondeu | boolean | YES | false | n8n "Update a row1" (set `respondeu=true`) + UPDATE PostgREST (qid -4274453401728832500) | via `SELECT *` / índice `idx_dashboard_respondeu` (idx_scan=0) | confirmado (escrita) |
| 11 | pagamento_feito | boolean | YES | false | `register_payment`, `guard_recent_payment_dashboard`, edge `generate-payment-link-abacate`; dispara trigger `trg_cancel_pending_links_on_payment` | `buscar_links_resgate`, query `valor_inadimplente,pagamento_feito` (qid -8837341933236940000), `chat_debtor_context`; índice `idx_dashboard_cobranca_time` | confirmado |
| 12 | reengajamento_30_min | boolean | YES | false | UPDATE PostgREST `SET reengajamento_30_min WHERE matricula` (qid 637386917892463000, 282 calls) — n8n/automação | via `SELECT *` | confirmado (escrita) |
| 13 | created_at | timestamptz | NO | now() | default `now()` na inserção (sync/insert) | via `SELECT *` | confirmado (origem) |
| 14 | updated_at | timestamptz | NO | now() | trigger `set_user_tracking` (NEW.updated_at) + writers que setam explicitamente (`sync_cobranca_v2`, `mirror_disparo_fields_to_dashboard`) | `chat_debtor_context`/`chat_debtor_names` (`ORDER BY updated_at desc`); 0007/0008/0013 | confirmado |
| 15 | correlation_id | text | YES | — | edges `generate-payment-link`/`-abacate` (update); `register_payment`, `guard_recent_payment_dashboard`, `limpar_links_pagamento_expirados` | via `SELECT *`; índice `idx_dashboard_correlation_id` (idx_scan=0) | confirmado (escrita) |
| 16 | data_pagamento | timestamptz | YES | — | `register_payment`, `guard_recent_payment_dashboard` (de `pagamentos.data_pagamento`) | `chat_debtor_context` (0007 projeta `d.data_pagamento`) | confirmado |
| 17 | disparos | numeric | YES | '0' | mirror cadência (`mirror_disparo_fields_to_dashboard`) | `chat_debtor_context` (0007 projeta `d.disparos`) | confirmado |
| 18 | **disparado com sucesso** | boolean | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`, escrita entre aspas) | via `SELECT *` | confirmado (escrita) — **coluna com espaço no nome** |
| 20 | id | integer | NO | nextval(`clientes_cobranca_setembro_id_seq`) | sequência **compartilhada com setembro** (PK) | PK `clientes_cobranca_dashboard_pkey` (idx_scan=**3** apenas) | inferido — origem confirmada pelo default; uso de leitura quase nulo |
| 22 | link_pagamento | text | YES | — | edges gateway (update: `generate-payment-link`, woovi/stripe/abacate webhooks), `limpar_links_pagamento_expirados` (limpa) | `chat_debtor_context` (0007); UPDATE PostgREST isolado `SET link_pagamento WHERE matricula` (qid -3564996486162206000, 272 calls) | confirmado |
| 23 | baixa_realizada | boolean | YES | false | **app (inferido)** — tipo TS no inbox `app/(app)/inbox/[id]/page.tsx:33`; nenhum writer SQL/edge (grep bloco-05b: as 2 menções `baixa_realizada` em `chat_debtor_context`/`get_pagamentos` são `p.baixa_realizada` de **`pagamentos`**, não desta coluna) | inbox do CHAT-CDT (read via contexto); via `SELECT *` (0008) | inferido (origem app; sem writer SQL confirmado) |
| 24 | baixa_realizada_at | timestamptz | YES | — | **app (inferido)** — par de auditoria de `baixa_realizada`; sem writer SQL mapeado | via `SELECT *` | inferido |
| 25 | baixa_realizada_by | text | YES | — | **app (inferido)** — par de auditoria; sem writer SQL mapeado | via `SELECT *` | inferido |
| 26 | reembolso_realizado | boolean | YES | false | `mark_refund_by_correlation` (update) | via `SELECT *` | confirmado (escrita) |
| 27 | reembolso_realizado_at | timestamptz | YES | — | `mark_refund_by_correlation` (update) | via `SELECT *` | confirmado (escrita) |
| 28 | reembolso_motivo | text | YES | — | `mark_refund_by_correlation` (update) | via `SELECT *` | confirmado (escrita) |
| 29 | reembolso_realizado_by | text | YES | — | `mark_refund_by_correlation` (update) | via `SELECT *` | confirmado (escrita) |
| 30 | created_by | uuid | YES | — | trigger `set_user_tracking` (NEW.created_by = `auth.uid()`) | via `SELECT *`; FK→`users.id`; índice `idx_dashboard_created_by` (idx_scan=0) | confirmado (origem) |
| 31 | updated_by | uuid | YES | — | trigger `set_user_tracking` (NEW.updated_by = `auth.uid()`) | via `SELECT *`; FK→`users.id`; índice `idx_dashboard_updated_by` (idx_scan=0) | confirmado (origem) |
| 32 | resgate_link | boolean | YES | — | **desconhecida** — **0 menções** em qualquer função (grep literal bloco-05b); o token `resgate` no n8n é variável local, não esta coluna | via `SELECT *`; sem consumidor nomeado | inferido — provável coluna legada |
| 33 | data_ultimo_disparo | date | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) **e** `sync_data_ultimo_disparo_from_message_log` (update) | **consumidor pesado**: filtros PostgREST por `data_ultimo_disparo` (qids -7072170865029385000 343s, -8098289193509716000 284s); índices `idx_dashboard_data_ultimo_disparo` (4389), `idx_ccd_unit_disparo` (392) | confirmado |
| 34 | disparos_equipe | numeric | YES | — | mirror cadência + `sync_cobranca_v2` (upsert) | `chat_debtor_context`/`chat_debtor_names` (0013 projeta `d.disparos_equipe`); índice `idx_dashboard_disparos_equipe` (**109 MB, idx_scan=0**) | confirmado |
| 35 | hora_link_gerado | timestamptz | YES | — (COMMENT: timestamp exato de geração do link) | edges `generate-payment-link`/`-abacate` (update); UPDATE PostgREST (qids -4794444290547324000, -1404057538395140000) | filtros PostgREST `link_pagamento_enviado=true AND hora_link_gerado BETWEEN` (qids -1904973191576707800, -2501617321430691300); `check_data_freshness`; índices `idx_ccd_link_gerado`, `idx_clientes_cobranca_dashboard_hora_link_gerado` (2010) | confirmado |
| 36 | data_resposta | timestamptz | YES | — (COMMENT: 1ª resposta do cliente no período) | **desconhecida** — **0 menções** em qualquer função (grep literal bloco-05b), apesar do COMMENT e do índice dedicado | sem consumidor nomeado; índice `idx_clientes_cobranca_dashboard_data_resposta` (**38 MB, idx_scan=0**) | inferido — coluna documentada porém não alimentada |
| 37 | data_ultima_mensagem_temp | timestamptz | YES | — | n8n "Update a row1" + UPDATE PostgREST `SET data_ultima_mensagem_temp,respondeu WHERE whatsapp` (qid -4274453401728832500, **2828 calls**) | filtros PostgREST `data_ultima_mensagem_temp BETWEEN` (qids -5248609799452055000, 5703962393878757000); `check_data_freshness`, `rpc_inbound_summary`, **`get_cobranca_kpis`, `get_cobranca_metrics`** (grep bloco-05b); índices `idx_ccd_unit_msg_temp` (1347), `idx_dashboard_data_ultima_mensagem_temp` (1028) | confirmado |
| 38 | bi_atual | boolean | YES | — | sync planilha (`sync_cobranca_v2` upsert — marca registro do BI atual) | `chat_debtor_context`/`chat_debtor_names` (`ORDER BY bi_atual desc`); índice `idx_dashboard_cobranca_time`; `idx_dashboard_bi_atual` (idx_scan=0) | confirmado |
| 39 | **forma de pagamento** | text | YES | — | sync planilha (`sync_cobranca_v2`/`sync_cobranca_batch` upsert/update — mapeia `forma_pagamento` da planilha) | via `SELECT *`; tipo TS `forma` no inbox (page.tsx:32) | confirmado (escrita) — **coluna com espaço no nome** |
| 41 | franquia | text | YES | — | **desconhecida** — **0 menções** em qualquer função (grep literal bloco-05b); no n8n `franquia` é coluna da planilha mapeada para `unit_id`, não esta coluna | via `SELECT *`; sem consumidor nomeado | inferido — provável coluna legada (papel assumido por `unit_id`) |
| 42 | unit_id | uuid | YES | — | sync planilha (`sync_cobranca_v2` upsert, via `units.bi_name`→`unit_id`) | **chave de RLS e de quase toda query**: policies (`user_has_access_to_unit`), `chat_debtor_context`/`chat_debtor_names` (`WHERE unit_id`), `reconcile_orfao`, `resolve_orfao_matricula`, `rpc_inbound_summary`; FK→`units.id`; índices compostos `idx_ccd_*` | confirmado |
| 43 | cadence_fase | text | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) + `sync_cobranca_v2` (upsert) | via `SELECT *` (não lido por nome em nenhum consumidor mapeado) | confirmado (escrita) |
| 44 | cadence_dia_ciclo | integer | YES | — | mirror cadência + `sync_cobranca_v2` (upsert) | via `SELECT *` | confirmado (escrita) |
| 45 | cadence_slot | integer | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) | via `SELECT *` | confirmado (escrita) |
| 46 | cadence_variante | integer | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) | via `SELECT *` | confirmado (escrita) |
| 47 | cadence_proximo_envio_at | timestamptz | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) | via `SELECT *` | confirmado (escrita) |
| 48 | cadence_ultimo_template | text | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) | via `SELECT *` | confirmado (escrita) |
| 49 | cadence_branch_state | text | YES | 'normal' | mirror cadência + `sync_cobranca_v2` (upsert) | via `SELECT *`; docs/03-database.md cita como alternativa rejeitada ao `routing` | confirmado (escrita) |
| 50 | cadence_entrou_em | timestamptz | YES | — | mirror cadência + `sync_cobranca_v2` (upsert) | via `SELECT *` | confirmado (escrita) |
| 51 | regua_at_entry | text | YES | — | mirror cadência + `sync_cobranca_v2` (upsert) | via `SELECT *` | confirmado (escrita) |
| 52 | last_inbound_at | timestamptz | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) | via `SELECT *` | confirmado (escrita) |
| 53 | slots_enviados_hoje | integer | YES | 0 | mirror cadência + `sync_cobranca_v2` (upsert) | via `SELECT *` | confirmado (escrita) |
| 54 | slots_enviados_hoje_data | date | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) | via `SELECT *` | confirmado (escrita) |
| 55 | last_resgate_ia_at | timestamptz | YES | — | mirror cadência (`mirror_disparo_fields_to_dashboard`) | via `SELECT *` | confirmado (escrita) |

**Gaps de ordinal_position (colunas DROPPADAS):** faltam **19, 21, 40**. Três colunas foram removidas ao longo da vida da tabela (DROP COLUMN deixa o ordinal "buraco"). Os ordinais 53–55 confirmam que a tabela teve ≥55 colunas físicas historicamente. Fonte: bloco-02 (saltos na sequência `pos`).

## Relacionamentos (FKs)

**FKs de saída (3):** (bloco-03)
- `created_by` → `users.id` (`clientes_cobranca_dashboard_created_by_fkey`, ON DELETE/UPDATE = `a`/NO ACTION)
- `updated_by` → `users.id` (`clientes_cobranca_dashboard_updated_by_fkey`, NO ACTION)
- `unit_id` → `units.id` (`clientes_cobranca_dashboard_unit_id_fkey`, NO ACTION)

**FKs de entrada:** nenhuma. Nenhuma tabela referencia esta por FK. As junções de outras tabelas/RPCs (`pagamentos`, `links_pagamentos_gerados`) são feitas **por `matricula`/`correlation_id` sem constraint**, ou seja, relacionamento lógico não enforçado no banco. Fonte: bloco-03, functions-analysis (`cancel_pending_links_on_payment`, `guard_recent_payment_dashboard`).

## Índices

23 índices, **842 MB** somados (≈ 89% do tamanho do heap!).

**Índices em uso:**
| índice | idx_scan | tamanho | papel |
|---|---|---|---|
| `clientes_cobranca_dashboard_matricula_key` (UNIQUE) | 64.895 | 43 MB | **chave de acesso real** (matrícula) |
| `idx_dashboard_data_ultimo_disparo` | 4.389 | 36 MB | filtro por data de disparo |
| `idx_dashboard_whatsapp` | 2.828 | 47 MB | lookup por whatsapp |
| `idx_clientes_cobranca_dashboard_hora_link_gerado` | 2.010 | 38 MB | janela de links gerados |
| `idx_ccd_unit_msg_temp` (unit_id, data_ultima_mensagem_temp) | 1.347 | 6 MB | telemetria por unidade |
| `idx_dashboard_data_ultima_mensagem_temp` | 1.028 | 33 MB | filtro msg temp |
| `idx_ccd_unit_matchkey` (unit_id, chat_phone_match_key(whatsapp)) | 12.227 | 5 MB | **match de nome validado** (CHAT-CDT, migration 0013) |
| `idx_ccd_unit_disparo` (unit_id, data_ultimo_disparo) | 392 | 7 MB | disparo por unidade |
| `idx_ccd_link_gerado` (parcial, link_pagamento_enviado=true) | 382 | 2 MB | links pendentes por unidade |
| `idx_dashboard_cobranca_time` (composto 5 cols) | 2 | 35 MB | quase não usado (candidato a revisão) |
| `clientes_cobranca_dashboard_pkey` (id) | **3** | 43 MB | **PK quase nunca usada** (id não é chave de acesso) |

### Índices nunca usados (idx_scan=0) — **desperdício total: 548 MB**
Fonte: bloco-04, `idx_scan==0`.
| índice | tamanho |
|---|---|
| `idx_dashboard_disparos_equipe` | **109 MB** |
| `idx_clientes_dashboard_unit_id` | 47 MB |
| `idx_dashboard_unit_id` | 45 MB |
| `clientes_cobranca_dashboard_status_idx` | 43 MB |
| `clientes_cobranca_dashboard_regua_idx` | 42 MB |
| `idx_dashboard_correlation_id` | 39 MB |
| `idx_clientes_cobranca_dashboard_data_resposta` | 38 MB |
| `idx_dashboard_created_by` | 38 MB |
| `idx_dashboard_updated_by` | 38 MB |
| `idx_dashboard_bi_atual` | 37 MB |
| `idx_dashboard_pagamento_feito` | 36 MB |
| `idx_dashboard_respondeu` | 36 MB |

- **548 MB nunca lidos** podem ser dropados imediatamente (consultar primeiro se há jobs sazonais).
- **Duplicação de unit_id:** `idx_dashboard_unit_id` (45 MB) E `idx_clientes_dashboard_unit_id` (47 MB) — **dois índices idênticos sobre `unit_id`**, ambos mortos (92 MB juntos). A carga real de `unit_id` é absorvida pelos compostos `idx_ccd_unit_*`.
- `idx_dashboard_disparos_equipe` (109 MB) é o maior índice morto isolado — sozinho equivale a ~2,5x toda a tabela `setembro`.

## Triggers

Fonte: bloco-06, functions-analysis.

1. **`set_user_tracking_trigger`** — BEFORE INSERT/UPDATE, ROW. Função `set_user_tracking`. Efeito: preenche `NEW.created_by`, `NEW.updated_by`, `NEW.updated_at` com `auth.uid()`/now(). Handler genérico reusado por várias tabelas. **Origem das colunas 30/31 e parte de 14.**
2. **`trg_cancel_pending_links_on_payment`** — AFTER UPDATE OF `pagamento_feito`, ROW, com `WHEN (new.pagamento_feito=true AND (old IS NULL OR old=false))`. Função `cancel_pending_links_on_payment`. Efeito: ao marcar pagamento, faz UPDATE em `links_pagamentos_gerados` (SET `cancelado_at`, `status='cancelled'`) para os links daquela matrícula sem pagamento associado (NOT EXISTS em `pagamentos`). **Não escreve nesta tabela — só dispara a partir dela.**
3. **`trg_guard_recent_payment_dashboard`** — BEFORE INSERT/UPDATE, ROW. Função `guard_recent_payment_dashboard`. Efeito: ao inserir/atualizar, consulta `pagamentos` (últimas 48h, não reembolsado) pela matrícula e, se houver pagamento recente, sobrescreve `NEW.pagamento_feito=true`, `data_pagamento`, `plataforma_pagamento_utilizada`, `correlation_id`. Salvaguarda anti-regressão de status pago.

## RLS / Policies

8 policies, `public` role, todas PERMISSIVE. **Há dois modelos de acesso sobrepostos** (papel global vs unidade). Fonte: bloco-09.

| cmd | policy | predicado |
|---|---|---|
| SELECT | "Only admins and collections agents can read dashboard" | `has_role(admin) OR has_role(collections_agent)` |
| SELECT | "Users can view clients from their units - dashboard" | `user_has_access_to_unit(unit_id)` |
| UPDATE | "Admins and collections agents can update dashboard" | `has_role(admin) OR has_role(collections_agent)` |
| UPDATE | "Users can update clients from their units - dashboard" | `user_has_access_to_unit(unit_id)` (qual + check) |
| INSERT | "Only admins can insert dashboard records" | check `has_role(admin)` |
| INSERT | "Users can insert clients in their units - dashboard" | check `user_has_access_to_unit(unit_id)` |
| DELETE | "Only admins can delete dashboard records" | `has_role(admin)` |
| DELETE | "Only admins can delete clients - dashboard" | `EXISTS(user_roles … role='admin')` |

**Sobreposições/duplicações:**
- **DELETE duplicado funcionalmente:** "Only admins can delete dashboard records" (`has_role(admin)`) e "Only admins can delete clients - dashboard" (`EXISTS … user_roles.role='admin'`) expressam a **mesma regra** por dois caminhos diferentes (helper `has_role` vs subselect direto em `user_roles`). Como policies PERMISSIVE são OR, são redundantes — manter uma só.
- **SELECT/UPDATE/INSERT cada um com 2 policies PERMISSIVE em OR:** uma por papel (`admin`/`collections_agent`) e outra por unidade (`user_has_access_to_unit`). Resultado: um usuário com acesso à unidade **OU** com papel global passa. São dois modelos de autorização convivendo — provável legado de migração de "papel" para "unidade". Não é bug, mas amplia a superfície de acesso e dificulta auditoria.
- **Inconsistência admin/collections:** SELECT e UPDATE permitem `collections_agent`; INSERT e DELETE só `admin`. Coerente (agente lê/atualiza, não cria/apaga), mas vale documentar.

## Quem escreve / Quem lê

**Escritores (writers):**
- **`sync_cobranca_v2`** / `sync_cobranca_batch` (SECURITY DEFINER) — upsert do cadastro vindo da planilha Power BI: matricula, name, whatsapp, valor_inadimplente, regua, status, "forma de pagamento", unit_id, bi_atual + sementes de cadência. Origem-mãe da maioria das colunas de cadastro. (functions-analysis; n8n "Sync Planilha Power BI v3" chama esta RPC.)
- **`mirror_disparo_fields_to_dashboard`** (trigger em tabela de origem) — espelha disparos, disparos_equipe, "disparado com sucesso", data_ultimo_disparo, status e todos os `cadence_*` (43–55) casando por matrícula. (functions-analysis.)
- **Edges de gateway** (edge-functions): `generate-payment-link`, `generate-payment-link-abacate` (update link_pagamento_enviado, link_pagamento, correlation_id, plataforma, hora_link_gerado); webhooks `woovi`/`stripe`/`abacate` (update link_pagamento). `verify_jwt=false`.
- **`register_payment`**, **`guard_recent_payment_dashboard`** (trigger), **`mark_refund_by_correlation`**, **`limpar_links_pagamento_expirados`**, **`sync_data_ultimo_disparo_from_message_log`**, **`rollback_sync`** (delete+reinsert), **`set_user_tracking`** (trigger, created_by/updated_by). (functions-analysis, bloco-06.)
- **n8n** "CDT Cobrança - Tatuapé-SP" e UPDATEs PostgREST (qid -4274453401728832500, 2828 calls): data_ultima_mensagem_temp + respondeu por whatsapp; reengajamento_30_min por matrícula (qid 637386917892463000).
- **App CHAT-CDT (inferido):** baixa_realizada/_at/_by — tipados no inbox (`page.tsx`), sem writer SQL/edge confirmado.

**Leitores (readers):**
- **CHAT-CDT (read-only):** `chat_debtor_context` (migrations 0007/0008 — 0008 usa `select d.*`) e `chat_debtor_names` (0013, nome validado do inbox via `unit_id`+`chat_phone_match_key`). Projetam name, matricula, valor_inadimplente, status, regua, disparos, disparos_equipe, pagamento_feito, link_pagamento, data_pagamento, data_ultima_mensagem, updated_at, bi_atual.
- **Edges reconcile** (cron): `reconcile-abacate/stripe/woovi-pull` (select name, valor_inadimplente, regua, whatsapp, matricula, unit_id).
- **Funções de resgate/reconciliação:** `buscar_links_resgate(_pendente)`, `get_pay_receipt`, `reconcile_orfao`, `resolve_orfao_matricula`, `check_data_freshness`, `rpc_inbound_summary`.
- **Queries PostgREST quentes** (bloco-10): filtros por data_ultimo_disparo (343s + 284s total — os mais caros do banco), por link_pagamento_enviado+hora_link_gerado, por data_ultima_mensagem_temp.

## Observações (bloat, antipatterns, contradições)

**1. Bloat severo (achado principal).** 1793 MB para 95.685 linhas escalares (~19,6 KB/linha) vs `setembro` ~0,9 KB/linha. Heap 950 MB + índices 842 MB. **548 MB são índices nunca lidos** (12 índices, idx_scan=0) — drop imediato recupera ~⅓ do footprint de índice. `n_dead_tup=0` após autovacuum recente, mas o espaço não voltou ao SO → candidato a `VACUUM FULL`/`pg_repack`. `n_tup_ins=0` com 95.685 linhas indica `pg_stat` resetado ou carga bulk (não via INSERT contado).

**2. Índices redundantes.** Dois índices idênticos sobre `unit_id` (`idx_dashboard_unit_id` 45 MB + `idx_clientes_dashboard_unit_id` 47 MB), ambos mortos. A PK sobre `id` (43 MB) tem só **3 scans** — `id` não é chave de acesso; `matricula` é (64.895 scans no unique). Reavaliar se a PK deveria ser `matricula`.

**3. Colunas com espaço no nome (antipattern).** `"disparado com sucesso"` (col 18) e `"forma de pagamento"` (col 39) — exigem aspas duplas em todo SQL e quebram ORMs/PostgREST naïve. Ambas são escritas (mirror / sync). Padronizar para snake_case seria desejável, mas é tabela do n8n.

**4. Coluna 7 vs 37 — divergência de dado (antipattern).** `data_ultima_mensagem` (col 7, **TEXT**) é o que as RPCs do CHAT-CDT projetam (0007/0013), mas **nenhum writer a alimenta**; o tráfego real (n8n + qid -4274…, 2828 calls) escreve `data_ultima_mensagem_temp` (col 37, **timestamptz**). Logo o inbox provavelmente lê uma coluna **stale/vazia** enquanto a atualização viva cai em `_temp`. Recomendação: RPCs deveriam ler `data_ultima_mensagem_temp`, ou a coluna TEXT deveria ser sincronizada/deprecada.

**5. Colunas sem origem identificada (candidatas a legado).** `data_ultima_mensagem` (7, sem writer), `resgate_link` (32, sem writer), `data_resposta` (36, sem writer apesar de COMMENT descritivo e índice morto de 38 MB), `franquia` (41, papel assumido por `unit_id`). Não marcadas "mortas" — podem ter writer não mapeado (app/edge não inspecionado linha-a-linha) — mas são fortes candidatas a deprecação após confirmação.

**6. Contradição com o COMMENT da tabela ("duplicate of clientes_cobranca_setembro") — FALSO/IMPRECISO.** Comparação real (bloco-01/02):
   - **Tamanho:** dashboard 1793 MB / 95.685 linhas vs setembro 43 MB / 49.633 linhas — não são cópias 1:1 (≠ contagem, ≠ tamanho, dashboard ~40x maior em bytes).
   - **Colunas:** compartilham apenas **38** colunas. Dashboard tem **14 exclusivas** (reengajamento_30_min, baixa_realizada/_at/_by, reembolso_realizado/_at/_motivo/_by, created_by, updated_by, resgate_link, data_resposta, bi_atual, franquia — todo o domínio de **pagamento/reembolso/baixa/auditoria**). Setembro tem **12 exclusivas** (semana, numero_semana_1/2, bloqueio_disparos, motivo_bloqueio, bloqueado_em, bloqueio_contexto, disparos_pausados_ate, pausa_motivo, pausa_data_prometida, pausa_registrada_em, resgate_at — domínio de **bloqueio/pausa/calendário**).
   - **Direção de dados (confirmada):** a sequência de `id` é compartilhada (`clientes_cobranca_setembro_id_seq`) e o trigger `mirror_disparo_fields` que chama `mirror_disparo_fields_to_dashboard` está registrado **na tabela `clientes_cobranca_setembro`** (AFTER UPDATE — confirmado em bloco-06), espelhando os campos de disparo/cadência **DE setembro PARA dashboard** casando por matrícula. Logo `setembro` é a fonte da cadência; `dashboard` é o destino enriquecido.
   - **Papel duplo de dashboard:** não é um espelho passivo — é **espelho de cadência (vindo de setembro) + write-target primário do domínio de pagamento/WhatsApp**: edges de gateway (Stripe/Woovi/Abacate), `register_payment`, `mark_refund_by_correlation` e o tráfego n8n/PostgREST fazem UPDATE direto nela. Setembro é a tabela operacional enxuta (43 MB, 233k idx_scan — viva); dashboard é o agregado de leitura (BI/inbox) **e** de escrita (pagamentos), inchado e cheio de índices mortos.
   - **Veredito:** o COMMENT é **stale e enganoso**. São tabelas **divergentes com lineage compartilhado** (sequência + trigger mirror setembro→dashboard), não duplicatas. Corrigir o COMMENT.

**7. Contradição doc↔banco (CLAUDE.md / docs).** CLAUDE.md instrui "**Nunca alterar tabelas do n8n** (`clientes_cobranca_*`)", mas a migration **0013 adicionou `idx_ccd_unit_matchkey`** a esta tabela (confirmado pelo `CREATE INDEX CONCURRENTLY` no pg_stat_statements, qid -9112201809618552000) e usa-o ativamente (12.227 scans). É uma **exceção sancionada** (índice aditivo read-only para o nome validado), mas registra que a regra "não tocar" já foi flexibilizada — convém documentar a exceção. docs/03-database.md classifica corretamente a tabela como "base de devedores, **volátil**".
