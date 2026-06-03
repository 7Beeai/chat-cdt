# clientes_cobranca_setembro

## Identificação

- **Nome**: `public.clientes_cobranca_setembro`
- **Dono provável**: n8n / cobrança (predа o CHAT-CDT; nenhuma migration `infra/supabase/migrations/` cria ou altera esta tabela — grep retornou vazio)
- **Linhas estimadas**: 49.633 live tuples (`n_live_tup`, bloco-01); `n_dead_tup=0` (autovacuum recente em 2026-06-02 03:00)
- **Tamanho**: 43 MB total (`bytes_total=44.703.744`), heap 16 MB → o restante (~27 MB) são os 13 índices
- **Classificação**: **Cobrança** (god-table viva / base de cadência do motor v2)
- **Atividade**: `n_tup_ins=0`, `n_tup_upd=50.142`, `n_tup_del=0`. RLS ligada (`rls_on=true`, não forçada). `idx_scan=233.906` vs `seq_scan=9.465` → predominantemente acessada por índice.
- **Bloat**: ~900 bytes/linha total, mas heap são ~338 bytes/linha (16 MB / 49,6k) — razoável para 50 colunas; o peso está nos índices (ver seção Índices), não em bloat de heap. `n_dead_tup=0` é saudável.

> **Sobre o COMMENT da tabela** (`"This is a duplicate of clientes_cobranca"`): avaliação crítica — o comentário é **enganoso quanto ao papel atual**. `n_tup_ins=0` apesar de 49,6k linhas vivas corrobora que a tabela nasceu de um fork (CTAS) de `clientes_cobranca`, mas hoje ela é a **lista VIVA** (volátil) mantida pelo `sync_cobranca_v2`/`sync_cobranca_batch` e é a base de leitura/escrita do motor de cobrança v2, do roteador de inbound e dos links de pagamento. Não é backup nem cópia inerte. `docs/03-database.md` confirma: *"`clientes_cobranca_setembro`, `clientes_cobranca_dashboard` — base de devedores. Volátil"*. **Tratar o comentário como verdade histórica sobre a origem, não sobre a função.**

## Finalidade

Lista viva de inadimplentes (uma linha por `matricula`/unidade) que dirige toda a cobrança automatizada. Recebe o sync diário da planilha (insert/update/delete/upsert via `sync_cobranca_v2`), guarda o estado da máquina de cadência do **motor v2** (`cadence_*`, `slots_enviados_hoje*`), os flags de bloqueio/pausa de disparos, o estado de link de pagamento (`link_pagamento`, `correlation_id`, `hora_link_gerado`), e os sinais de inbound usados pelo Resgate IA (`last_inbound_at`, `resgate_at`, `cadence_branch_state`). Toda mutação relevante é espelhada para `clientes_cobranca_dashboard` pelo trigger `mirror_disparo_fields`.

## Colunas

