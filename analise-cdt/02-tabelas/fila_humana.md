# fila_humana

## Identificação
- **Nome:** `public.fila_humana`
- **Dono provável:** n8n / Motor v2 (Cobrança). Não definida em migrations do CHAT-CDT (grep em `0001`–`0013` sem hits). Escrita por funções/triggers `motor_v2_*` (`functions-analysis.json`).
- **Linhas estimadas:** ~355 live tuples (`bloco-01`, `n_live_tup`); `linhas_estimadas` 324.
- **Tamanho:** 296 kB total / 168 kB heap (`bloco-01`).
- **Classificação:** **Cobrança** (fila de tratamento humano do Motor v2).
- **Bloat:** ~854 bytes/linha — normal para tabela larga com vários campos texto/timestamp; `n_dead_tup=0`. Sem alerta.

## Finalidade
Fila de exceção do Motor v2: recebe clientes que **saíram da cadência automática** e precisam de tratamento manual pelo time humano. Três gatilhos de entrada: (1) finalização do ciclo de 21 dias sem pagamento (`FINALIZOU_21D`), (2) bloqueio de disparos do cliente, (3) falha persistente. A linha é aberta com os dados do devedor e o motivo; os campos de resolução (`assigned_*`, `resolved_*`, `notes`) são preenchidos depois pelo operador humano (fora do corpus SQL analisado — provável app/frontend).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NÃO | `nextval('fila_humana_id_seq')` | sequence (PK) | PK `fila_humana_pkey`; auditado por `trg_event_log_fila_humana` | confirmado |
| 2 | unit_id | uuid | NÃO | — | INSERT de `motor_v2_finalizar_dia22` e `trg_motor_v2_bloqueio_cliente`; valor vem de `cliente_cadencia`/linha do trigger | FK→units; índices `idx_fila_humana_matricula`, `idx_fila_humana_unit_aberta`; lido por `trg_motor_v2_bloqueio_cliente` (dedup) | confirmado (writer literal + FK) |
| 3 | matricula | text | NÃO | — | INSERT dos 2 writers; valor de `cliente_cadencia` (RETURNING) ou `NEW.matricula` do trigger | índice `idx_fila_humana_matricula`; lido por `trg_motor_v2_bloqueio_cliente` (dedup) | confirmado |
| 4 | telefone | text | SIM | — | INSERT dos 2 writers; valor de `cliente_cadencia`/`NEW.whatsapp` | sem consumidor identificado (display humano) | confirmado (write) |
| 5 | nome | text | SIM | — | INSERT dos 2 writers; valor de `cliente_cadencia`/`NEW.name` | sem consumidor identificado (display) | confirmado (write) |
| 6 | cliente_cadencia_id | bigint | SIM | — | INSERT dos 2 writers (id da cadência de origem) | FK→cliente_cadencia | confirmado (FK + writer) |
| 7 | motivo | text | NÃO | — | INSERT dos 2 writers (`FINALIZOU_21D`, bloqueio, etc., literal) | sem consumidor identificado (triagem humana) | confirmado (write) |
| 8 | motivo_detalhe | text | SIM | — | INSERT dos 2 writers; em `motor_v2_finalizar_dia22` inclui `p_target_date` no texto | sem consumidor identificado | confirmado (write) |
| 9 | entered_at | timestamptz | NÃO | `now()` | default `now()` | índice parcial `idx_fila_humana_unit_aberta` (ordenação) | confirmado (default + bloco-04) |
| 10 | assigned_to | text | SIM | — | **nenhum writer no corpus** — preenchido na atribuição manual (app/frontend); origem desconhecida no corpus | sem consumidor identificado | inferido |
| 11 | assigned_at | timestamptz | SIM | — | **nenhum writer no corpus** — app na atribuição | sem consumidor identificado | inferido |
| 12 | resolved_at | timestamptz | SIM | — | **nenhum writer no corpus** — app na resolução | **lido** por `trg_motor_v2_bloqueio_cliente` (checa `resolved_at IS NULL` p/ não duplicar item aberto); índice parcial `idx_fila_humana_unit_aberta` (WHERE resolved_at IS NULL) | inferido (origem) / confirmado (leitura) |
| 13 | resolved_outcome | text | SIM | — | **nenhum writer no corpus** — app na resolução | sem consumidor identificado | inferido |
| 14 | notes | text | SIM | — | **nenhum writer no corpus** — app | sem consumidor identificado | inferido |
| 15 | created_at | timestamptz | NÃO | `now()` | default `now()` | sem consumidor identificado | confirmado (default) |
| 16 | updated_at | timestamptz | NÃO | `now()` | default `now()` no INSERT | sem consumidor identificado | confirmado (default) |

