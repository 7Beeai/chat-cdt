# event_log

## Identificação
- **Nome:** `public.event_log`
- **Dono provável:** n8n / Motor v2 (Cobrança). Não definida em nenhuma migration do CHAT-CDT (`infra/supabase/migrations/0001`–`0013` — grep não encontrou). Toda a maquinaria de escrita está em funções `motor_v2_*` / `trg_*` (bloco `functions-analysis.json`).
- **Linhas estimadas:** ~42.294 live tuples (`bloco-01`, `n_live_tup`); `linhas_estimadas` 41.208.
- **Tamanho:** 49 MB total / 36 MB heap (`bloco-01`).
- **Classificação:** **Cobrança** (auditoria universal do Motor v2).
- **Bloat:** ~1.221 bytes/linha (51.650.560 / 42.294). Alto, mas justificado: 4 colunas `jsonb` (`before_data`, `after_data`, `metadata` + payloads) + 11 índices. `n_dead_tup=0` e autovacuum/autoanalyze recentes — sem bloat de tuplas mortas. O peso vem de índices (≈12 MB) e jsonb, não de lixo. Tabela é **append-only** (`n_tup_upd=0`, `n_tup_del=0` em `bloco-01`), coerente com o COMMENT ("Imutável: nenhum UPDATE/DELETE").

## Finalidade
Log de auditoria universal e append-only do Motor v2: cada mudança relevante (ação do motor, ação humana, webhook externo, invocação de edge) gera exatamente uma linha. Escrita centralizada pela RPC `log_event` (validação de `actor_type`) e por triggers genéricos de auditoria. Suporta encadeamento causal via `parent_event_id` (auto-FK) e correlação via `correlation_id`. Retenção planejada de 90 dias hot + arquivo S3 (COMMENT da tabela; particionamento ainda não implementado).