> Há lacunas de ordinal (pos 1-2, 9-10, 16, 21, 26, 28, 30, 34-35 inexistentes) = colunas droppadas ao longo do tempo → churn de schema típico de god-table mantida fora de migrations versionadas.

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 3 | matricula | text | NÃO | — | `sync_cobranca_v2` (insert) — chave de negócio | LIDA por todas as funções/edge/n8n (chave de junção). Índice único `_matricula_key` com 119k scans | confirmado (functions-analysis: sync write; reads em motor_v2, picker, route_inbound, register_payment) |
| 4 | name | text | NÃO | — | `sync_cobranca_v2` (insert/upsert) | LIDA por `motor_v2_get_disparos`, `picker_select_batch`, `route_inbound`, `get_phone_pending_debts`, edge `generate-payment-link*` | confirmado (functions/edge-analysis) |
| 5 | whatsapp | text | NÃO | — | `sync_cobranca_v2` (insert/upsert) | LIDA pelo roteador (`route_inbound`, `norm_phone_br(whatsapp)`), motor v2, n8n `Get many rows` (filter whatsapp eq); índice parcial `idx_ccs_norm_whatsapp_aberto` (107k scans) | confirmado (functions-analysis + bloco-10 stat) |
| 6 | valor_inadimplente | numeric(10) | SIM | — | `sync_cobranca_v2`/`_batch` (insert/update) | LIDA por `motor_v2_get_disparos`, `picker`, `route_inbound` (prioriza maior valor), `get_phone_pending_debts`, edge link; trigger `cancel_links_on_regua_valor_update` dispara em mudança | confirmado |
| 7 | status | text | SIM | — | `sync_cobranca_v2` (insert), `batch_update_disparo_outcomes` (update) | LIDA por edge/n8n; espelhada p/ dashboard pelo `mirror_disparo_fields`; índice `_status_idx` (15 scans) | confirmado (functions-analysis; trigger WHEN inclui status) |
| 8 | regua | text | SIM | — | `sync_cobranca_v2`/`_batch` (insert/update) | LIDA por `motor_v2_get_disparos`, `picker`, edge link; trigger `cancel_links_on_regua_valor_update`; índice `_regua_idx` (56 scans) e `idx_cobranca_setembro_ativos (unit_id,regua)` | confirmado |
| 11 | data_ultima_mensagem | text | SIM | — | desconhecida (legado; provável n8n antigo) | **Sem consumidor identificado** — superseder por `data_ultima_mensagem_temp` (pos 37); não aparece em nenhuma função/edge/n8n/stat | inferido (ausência em todas as fontes) |
| 12 | plataforma_pagamento_utilizada | text | SIM | — | `register_payment` / `guard_recent_payment_setembro` (update) | Gravada no pagamento; sem leitor explícito mapeado além do app/PostgREST | inferido (functions-analysis: write em register_payment/guard) |
| 13 | link_pagamento_enviado | boolean | SIM | false | edge `generate-payment-link*` (update) | Edge functions de link (`generate-payment-link`, `generate-payment-link-abacate`) leem/escrevem | confirmado (edge-functions.json: columns inclui link_pagamento_enviado) |
| 14 | respondeu | boolean | SIM | false | n8n `CDT Cobrança` (update node 'Update a row', seta respondeu=true) | Lida downstream no fluxo n8n (Merge/Render Prompt SS) | confirmado (n8n-workflows.json write; read inferido) |
| 15 | pagamento_feito | boolean | SIM | false | `register_payment`, `guard_recent_payment_setembro`, `sync` (delete usa) | LIDA por quase tudo (motor v2, picker, route_inbound, get_phone_pending_debts, índices parciais `idx_ccs_norm_whatsapp_aberto`, `idx_cobranca_picker`, `idx_cobranca_setembro_ativos`) | confirmado |
| 17 | created_at | timestamptz | NÃO | now() | default DB | LIDA por `sync_cobranca_v2` (read) | confirmado (functions-analysis read) |
| 18 | updated_at | timestamptz | NÃO | now() | `sync`, `agent_block/pause`, `cron_*`, register_payment (update) | LIDA por `route_inbound` (frescor); `check_data_freshness` lê via data_ultimo_disparo | confirmado (functions-analysis writes; route_inbound read) |
| 19 | correlation_id | text | SIM | — | edge `generate-payment-link*` (update), `register_payment` (chave upsert) | LIDA/escrita por edge link e `limpar_links_pagamento_expirados` (NULL-ifica); stat: 491 calls update correlation_id+hora_link_gerado | confirmado (edge + functions-analysis + bloco-10) |
| 20 | data_pagamento | timestamptz | SIM | — | `register_payment`, `guard_recent_payment_setembro` (update) | **Sem leitor identificado** (write-only) — gravada mas nenhuma função/edge/n8n/stat a lê | inferido (write em 2 funções; sem read em fonte alguma) |
| 22 | "disparado com sucesso" | boolean | SIM | — | `batch_update_disparo_outcomes` (update) | Espelhada p/ dashboard pelo `mirror_disparo_fields` (WHEN inclui esta coluna) | confirmado (functions-analysis write; trigger). **Antipattern: espaço no nome** (identificador entre aspas) |
| 23 | hora_link_gerado | timestamptz | SIM | — | edge `generate-payment-link*` (update) | Lida/escrita pelo fluxo de link; stat: 70 e 491 calls update hora_link_gerado | confirmado (edge + bloco-10) |
| 24 | id | integer | NÃO | nextval(`clientes_cobranca_setembro_id_seq`) | sequence DB | PK (`_pkey`) mas `idx_scan=2` apenas — a chave de fato é `matricula`. Consumidor: PostgREST/app (ordering); sem uso interno de DB relevante | inferido (PK quase nunca usada como filtro) |
| 25 | link_pagamento | text | SIM | — | edge `generate-payment-link*` (update) | LIDA por `get_phone_pending_debts` (qual link ativo); `limpar_links_pagamento_expirados` NULL-ifica | confirmado (functions-analysis + edge) |
| 27 | data_ultimo_disparo | date | SIM | — | `sync_data_ultimo_disparo_from_message_log` (trigger handler do message_log), `batch_update_disparo_outcomes` | LIDA por `check_data_freshness` (MAX timestamp); espelhada p/ dashboard pelo `mirror_disparo_fields` | confirmado |
| 29 | semana | text | SIM | `'1'` | default DB / legado n8n | **Sem consumidor identificado** — não aparece em função/edge/n8n/stat | inferido (ausência) |
| 31 | numero_semana_1 | text | SIM | — | desconhecida (legado) | **Sem consumidor identificado** | inferido (ausência) |
| 32 | numero_semana_2 | text | SIM | — | desconhecida (legado) | **Sem consumidor identificado** | inferido (ausência) |
| 33 | disparos | numeric | SIM | `'0'` | `batch_update_disparo_outcomes` (incrementa); 1 stmt manual `UPDATE … SET status, disparos` | Espelhada p/ dashboard pelo `mirror_disparo_fields` (WHEN inclui disparos) | confirmado |
| 36 | disparos_equipe | numeric | SIM | — | `batch_update_disparo_outcomes` (update) | Espelhada p/ dashboard pelo `mirror_disparo_fields`; `docs/0007` projeta `disparos_equipe` na view de contexto (lê do dashboard) | confirmado (functions-analysis + trigger; doc confirma uso no dashboard) |
| 37 | data_ultima_mensagem_temp | timestamptz | SIM | — | n8n `CDT Cobrança` (update node seta =now()) | Lida downstream no n8n (Render Prompt SS via Merge); stat: 2808 calls update data_ultima_mensagem_temp+respondeu | confirmado (n8n-workflows.json + bloco-10) |
| 38 | "forma de pagamento" | text | SIM | — | `sync_cobranca_v2`/`_batch` (insert/update) | LIDA por `sync` (read p/ comparar); valor da planilha | confirmado (functions-analysis). **Antipattern: espaço no nome** |
| 39 | unit_id | uuid | SIM | — | `sync_cobranca_v2`/`_batch` (insert) | FK→`units`. LIDA por TUDO (RLS `user_has_access_to_unit`, picker, motor v2, route_inbound, relacionamento); 3 índices em unit_id | confirmado |
| 40 | bloqueio_disparos | boolean | NÃO | false | `agent_block_customer`, `cron_unblock_expired`, motor v2 (saída) | LIDA por `motor_v2_get_disparos`, `picker`, `get_pausas_vencidas`; trigger `trg_motor_v2_bloqueio_cliente` dispara em mudança; índices parciais `idx_cobranca_picker/_ativos/_bloqueio_expira` | confirmado |
| 41 | motivo_bloqueio | text | SIM | — | `agent_block_customer` (set), `cron_unblock_expired` (limpa) | Escrita por bloqueio; sem leitor explícito mapeado (consumo provável app/auditoria) | inferido (functions-analysis writes) |
| 42 | bloqueado_em | timestamptz | SIM | — | `agent_block_customer` (set), `cron_unblock_expired` (limpa) | LIDA por `cron_unblock_expired` (>30 dias) e índice parcial `idx_cobranca_setembro_bloqueio_expira` (12 scans) | confirmado |
| 43 | bloqueio_contexto | text | SIM | — | `agent_block_customer` (set), `cron_unblock_expired` (limpa) | Escrita; sem leitor explícito além de auditoria/app | inferido (functions-analysis writes) |
| 44 | disparos_pausados_ate | date | SIM | — | `agent_pause_customer` (set), `cron_clear_expired_pause` (limpa) | LIDA por `motor_v2_get_disparos`, `picker`, `get_pausas_vencidas`; trigger `trg_motor_v2_bloqueio_cliente`; índice parcial `idx_cobranca_setembro_pausa_vencida` | confirmado |
| 45 | pausa_motivo | text | SIM | — | `agent_pause_customer` (set), `cron_clear_expired_pause` (limpa) | LIDA por `get_pausas_vencidas` | confirmado |
| 46 | pausa_data_prometida | date | SIM | — | `agent_pause_customer` (set) | LIDA por `get_pausas_vencidas` | confirmado |
| 47 | pausa_registrada_em | timestamptz | SIM | — | `agent_pause_customer` (set), `cron_clear_expired_pause` (limpa) | **Sem leitor identificado** (write-only) | inferido (sem read em fonte alguma) |
| 48 | cadence_fase | text | SIM | — | `advance_cadence_state`, `sync` (insert F0), motor v2 | LIDA por `advance_cadence_state`, `picker_select_batch`; espelhada p/ dashboard. COMMENT: máquina de estado (NULL=fora, '00'=relacionamento, '01'=cobrança) | confirmado |
| 49 | cadence_dia_ciclo | integer | SIM | — | `advance_cadence_state`, `sync`, motor v2 | LIDA por `advance_cadence_state`, `picker`; espelhada p/ dashboard | confirmado |
| 50 | cadence_slot | integer | SIM | — | `advance_cadence_state` (update) | Consumida pelo `mirror_disparo_fields` (espelha p/ dashboard); sem outro leitor direto | inferido (write em advance; trigger WHEN inclui cadence_slot) |
| 51 | cadence_variante | integer | SIM | — | **desconhecida — NENHUM writer em fonte alguma** | Apenas referenciada no WHEN do `mirror_disparo_fields` (espelharia p/ dashboard se mudasse). Provável reservada/planejada | inferido (sem writer; só no trigger WHEN) |
| 52 | cadence_proximo_envio_at | timestamptz | SIM | — | `advance_cadence_state`, `picker_select_batch`, `register_payment` (limpa) | LIDA por `picker` (agendamento); índice parcial `idx_cobranca_picker (unit_id, cadence_proximo_envio_at)`; espelhada p/ dashboard | confirmado |
| 53 | cadence_ultimo_template | text | SIM | — | `advance_cadence_state` (update) | Espelhada p/ dashboard; lida downstream no n8n (inferido) | confirmado (write); read inferido |
| 54 | cadence_branch_state | text | SIM | `'normal'` | `register_payment` (→ ao pagar), n8n (→`em_conversa_ia`) | LIDA por `picker_select_batch` (só `normal`); índices parciais `idx_cobranca_picker` e `idx_clientes_resgate`; stat 3608 calls update. COMMENT: normal\|em_conversa_ia\|aguardando_resgate_ia_3h\|finalizado | confirmado |
| 55 | cadence_entrou_em | timestamptz | SIM | — | `sync_cobranca_v2`/`_batch` (insert) | Espelhada p/ dashboard pelo `mirror_disparo_fields` | inferido (write em sync; só trigger WHEN como leitor) |
| 56 | regua_at_entry | text | SIM | — | `sync_cobranca_v2`/`_batch` (insert) | Espelhada p/ dashboard pelo `mirror_disparo_fields` | inferido (write em sync; só trigger WHEN como leitor) |
| 57 | last_inbound_at | timestamptz | SIM | — | n8n `CDT Cobrança` (PATCH 'Marcar Em Conversa') | LIDA pelo Resgate IA 3h; índice parcial `idx_clientes_resgate (last_inbound_at) WHERE em_conversa_ia AND not pago`; espelhada p/ dashboard. COMMENT confirma uso | confirmado (n8n + comentário + índice) |
| 58 | slots_enviados_hoje | integer | SIM | 0 | `advance_cadence_state`, `picker_select_batch` (update) | LIDA por `advance_cadence_state`, `picker`; reset pelo picker quando data<hoje; espelhada p/ dashboard. COMMENT confirma | confirmado |
| 59 | slots_enviados_hoje_data | date | SIM | — | `advance_cadence_state`, `picker_select_batch` (update) | LIDA pelo picker (compara com current_date p/ reset); espelhada p/ dashboard | confirmado |
| 60 | last_resgate_ia_at | timestamptz | SIM | — | **desconhecida — NENHUM writer em fonte alguma** | Apenas no WHEN do `mirror_disparo_fields`. Provável reservada/planejada. NÃO confundir com `resgate_at` (pos 61, esse é escrito pelo n8n) | inferido (sem writer; só trigger WHEN) |
| 61 | resgate_at | timestamptz | SIM | — | n8n `CDT Cobrança` (PATCH; reset=null ao marcar em conversa; set ao enviar resgate) | Evita duplicar resgate IA 3h; stat: 683 calls update resgate_at. COMMENT confirma | confirmado (n8n + bloco-10 + comentário) |

