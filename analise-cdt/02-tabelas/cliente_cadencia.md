# cliente_cadencia

## Identificação
- **Nome**: `public.cliente_cadencia`
- **Dono provável**: **n8n / Cobrança** (Motor v2). Não há nenhuma migration do CHAT-CDT que crie ou altere esta tabela (`grep` em `infra/supabase/migrations/` => 0 ocorrências). É escrita e lida exclusivamente por funções `motor_v2_*`, triggers `trg_motor_v2_*` e edge functions `motor-v2-*` — todo o domínio de cobrança. (Fonte: `functions-analysis.json`, `edge-functions.json`, ausência em `migrations/`.)
- **Linhas estimadas**: 22.771 (`n_live_tup`); 27.589 inserts acumulados, 473 updates, 0 deletes (`bloco-01`). Crescimento por append (novo ciclo = novo row), nunca deleta — coerente com o COMMENT ("Volta → novo row com ciclo_numero+1").
- **Tamanho**: 9.040 kB total / heap 3.840 kB → ~5,2 MB são índices (5 índices). (`bloco-01`, `bloco-04`.)
- **Classificação**: **Cobrança** (estado por cliente do Motor v2, ciclo de 21 dias).
- **Bloat / alerta**: `bytes_total`/linha ≈ 407 B/linha, mas o **heap** é só 3.840 kB (~169 B/linha) — saudável. O peso está nos índices: heap 3.840 kB vs índices ~5.200 kB (índices > 1,3× a tabela). `n_dead_tup`=468 (~2%) com autovacuum recente (2026-06-01 15:44) — sem bloat de heap relevante. **Não há bloat de dados; há excesso/ineficiência de índices** (ver seção Índices).

## Finalidade
Tabela de **estado por cliente dentro de um ciclo de cobrança de 21 dias** (Motor v2). Cada linha representa a participação de uma matrícula (de uma unidade) num ciclo: qual régua segue, em que dia do ciclo está (`dia_ciclo` 1..21+), quando entrou, e o status do ciclo (`ACTIVE`, `PAUSED_REGUA_MORTA`, `PAUSED_BLOQUEADO`, `PAGO`, `FINALIZADO`). O ciclo avança 1 dia/noite (fechamento), encerra no dia 22 enfileirando o cliente na fila humana, ou termina antes por pagamento/bloqueio. Quando o cliente volta a ficar inadimplente, **não** se reativa a linha: cria-se uma nova com `ciclo_numero+1`. A régua só muda por decisão do BI/gate (o motor lê o gate, nunca redefine a régua sozinho).