## Colunas
`origem`: writers identificados no corpus = `log_event` (RPC central), `trg_log_event_changes` (trigger genérico), `motor_v2_invoke_edge`, `trg_motor_v2_bloqueio_cliente`, `trg_motor_v2_recalc_gate_from_health` — todos com `confidence: confirmado` em `functions-analysis.json` (lista literal de colunas no INSERT).

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NÃO | `nextval('event_log_id_seq')` | sequence (PK) | auto-referência `event_log.parent_event_id` (FK `event_log_parent_event_id_fkey`); retornado por `log_event` (RETURNING id) | confirmado (FK + RETURNING em `functions-analysis`) |
| 2 | occurred_at | timestamptz | NÃO | `now()` | default `now()` | chave de ordenação de 7 índices (`idx_event_log_*` com `occurred_at DESC`) | confirmado (default + bloco-04) |
| 3 | actor_type | text | NÃO | — | `log_event` valida `IN (HUMAN/AUTOMATION/SYSTEM/EXTERNAL)`; triggers passam literal | leitura out-of-band (índice `idx_event_log_actor`) | confirmado (notes de `log_event`) |
| 4 | actor_id | text | NÃO | — | writers acima; trigger lê de GUC `app.actor_id` (não de tabela) | índice `idx_event_log_actor` | confirmado (writers literais) |
| 5 | actor_name | text | SIM | — | writers; trigger lê GUC `app.actor_name` | sem consumidor identificado (display) | confirmado (write) / inferido (leitura) |
| 6 | actor_url | text | SIM | — | `log_event`, `trg_log_event_changes` (GUC `app.actor_url`) | sem consumidor identificado | confirmado (write) |
| 7 | event_type | text | NÃO | — | todos os writers (literal) | índice `idx_event_log_event_type` | confirmado |
| 8 | entity_type | text | SIM | — | `log_event`, `trg_log_event_changes`, `trg_motor_v2_bloqueio_cliente` | índice `idx_event_log_entity` | confirmado |
| 9 | entity_id | text | SIM | — | mesmos writers de entity_type | índice `idx_event_log_entity` | confirmado |
| 10 | source_system | text | NÃO | — | todos os writers | índice `idx_event_log_source` | confirmado |
| 11 | source_detail | text | SIM | — | writers; trigger lê GUC `app.source_detail` | sem consumidor identificado | confirmado (write) |
| 12 | correlation_id | text | SIM | — | `log_event` (parâmetro) | índice parcial `idx_event_log_correl` (WHERE correlation_id NOT NULL) | confirmado (write) / inferido (leitura) |
| 13 | parent_event_id | bigint | SIM | — | `log_event` (parâmetro) | auto-FK para `event_log.id` (encadeamento causal) | confirmado (FK `event_log_parent_event_id_fkey`) |
| 14 | unit_id | uuid | SIM | — | `log_event`, `trg_log_event_changes`, `motor_v2_invoke_edge` ausente, `trg_motor_v2_bloqueio_cliente`, `trg_motor_v2_recalc_gate_from_health` | índice parcial `idx_event_log_unit` (WHERE NOT NULL) | confirmado (write) |
| 15 | cliente_id | bigint | SIM | — | `log_event`, `trg_motor_v2_bloqueio_cliente` | índice parcial `idx_event_log_cliente` (WHERE NOT NULL) | confirmado (write) |
| 16 | before_data | jsonb | SIM | — | `log_event`; `trg_log_event_changes` grava `to_jsonb(OLD)` | forense/dashboard (out-of-band) | confirmado (write) |
| 17 | after_data | jsonb | SIM | — | `log_event`; `trg_log_event_changes` grava `to_jsonb(NEW)` | forense/dashboard | confirmado (write) |
| 18 | metadata | jsonb | SIM | — | `log_event`, `motor_v2_invoke_edge`, `trg_motor_v2_bloqueio_cliente`, `trg_motor_v2_recalc_gate_from_health` | forense/dashboard | confirmado (write) |
| 19 | ip_address | inet | SIM | — | **nenhum writer no corpus analisado** (não está na lista das 16 colunas de `log_event` nem dos triggers); provavelmente preenchido pela app/edge quando há contexto HTTP humano, ou desconhecida | sem consumidor identificado | inferido |
| 20 | user_agent | text | SIM | — | **nenhum writer no corpus** (idem ip_address) — origem desconhecida / app | sem consumidor identificado | inferido |
| 21 | request_id | text | SIM | — | **nenhum writer no corpus** (idem) — origem desconhecida / app HTTP | sem consumidor identificado | inferido |

## Relacionamentos (FKs)
- `event_log_parent_event_id_fkey`: `parent_event_id → event_log.id` (auto-referência; `ON DELETE n` = NO ACTION/SET NULL conforme bloco — encadeamento causal de eventos). `bloco-03`.
- Não há FK em `unit_id`/`cliente_id` (são "soft references" texto/bigint sem constraint — coerente com tabela de log desacoplada).

## Índices
Total ≈12,5 MB em índices sobre 36 MB de heap (`bloco-04`).

| índice | uso (idx_scan) | bytes | nota |
|--------|----------------|-------|------|
| event_log_pkey | 1 | 974.848 | PK |
| idx_event_log_actor | 0 | 1.744.896 | (actor_type, actor_id, occurred_at DESC) |
| idx_event_log_cliente | 0 | 40.960 | parcial WHERE cliente_id NOT NULL |
| idx_event_log_correl | 0 | 16.384 | parcial WHERE correlation_id NOT NULL |
| idx_event_log_entity | 0 | 4.464.640 | (entity_type, entity_id, occurred_at DESC) — maior índice |
| idx_event_log_event_type | 0 | 1.982.464 | (event_type, occurred_at DESC) |
| idx_event_log_occurred | 0 | 1.032.192 | (occurred_at DESC) |
| idx_event_log_source | 0 | 1.646.592 | (source_system, occurred_at DESC) |
| idx_event_log_unit | 0 | 1.630.208 | parcial WHERE unit_id NOT NULL |

### Índices nunca usados (idx_scan=0)
Soma do desperdício aparente: **≈12.558.336 bytes (~11,98 MB)** em 8 índices não escaneados na janela.