## Relacionamentos (FKs)

- `clientes_cobranca_setembro.unit_id` → `units.id` (`clientes_cobranca_setembro_unit_id_fkey`, ON DELETE/UPDATE = no action). Única FK declarada (bloco-03).
- **Junções lógicas sem FK**: `matricula` casa com `clientes_cobranca_dashboard.matricula`, `adimplentes_base.matricula`, `pagamentos`, `message_log` (por matricula/wamid). `whatsapp` (via `norm_phone_br`) casa com `contacts.wa_id` e `adimplentes_base.telefone` (`route_inbound`). Nenhuma dessas é FK formal.

## Índices

13 índices, ~27 MB (a maior parte do peso da tabela). Destaques de uso (bloco-04):

| índice | scans | bytes | papel |
|--------|-------|-------|-------|
| `clientes_cobranca_setembro_matricula_key` (UNIQUE matricula) | 119.109 | 3,43 MB | chave de fato |
| `idx_ccs_norm_whatsapp_aberto` (norm_phone_br(whatsapp) WHERE not pago) | 107.852 | 2,89 MB | roteador inbound |
| `idx_cobranca_setembro_ativos` (unit_id, regua WHERE not bloqueio/pago) | 4.430 | 1,21 MB | motor v2 |
| `idx_setembro_unit_id` (unit_id) | 2.446 | 2,02 MB | RLS/scoping |
| `clientes_cobranca_setembro_regua_idx` | 56 | 1,25 MB | filtro regua |
| `clientes_cobranca_setembro_status_idx` | 15 | 1,06 MB | filtro status |
| `idx_cobranca_setembro_bloqueio_expira` (bloqueado_em WHERE bloqueio) | 12 | 0,08 MB | cron desbloqueio |
| `clientes_cobranca_setembro_pkey` (id) | 2 | 7,10 MB | PK quase não usada p/ filtro |