## Relacionamentos (FKs)
- `fila_humana_unit_id_fkey`: `unit_id → units.id` (`ON DELETE a` = NO ACTION). `bloco-03`.
- `fila_humana_cliente_cadencia_id_fkey`: `cliente_cadencia_id → cliente_cadencia.id` (`ON DELETE a`). Liga o item da fila à cadência de origem.

## Índices
| índice | uso (idx_scan) | bytes | nota |
|--------|----------------|-------|------|
| fila_humana_pkey | 1 | 16.384 | PK |
| idx_fila_humana_matricula | 348 | 40.960 | (matricula, unit_id) — quente; alimenta dedup do trigger de bloqueio |
| idx_fila_humana_unit_aberta | 7 | 40.960 | parcial (unit_id, entered_at DESC) WHERE resolved_at IS NULL — lista de itens abertos por unidade |

### Índices nunca usados (idx_scan=0)
**Nenhum.** Os três índices têm uso na janela. Sem desperdício. (`idx_scan` total da tabela = 356, `seq_scan = 0` — tudo via índice.)

## Triggers
- `trg_event_log_fila_humana` (`bloco-06`): `AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`, executa `trg_log_event_changes()`. Audita toda mutação da fila gravando before/after em `event_log`. Estado: enabled.
- **Não há trigger BEFORE** (ver Observações sobre `updated_at`).

## RLS / Policies
- `rls_on = true`, `rls_forced = false`, **`n_policies = 0`** (`bloco-01` / `bloco-09` vazio).
- Efeito: **default-deny**. Alcançável só por `service_role`/`SECURITY DEFINER`. Os writers `motor_v2_finalizar_dia22` (secdef=true) e `trg_motor_v2_bloqueio_cliente` (secdef=true) passam pela RLS; a leitura/resolução pela app precisa ser via service_role ou SECURITY DEFINER, senão `authenticated`/`anon` veriam fila vazia.

## Quem escreve / Quem lê
**Escrita (INSERTs, `functions-analysis.json`, confidence confirmado):**
- `motor_v2_finalizar_dia22` (secdef) — enfileira clientes que passaram do dia 21 sem pagamento. Notes: CTE `finalized` faz `UPDATE...RETURNING` em `cliente_cadencia` e alimenta o INSERT (origem dos campos `matricula/unit_id/telefone/nome`). Chamada pela edge `motor-v2-fechamento`.
- `trg_motor_v2_bloqueio_cliente` (secdef) — ao detectar bloqueio de disparos, abre item na fila. **Lê** `matricula/unit_id/resolved_at` antes (dedup de item aberto). Atua sobre a tabela do n8n `clientes_cobranca_setembro` (inferido pelo source_detail).

**Leitura:** `trg_motor_v2_bloqueio_cliente` (dedup). Demais leituras (lista de fila, atribuição, resolução) são pela **app/frontend** via service_role — fora do corpus SQL. `pg_stat` (~13h) não capturou SELECTs nomeando a tabela.

## Observações
- **`sem_consumidor` = 13** (regra estrita: têm consumidor identificado apenas `matricula`, `unit_id`, `resolved_at` — lidos pelo trigger de bloqueio; mais `id`/`cliente_cadencia_id`/`unit_id` via FK). As 13 restantes são lidas out-of-band pela UI de tratamento humano (não mapeada no corpus). **Não é tabela morta** — é fila ativa (355 linhas, índice de abertos em uso).
- **5 colunas de resolução humana sem writer no corpus** (`assigned_to`, `assigned_at`, `resolved_at`, `resolved_outcome`, `notes`): preenchidas pelo operador via app, não por funções SQL. Caso instrutivo: `resolved_at` **tem reader** (trigger de dedup) mas **nenhum writer** no corpus — leitor sem escritor mapeado.
- **Antipattern (`updated_at` congelado):** default `now()` no INSERT, mas o único trigger é o AFTER de auditoria — **não há BEFORE UPDATE** que faça `updated_at = now()`. Logo `updated_at` fica fixo no momento do insert e **não acompanha** a resolução humana (UPDATE). Se a app não setar explicitamente, o campo é enganoso. Sinalizar.
- Sem colunas com espaço no nome.
- Cadeia de origem **confirmada**: `fila_humana.{matricula,unit_id,telefone,nome}` ← `cliente_cadencia` via `RETURNING` em `motor_v2_finalizar_dia22` (notes da função).