**ATENÇÃO — evidência fraca:** o snapshot de `pg_stat` cobre apenas ~13h e estes são índices **forenses/de auditoria** — consultados sob demanda (investigação, dashboards, exportação de retenção), não em hot path. `idx_scan=0` aqui NÃO autoriza drop; é apenas sinal de que a janela não capturou uso. Decisão de drop exige observação de janela longa. (Contraste com `blacklist_global` abaixo, onde há duplicata real.)

## Triggers
Nenhum trigger **nesta** tabela (`bloco-06` não lista trigger em `event_log`). Coerente com append-only: a tabela é destino de auditoria, não auditada. (O `trg_log_event_changes` é o handler genérico chamado por triggers de **outras** tabelas — ex. `fila_humana` — que escrevem aqui.)

## RLS / Policies
- `rls_on = true`, `rls_forced = false`, **`n_policies = 0`** (`bloco-01`; `bloco-09` retornou vazio).
- Efeito real: **default-deny** para qualquer role sem BYPASSRLS. Só é alcançável via `service_role` (edge functions) ou funções `SECURITY DEFINER` (`log_event`, triggers `secdef=true`). Roles `authenticated`/`anon` via PostgREST não leem nem escrevem.
- **Contradição doc↔banco:** `docs/analise-banco.md` lista `event_log` em "tabelas expostas sem RLS efetiva / sem proteção de linha". Isso está **invertido** para esta tabela: `rls_on=true`+0 policies é o oposto de exposto — é o estado mais travado possível (ninguém lê exceto bypass). O alerta de exposição cabe a `adimplentes_import_log` (`rls_on=false`), não aqui.

## Quem escreve / Quem lê
**Escrita (5 writers confirmados, `functions-analysis.json`):**
- `log_event` (RPC central, secdef) — 16 colunas; valida `actor_type`; `RETURNING id`. É a porta canônica.
- `trg_log_event_changes` (trigger genérico, secdef) — grava before/after via `to_jsonb(OLD/NEW)` e actor via GUCs de sessão `app.*`. Acionado por triggers de outras tabelas (ex. `trg_event_log_fila_humana`).
- `motor_v2_invoke_edge` (secdef) — registra invocação de edge (7 colunas, actor SYSTEM).
- `trg_motor_v2_bloqueio_cliente` (secdef) — registra bloqueio de cliente.
- `trg_motor_v2_recalc_gate_from_health` (secdef) — registra recálculo de gate.
- Edge functions `motor-v2-planejador`, `motor-v2-sortear-relacionamento`, `motor-v2-fechamento` chamam `log_event` via RPC (`edge-functions.json`).

**Leitura:** nenhum reader programático no corpus (funções/edge/n8n/views). Auto-FK `parent_event_id` referencia `id`. `pg_stat` (~13h) não capturou SELECTs nesta tabela. Consumo é **out-of-band**: dashboards de forense/auditoria, exportação de retenção. **Não é tabela morta** — é destino de log de altíssima escrita (30.890 inserts na janela) lido sob demanda.

## Observações
- **`sem_consumidor` = 21** (regra estrita: nenhuma coluna tem reader programático identificado no corpus; só `id` participa de FK e `occurred_at`/colunas indexadas servem índices). Esperado para tabela de auditoria — lida por humanos/dashboards, não por código mapeado. Não confundir com inutilidade.
- 3 colunas sem writer no corpus (`ip_address`, `user_agent`, `request_id`) — campos de contexto HTTP humano; provavelmente preenchidos pela app Next.js/edge quando há requisição de usuário, fora das funções SQL analisadas. Origem honesta: desconhecida no corpus.
- Sem colunas com espaço no nome.
- **Antipattern leve:** 8 índices sem uso na janela criam custo de escrita em tabela de altíssimo INSERT (~31k/janela). Se a maioria nunca for usada em janela longa, são write-amplification pura. Reavaliar após observação estendida (não dropar com base em 13h).
- Particionamento por tempo (mencionado no COMMENT para retenção 90d + S3) **não está implementado** — a 42k linhas e 49 MB ainda não dói, mas crescerá monotonicamente sem isso.