### Índices nunca usados (idx_scan=0)

| índice | bytes | avaliação |
|--------|-------|-----------|
| `idx_clientes_cobranca_setembro_matricula` (matricula, não-único) | 3,50 MB | **DESPERDÍCIO REAL — duplica `_matricula_key`** (que já é UNIQUE em matricula) |
| `idx_clientes_setembro_unit_id` (unit_id) | 2,03 MB | **DESPERDÍCIO REAL — duplica `idx_setembro_unit_id`** |
| `idx_cobranca_picker` (unit_id, cadence_proximo_envio_at WHERE …) | 2,90 MB | 0 no snapshot, MAS é índice do picker do motor v2 (cron diário) — **provável uso fora da janela ~13h**; NÃO marcar como morto |
| `idx_clientes_resgate` (last_inbound_at WHERE em_conversa_ia AND not pago) | 0,44 MB | 0 no snapshot, MAS é índice do Resgate IA 3h (cron) — **provável uso fora da janela**; NÃO morto |
| `idx_cobranca_setembro_pausa_vencida` (disparos_pausados_ate WHERE …) | 0,05 MB | 0 no snapshot, MAS suporta `get_pausas_vencidas`/cron de pausa — **provável uso fora da janela**; NÃO morto |

- **Desperdício claramente recuperável (duplicatas puras)**: `idx_clientes_cobranca_setembro_matricula` (3,50 MB) + `idx_clientes_setembro_unit_id` (2,03 MB) ≈ **5,53 MB** que podem ser droppados com segurança (já há índice equivalente em uso).
- Total idx_scan=0 ≈ 8,9 MB, mas ~3,4 MB são índices de cron legítimos (picker/resgate/pausa) — apenas idle no snapshot de ~13h, não desperdício.

