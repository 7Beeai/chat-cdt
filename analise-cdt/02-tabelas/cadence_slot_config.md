# cadence_slot_config

## Identificação
- **Nome:** `public.cadence_slot_config`
- **Dono provável:** n8n / cobrança — **Strategic Swarm F1 / Motor v2** (config-as-data; ausente das migrations do CHAT-CDT).
- **Linhas estimadas:** **17** (real; bloco-01).
- **Tamanho:** 64 kB total, heap 8 kB.
- **Classificação:** **Cobrança** (configuração dos slots de cadência).
- **Bloat:** índices (48 kB) >> heap (8 kB) para 17 linhas — proporção alta mas absoluta trivial. Foco real é índice ocioso (ver abaixo).
- **RLS:** OFF.

## Finalidade
Strategic Swarm F1: **config-as-data dos slots de cadência** (comentário bloco-01). Cada linha mapeia `(fase, dia_ciclo, slot)` → janela horária (`janela_inicio`/`janela_fim`) + padrão `LIKE` da pool de templates (`template_pool_like`) + quantos `envios_no_dia`. O **picker** (`picker_select_batch`) consulta esta tabela para saber quais slots estão abertos no horário atual (`now() AT TIME ZONE 'America/Sao_Paulo'` entre janela_inicio/fim) e qual pool usar.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('cadence_slot_config_id_seq')` | sequence (default) | PK | confirmado (default) |
| 2 | fase | text | NO | — | seed/config | `picker_select_batch` (select), `advance_cadence_state` (select); UNIQUE `(fase,dia_ciclo,slot)` | confirmado (functions-analysis) |
| 3 | dia_ciclo | integer | NO | — | seed/config | `picker_select_batch` + `advance_cadence_state` (select); UNIQUE | confirmado (functions-analysis) |
| 4 | slot | integer | NO | — | seed/config | `picker_select_batch` + `advance_cadence_state` (select); UNIQUE | confirmado (functions-analysis) |
| 5 | janela_inicio | time | NO | — | seed/config | `picker_select_batch` (compara com hora atual BRT) | confirmado (functions-analysis) |
| 6 | janela_fim | time | NO | — | seed/config | `picker_select_batch` (compara com hora atual BRT) | confirmado (functions-analysis) |
| 7 | template_pool_like | text | NO | — | seed/config | `picker_select_batch` (LIKE pattern da pool) | confirmado (functions-analysis) |
| 8 | envios_no_dia | integer | NO | — | seed/config | `advance_cadence_state` (select — quantos envios por dia) | confirmado (functions-analysis) |
| 9 | notes | text | YES | — | seed/config (anotação humana) | **sem consumidor identificado** | inferido (ausência nas fontes) |
| 10 | created_at | timestamptz | NO | `now()` | default | — | confirmado (default) |

## Relacionamentos (FKs)
Nenhuma FK (bloco-03).

## Índices
| índice | unique | idx_scan | bytes | nota |
|--------|--------|----------|-------|------|
| `cadence_slot_config_pkey` (id) | sim | **0** | 16 kB | PK; usado só p/ integridade |
| `cadence_slot_config_fase_dia_ciclo_slot_key` (UNIQUE) | sim | **0** | 16 kB | integridade da chave de negócio |
| `idx_cadence_slot_config_janela` (janela_inicio, janela_fim) | não | **0** | 16 kB | **desperdício real** |

### Índices nunca usados (idx_scan=0)
**Caso limpo de desperdício** (diferente de disparos_log): a tabela FOI exercida — `seq_scan=10513` — e ainda assim **todos os 3 índices têm idx_scan=0**. O planner faz **seq scan** das 17 linhas e os índices não rendem nada. 
- **Os 2 índices UNIQUE** (`pkey`, `fase_dia_ciclo_slot_key`) — manter: garantem integridade mesmo sem servir reads.
- **`idx_cadence_slot_config_janela` (16 kB, não-unique)** — **candidato a DROP**: não impõe integridade e nunca foi usado para leitura; numa tabela de 17 linhas o seq scan sempre vence. **Desperdício removível ≈ 16 kB.**

## Triggers
Nenhum (bloco-06).

## RLS / Policies
RLS **OFF**, 0 policies. Config lida por funções SECURITY DEFINER (service_role).

## Quem escreve / Quem lê
- **Escreve:** seed/config (sem writer dinâmico — `n_tup_*=0`).
- **Lê:** `picker_select_batch` (`fase,dia_ciclo,slot,janela_inicio,janela_fim,template_pool_like`) e `advance_cadence_state` (`fase,dia_ciclo,slot,envios_no_dia`). Citação: functions-analysis.json.

## Observações
- Único índice de leitura ocioso de toda a sua lista que é **defensável como desperdício** (`idx_cadence_slot_config_janela`), porque a tabela foi seq-scaneada 10513× e o índice nunca foi escolhido.
- `notes` (#9) sem consumidor funcional.
- "Strategic Swarm F1" (comentário) e "Motor v2" são nomenclaturas do mesmo domínio de cobrança do n8n — não conflitam.