## Colunas
`# | coluna | tipo | nulo | default | origem | consumidores | confiança`

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('cliente_cadencia_id_seq')` | sequence (default) no INSERT de `motor_v2_get_disparos` / planejador edge | FK de `disparos_log.cliente_cadencia_id` e `fila_humana.cliente_cadencia_id`; lido no RETURNING por `motor_v2_finalizar_dia22` e `trg_motor_v2_bloqueio_cliente`; PK | confirmado (`bloco-03`, `functions-analysis`) |
| 2 | matricula | text | NO | — | INSERT seed em `motor_v2_get_disparos` / `motor-v2-planejador` (vem de `clientes_cobranca_setembro.matricula`) | predicado WHERE e RETURNING em `motor_v2_finalizar_dia22`, `motor_v2_get_disparos`, `trg_motor_v2_bloqueio_cliente`, edge `motor-v2-fechamento`; chave de join com cobrança | confirmado (`functions-analysis`, `edge-functions`) |
| 3 | unit_id | uuid | NO | — | INSERT seed (`clientes_cobranca_setembro.unit_id`) via planejador/`motor_v2_get_disparos` | FK→`units.id`; predicado WHERE em quase todas as fns motor_v2 (filtro por unidade); lido no RETURNING de finalizar/bloqueio | confirmado (`bloco-03`, `functions-analysis`) |
| 4 | telefone | text | YES | — | INSERT seed; telefone normalizado inline via `regexp_replace` (NÃO `norm_phone_br`) em `motor_v2_get_disparos` | RETURNING→`fila_humana.telefone`/`disparos_log.telefone` em `motor_v2_finalizar_dia22`, `motor_v2_get_disparos`, `trg_motor_v2_bloqueio_cliente` | confirmado (`functions-analysis` notes) |
| 5 | nome | text | YES | — | INSERT seed (`clientes_cobranca_setembro.name`) | RETURNING→`fila_humana.nome` em finalizar/bloqueio; payload de disparo em `motor_v2_get_disparos` | confirmado (`functions-analysis`) |
| 6 | regua | text | NO | — | INSERT seed: a régua por-cliente provavelmente é **copiada de `clientes_cobranca_setembro.regua`** (definida pelo BI — ver COMMENT "Régua vem do BI"); `gate_state.reguas_efetivas` é o **conjunto permitido** usado p/ pausar/retomar, não o valor copiado. `motor_v2_get_disparos`/planejador leem AMBOS. | lido por `motor_v2_get_disparos` para join com `cadence_calendar(regua, dia_ciclo, slot_index, action_type)` e montar disparo | **inferido** quanto à *fonte* (candidatas: `clientes_cobranca_setembro.regua` vs `gate_state.reguas_efetivas`); só o read+write da coluna é confirmado (`functions-analysis`) |
| 7 | dia_ciclo | integer | NO | `1` | INSERT seed=1; UPDATE +1 por `motor_v2_avancar_dia` e por `motor_v2_get_disparos` (avanço inline) | lido em `motor_v2_get_disparos` (join `cadence_calendar`) e `motor_v2_finalizar_dia22` (WHERE dia_ciclo > 21); índice `idx_cliente_cadencia_unit_status` | confirmado (`functions-analysis` reads/writes) |
| 8 | ciclo_numero | integer | NO | `1` | INSERT em `motor_v2_get_disparos`/planejador; incrementa a cada novo ciclo do mesmo cliente | componente do índice único `..._matricula_unit_id_ciclo_numero_key` (distingue ciclos da mesma matrícula) | inferido — escrito explicitamente no INSERT (`functions-analysis`), mas o incremento +1 não aparece literal nas notes; lógica descrita só no COMMENT da tabela |
| 9 | entrou_em | date | NO | — | INSERT seed em `motor_v2_get_disparos`/planejador (data de entrada no ciclo) | lido só pela **auditoria** (`trg_log_event_changes` → `event_log`); **sem reader de NEGÓCIO** identificado | inferido (escrito no INSERT; nenhum reader de negócio literal em `functions-analysis`/`edge-functions`) |
| 10 | status | text | NO | `'ACTIVE'::text` | INSERT=ACTIVE; UPDATE para PAGO/FINALIZADO/PAUSED_* por `motor_v2_get_disparos`, `motor_v2_finalizar_dia22`, `motor_v2_avancar_dia`(WHERE), `trg_motor_v2_bloqueio_cliente`, fallback PAGO em `motor-v2-fechamento` | WHERE em quase todas as fns; predicado dos índices parciais `idx_cliente_cadencia_ativo_unico` e `idx_cliente_cadencia_unit_status` | confirmado (`functions-analysis`, `edge-functions`, `bloco-04`) |
| 11 | paused_at | timestamptz | YES | — | UPDATE em `trg_motor_v2_bloqueio_cliente` (PAUSED_BLOQUEADO) e em `motor_v2_get_disparos` (saída por bloqueio); também escrito pelo planejador | lido só pela **auditoria** (`trg_log_event_changes` → `event_log`); **sem reader de NEGÓCIO** identificado | inferido (writers confirmados; nenhum SELECT de negócio explícito) |
| 12 | paused_reason | text | YES | — | UPDATE em `trg_motor_v2_bloqueio_cliente` (motivo da pausa); planejador grava ao pausar por régua morta | lido só pela **auditoria** (`event_log`); **sem reader de NEGÓCIO** identificado | inferido (writer confirmado; sem reader de negócio) |
| 13 | finalizado_at | timestamptz | YES | — | UPDATE em `motor_v2_finalizar_dia22` (status=FINALIZADO) e em `motor_v2_get_disparos` (finaliza inline) | lido só pela **auditoria** (`event_log`); **sem reader de NEGÓCIO** identificado | inferido (writer confirmado; sem reader de negócio) |
| 14 | pago_at | timestamptz | YES | — | UPDATE status=PAGO em `motor_v2_get_disparos` e fallback de `motor-v2-fechamento` (a partir de `clientes_cobranca_setembro.pagamento_feito`); planejador também grava | lido só pela **auditoria** (`event_log`); **sem reader de NEGÓCIO** identificado | inferido (writer confirmado; sem reader de negócio) |
| 15 | last_disparo_at | timestamptz | YES | — | **desconhecida** — não aparece em nenhum write de `functions-analysis`/`edge-functions`; não consta nas listas de colunas escritas por motor_v2 nem pelo planejador. **Única coluna sem writer identificado.** | lido só pela **auditoria** (`event_log`) se preenchida; **sem reader de NEGÓCIO** | inferido / **sem writer identificado** (candidata a coluna nunca preenchida; verificar no banco se está sempre NULL) |
| 16 | created_at | timestamptz | NO | `now()` | default `now()` no INSERT | lido implicitamente por `trg_log_event_changes` (to_jsonb da linha → event_log); sem reader de negócio | confirmado (default; auditoria) |
| 17 | updated_at | timestamptz | NO | `now()` | default `now()`; setado em todo UPDATE de `motor_v2_avancar_dia`, `motor_v2_finalizar_dia22`, `motor_v2_get_disparos`, `trg_motor_v2_bloqueio_cliente`, `motor-v2-fechamento` | auditoria; sem reader de negócio identificado | confirmado (`functions-analysis` writes incluem `updated_at` em todos os UPDATE) |
| 18 | last_advance_date | date | YES | — | UPDATE em `motor_v2_avancar_dia` e `motor_v2_get_disparos` (data do último avanço) | **idempotência**: lido no WHERE de `motor_v2_avancar_dia` (avança só se `last_advance_date < target_date`) e em `motor_v2_get_disparos` | confirmado (COMMENT da coluna + `functions-analysis` reads/writes) |

> Sem gaps de ordinal (pos 1..18 contínuos) → nenhuma coluna droppada.

## Relacionamentos (FKs)
- **Saindo**: `cliente_cadencia.unit_id → units.id` (`cliente_cadencia_unit_id_fkey`, ON DELETE/UPDATE = NO ACTION). (`bloco-03`.)
- **Entrando** (esta tabela é referenciada por):
  - `disparos_log.cliente_cadencia_id → cliente_cadencia.id` (`disparos_log_cliente_cadencia_id_fkey`). Cada disparo do motor aponta para a linha de cadência.
  - `fila_humana.cliente_cadencia_id → cliente_cadencia.id` (`fila_humana_cliente_cadencia_id_fkey`). Finalização/bloqueio enfileira o cliente referenciando a cadência.
- Todas com `on_delete='a'` (NO ACTION) — coerente com `n_tup_del=0` (a tabela nunca é deletada).

## Índices
Total 5 índices, ~5,16 MB. (`bloco-04`.)

| índice | único | bytes | idx_scan | papel |
|--------|-------|-------|----------|-------|
| `idx_cliente_cadencia_ativo_unico` (UNIQUE, parcial: `matricula,unit_id` WHERE status IN ACTIVE/PAUSED_REGUA_MORTA/PAUSED_BLOQUEADO) | sim | 1.466.368 | **81.733** | Workhorse: garante 1 ciclo "vivo" por matrícula/unidade e serve os lookups do motor. Predicado-chave do design. |
| `idx_cliente_cadencia_matricula` (`matricula,unit_id`) | não | 1.474.560 | 1.256 | Lookups por matrícula em qualquer status. |
| `cliente_cadencia_pkey` (`id`) | sim | 532.480 | 356 | PK; usado pelas FKs de `disparos_log`/`fila_humana`. |
| `idx_cliente_cadencia_unit_status` (`unit_id,status,dia_ciclo`) | não | 204.800 | 78 | Varreduras por unidade+status (avançar/finalizar por unidade). Baixo uso mas funcional. |
| `cliente_cadencia_matricula_unit_id_ciclo_numero_key` (UNIQUE `matricula,unit_id,ciclo_numero`) | sim | **1.482.752** | **0** | Garante unicidade do ciclo histórico. **NUNCA USADO em scan** (mas é constraint — vide nota). |

### Índices nunca usados (idx_scan=0)
- `cliente_cadencia_matricula_unit_id_ciclo_numero_key` — **1.482.752 bytes ≈ 1,41 MB**.
- **Atenção**: `idx_scan=0` aqui **não** significa descartável. É um **UNIQUE constraint** que impõe a regra de unicidade do ciclo histórico ("1 row por matrícula+unidade+ciclo_numero" — exatamente o "novo row com ciclo_numero+1" do COMMENT). Scans=0 é esperado para um índice cujo propósito é integridade na escrita, não leitura. **Não remover.** Desperdício real = 0 (mantido por necessidade). (Obs.: não há `ON CONFLICT` literal observado em `functions-analysis` — o mecanismo exato de upsert/insert não foi confirmado nas fontes.)
- **Sobreposição a observar**: `idx_cliente_cadencia_matricula` (`matricula,unit_id`, ~1,44 MB) é prefixo do índice único de ciclo e parcialmente redundante com o parcial `idx_cliente_cadencia_ativo_unico`. Para queries que filtram por status ativo, o parcial já cobre; o índice cheio só agrega valor para lookups em status terminal (PAGO/FINALIZADO). Uso 1.256 scans justifica mantê-lo por ora, mas é candidato a revisão se esses lookups forem raros.

## Triggers
- `trg_event_log_cliente_cadencia` — AFTER INSERT/UPDATE/DELETE, ROW, executa `trg_log_event_changes()`. Handler **genérico de auditoria**: insere em `event_log` o `to_jsonb(OLD)`/`to_jsonb(NEW)` (before/after) + actor das GUCs `app.*`. Consequência: **toda mutação lê a linha inteira** (todas as 18 colunas) e a despeja em `event_log.before_data/after_data`. (`bloco-06`, `functions-analysis: trg_log_event_changes`.)
- Não há triggers de negócio próprios em `cliente_cadencia`; a lógica de pausa por bloqueio mora em `trg_motor_v2_bloqueio_cliente`, que é trigger de **`clientes_cobranca_setembro`** (n8n) e apenas **escreve** em `cliente_cadencia`.

## RLS / Policies
- `rls_on = true`, `rls_forced = false`, **`n_policies = 0`** (`bloco-01`; `bloco-09` => 0 policies). 
- **RLS habilitada sem nenhuma policy = deny-all para roles não privilegiados** (anon/authenticated). O acesso ocorre via funções `SECURITY DEFINER` (`motor_v2_avancar_dia`, `motor_v2_finalizar_dia22`, `trg_motor_v2_bloqueio_cliente`) e via **service_role** (edge functions `motor-v2-*`, que usam `SUPABASE_SERVICE_ROLE_KEY` e bypassam RLS). Note que `motor_v2_get_disparos` **não** é SECURITY DEFINER — depende de ser chamada sob service_role/owner para enxergar dados.
- Não há policies duplicadas/sobrepostas (não há policy nenhuma).

## Quem escreve / Quem lê
**Escrevem (INSERT):**
- `motor_v2_get_disparos` — seed de novas cadências (1 INSERT) com `matricula,unit_id,telefone,nome,regua,dia_ciclo,ciclo_numero,entrou_em,status,last_advance_date,created_at,updated_at`. (`functions-analysis`, confirmado.)
- edge `motor-v2-planejador` — sincroniza `cliente_cadencia` com `clientes_cobranca_setembro` (select/insert/update). (`edge-functions`, confirmado.)

**Escrevem (UPDATE):**
- `motor_v2_avancar_dia` → `dia_ciclo, last_advance_date, updated_at` (avanço noturno, idempotente por `last_advance_date`). (confirmado)
- `motor_v2_finalizar_dia22` → `status, finalizado_at, updated_at` (dia 22 → FINALIZADO; RETURNING alimenta `fila_humana`). (confirmado)
- `motor_v2_get_disparos` → vários UPDATE inline (`dia_ciclo/last_advance_date`; `status/finalizado_at`; `status/pago_at`; `status/paused_at`). (confirmado)
- `trg_motor_v2_bloqueio_cliente` → `status, paused_at, paused_reason, updated_at` (pausa por bloqueio; trigger de `clientes_cobranca_setembro`). (confirmado)
- edge `motor-v2-fechamento` → fallback `status=PAGO, pago_at, updated_at` a partir de `clientes_cobranca_setembro.pagamento_feito`. (confirmado)
- edge `motor-v2-planejador` → update de status/pausa/pago. (confirmado)

**Leem (SELECT):**
- `motor_v2_get_disparos` — lê `matricula,telefone,nome,regua,dia_ciclo,unit_id,status,last_advance_date` para montar disparos (join `cadence_calendar`). (confirmado)
- `motor_v2_finalizar_dia22` — lê `id,unit_id,matricula,telefone,nome,status,dia_ciclo`. (confirmado)
- `motor_v2_avancar_dia` — lê `status,last_advance_date,unit_id` no WHERE. (confirmado)
- edge `motor-v2-fechamento` / `motor-v2-planejador` — select por `unit_id,matricula,status,id`. (confirmado)
- `trg_log_event_changes` (auditoria) — lê a linha inteira em cada mutação → `event_log`. (confirmado)
- FKs `disparos_log` e `fila_humana` referenciam `id`.
- **pg_stat_statements**: 0 matches em `bloco-10a/10b`. Isso é coerente — os acessos vêm de funções `SECURITY DEFINER`/RPC e edge sob service_role, cujo SQL interno frequentemente não aparece normalizado por nome de tabela no topo do snapshot de 13h; **ausência aqui não é sinal de tabela morta**.

## Observações
- **Classificação reafirmada: tabela do domínio n8n/Cobrança (Motor v2)**, apesar de não ter prefixo `chat_` nem `clientes_cobranca_`. Não é definida por nenhuma migration do CHAT-CDT; o CHAT-CDT a trata como tabela externa (read-only para a UI, se houver). Confirma a regra do CLAUDE.md de não alterar tabelas do fluxo de cobrança.
- **`last_disparo_at` (col 15)**: nenhum writer nem reader identificado em `functions-analysis`/`edge-functions`. Forte candidata a coluna **sempre NULL/abandonada** (o registro de "último disparo" parece morar em `disparos_log`, não aqui). Verificar no banco `SELECT count(*) FILTER (WHERE last_disparo_at IS NOT NULL)`; se 0, é coluna fantasma.
- **Colunas de timestamp terminais (`paused_at/paused_reason/finalizado_at/pago_at`), `entrou_em` e `last_disparo_at`** = 6 colunas **sem reader de NEGÓCIO identificado**. Importante: por causa do trigger de auditoria (`to_jsonb` da linha → `event_log`), **nenhuma coluna é estritamente sem-reader** — o audit trigger é um reader estrutural de todas as 18. Logo, "sem consumidor" aqui = "sem reader de negócio". Essas 6 fluem só para o audit log e para BI/relatórios externos não capturados nestas fontes — não são "mortas".
- **Índice de integridade vs. índice de leitura**: o único `idx_scan=0` (`..._ciclo_numero_key`) é constraint estrutural, não desperdício. O ponto de atenção real é a **sobreposição** entre `idx_cliente_cadencia_matricula` (cheio) e os dois índices que já cobrem (matricula,unit_id) — o parcial `idx_cliente_cadencia_ativo_unico` e o prefixo do índice único de ciclo. Há ~1,44 MB potencialmente economizável se os lookups em status terminal forem desprezíveis.
- **RLS sem policy**: configuração intencional de "fechado por padrão", mas frágil se algum dia a UI tentar ler direto com a chave anon — retornará vazio silenciosamente (mesmo antipattern já registrado na memória do projeto para `user_units`). Acesso correto = via RPC `SECURITY DEFINER` ou service_role.
- **Coerência com o COMMENT da tabela**: o COMMENT descreve fielmente o ciclo de vida (PAGO / novo row com ciclo_numero+1 / PAUSED_REGUA_MORTA / dia 22 → FINALIZADO + fila_humana). Os writers confirmados (`motor_v2_finalizar_dia22` → `fila_humana`, `trg_motor_v2_bloqueio_cliente`, seed/avanço de `motor_v2_get_disparos`) **batem com a narrativa** — raro caso em que doc-no-banco e implementação concordam. A única lacuna documental é `last_disparo_at`, não mencionada e aparentemente sem uso.