## Triggers

4 triggers, todos enabled (bloco-06):

1. **`cancel_links_on_regua_valor_update`** (AFTER UPDATE OF regua, valor_inadimplente, WHEN distinct) → `supabase_functions.http_request` → edge `cancel-payment-links`. Cancela links de pagamento quando a régua ou o valor muda (cobrança mudou → link antigo inválido).
2. **`mirror_disparo_fields`** (AFTER UPDATE, WHEN qualquer de ~18 colunas distinct) → `mirror_disparo_fields_to_dashboard()`. **Espelha** disparos, disparos_equipe, "disparado com sucesso", data_ultimo_disparo, status e todos os `cadence_*` + last_inbound_at + slots_* + last_resgate_ia_at + regua_at_entry para `clientes_cobranca_dashboard`. → É o **consumidor** de muitas colunas que de outra forma pareceriam sem leitor.
3. **`trg_guard_recent_payment_setembro`** (BEFORE INSERT/UPDATE) → `guard_recent_payment_setembro()`. Detecta pagamento nas últimas 48h em `pagamentos` (pela matricula) e marca a linha como paga (pagamento_feito/data_pagamento/plataforma).
4. **`trg_motor_v2_bloqueio_cliente`** (AFTER UPDATE OF bloqueio_disparos, disparos_pausados_ate, WHEN distinct) → `trg_motor_v2_bloqueio_cliente()`. Reage a bloqueio/pausa (provável saída da cadência / log).

## RLS / Policies

RLS ligada (não forçada). 6 policies (bloco-09):

| policy | cmd | roles | qual |
|--------|-----|-------|------|
| Authenticated users can read setembro data | SELECT | authenticated | **`true`** |
| Users can view clients from their units - setembro | SELECT | public | `user_has_access_to_unit(unit_id)` |
| Users can insert clients in their units - setembro | INSERT | public | with_check `user_has_access_to_unit(unit_id)` |
| Users can update clients from their units - setembro | UPDATE | public | `user_has_access_to_unit(unit_id)` (qual+check) |
| Only admins can delete clients - setembro | DELETE | public | EXISTS user_roles admin |
| Only admins can modify setembro records | ALL | public | `has_role(uid,'admin')` |

**Achados de segurança/redundância (crítico):**

- **`"Authenticated users can read setembro data"` tem `qual = true`** e é PERMISSIVE → é OR'd com a policy per-unit. Resultado: **qualquer usuário autenticado lê TODAS as linhas de todas as unidades** — a policy `true` anula o isolamento por unidade na leitura. A coexistência com "Users can view clients from their units" torna esta última inócua para SELECT. **Falha de isolamento de tenant.**
- A policy `Only admins can modify setembro records` (cmd=**ALL**) sobrepõe-se a TODAS as policies específicas de INSERT/UPDATE/DELETE (PERMISSIVE → OR). Como admin já tem ALL, as policies específicas só ampliam para não-admins.
- **DELETE coberto em duplicidade**: `Only admins can delete clients` (DELETE) + `Only admins can modify setembro records` (ALL) — ambas exigem admin → redundante.

## Quem escreve / Quem lê

**Escrevem** (functions-analysis, edge-functions, n8n, bloco-10):
- `sync_cobranca_v2` / `sync_cobranca_batch` — insert/update/delete/upsert do sync da planilha (origem da maioria das colunas de cadastro + seed de cadência F0).
- `picker_select_batch` — slots_enviados_hoje(_data), cadence_proximo_envio_at (FOR UPDATE SKIP LOCKED).
- `advance_cadence_state` — todos os `cadence_*` + slots_*.
- `register_payment` / `guard_recent_payment_setembro` — pagamento_feito, data_pagamento, plataforma, limpa lock/branch.
- `agent_block_customer` / `agent_pause_customer` / `cron_unblock_expired` / `cron_clear_expired_pause` — bloqueio_* e pausa_*.
- `batch_update_disparo_outcomes` — disparos, disparos_equipe, "disparado com sucesso", data_ultimo_disparo, status.
- `sync_data_ultimo_disparo_from_message_log` (trigger handler) — data_ultimo_disparo.
- `limpar_links_pagamento_expirados` — NULL-ifica link_pagamento/correlation_id.
- `rollback_sync` — restaura/deleta a partir de `cobranca_sync_backup`.
- Edge `generate-payment-link` / `generate-payment-link-abacate` — link_pagamento_enviado, link_pagamento, correlation_id, hora_link_gerado, plataforma.
- n8n `CDT Cobrança` — cadence_branch_state, last_inbound_at, resgate_at, data_ultima_mensagem_temp, respondeu (stat: milhares de calls/dia via PostgREST PATCH).

**Leem** (além dos writers acima):
- `motor_v2_get_disparos`, `motor_v2_relacionamento_*` — seleção de batch.
- `route_inbound` — roteamento por telefone normalizado (prioriza cobrança de maior valor).
- `get_phone_pending_debts`, `get_pausas_vencidas` — consultas de apoio.
- `check_data_freshness` — frescor (MAX data_ultimo_disparo).
- Trigger `mirror_disparo_fields_to_dashboard` — propaga ~18 colunas para o dashboard.
- PostgREST/app (top stat: SELECT * com filtro, 6588 calls; e os UPDATEs acima).

## Observações

- **Tabela-núcleo de cobrança.** É a "viva"; `clientes_cobranca_dashboard` é o espelho de leitura mantido pelo trigger `mirror_disparo_fields`. O COMMENT "duplicate of clientes_cobranca" é **historicamente verdadeiro (origem por fork), enganoso quanto ao papel atual** (`n_tup_ins=0` + 49,6k linhas corrobora o fork; mas hoje é mantida por sync e é base ativa do motor v2). Não repetir o comentário como fato sobre função.
- **Sem consumidor identificado (write-only ou legado)**: `data_ultima_mensagem` (11), `semana` (29), `numero_semana_1` (31), `numero_semana_2` (32), `data_pagamento` (20, write-only), `pausa_registrada_em` (47, write-only) = **6 colunas**.
- **Sem writer identificado (origem desconhecida, provável reservada/planejada)**: `cadence_variante` (51) e `last_resgate_ia_at` (60) — só aparecem no WHEN do trigger de espelho. Atenção: `last_resgate_ia_at` ≠ `resgate_at` (este último É escrito pelo n8n).
- **Antipatterns**:
  - Colunas com **espaço no nome**: `"disparado com sucesso"` (22) e `"forma de pagamento"` (38) → exigem aspas, quebram ORMs e geração de tipos.
  - **2 índices puramente duplicados** (~5,53 MB recuperáveis): `idx_clientes_cobranca_setembro_matricula` e `idx_clientes_setembro_unit_id`.
  - **Lacunas de ordinal** (1-2, 9-10, 16, 21, 26, 28, 30, 34-35) = colunas droppadas → churn de schema fora de migrations versionadas (tabela não existe em `infra/supabase/migrations/`).
- **Segurança (RLS)**: a policy SELECT `qual=true` anula o isolamento por unidade na leitura — qualquer authenticated lê tudo. Avaliar se é intencional (leitura global de operadores) ou bug.
- **Contradição doc↔banco**: nenhuma de fundo — `docs/03-database.md` descreve corretamente setembro+dashboard como "base de devedores, volátil" e registra que usar `cadence_branch_state` aqui foi a alternativa rejeitada ao `routing` do CHAT-CDT. O CLAUDE.md reforça: **nunca alterar tabelas do n8n** — qualquer drop de índice/policy aqui exige coordenação com o fluxo n8n em produção.
