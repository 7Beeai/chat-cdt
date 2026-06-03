# cadence_calendar

## Identificação
- **Nome:** `public.cadence_calendar`
- **Dono provável:** n8n / cobrança — **Motor v2** (config-as-data; ausente das migrations do CHAT-CDT).
- **Linhas estimadas:** **262** (real; bloco-01). É a matriz `régua × dia_ciclo × slot`.
- **Tamanho:** 192 kB total, heap 64 kB.
- **Classificação:** **Cobrança** (tabela de configuração / encoding da planilha de estratégia).
- **Bloat:** ~750 B/linha — alto p/ 262 linhas, mas vem dos índices (192 kB total vs 64 kB heap). Não é dead-tuple bloat (`n_dead_tup=0`). Sem alerta real.
- **RLS:** OFF (config pública de leitura para o motor).

## Finalidade
Motor v2: **encoding da planilha "Estratégia CDT – Junho 2026"** (comentário bloco-01). Para cada combinação `(régua, dia_ciclo, slot_index)` define a ação a executar (`action_type`), sua `intensity` e a tag da pool de templates. É lida em massa pelo planejador para montar o plano diário. Seed declarado "em arquivo 002" pelo comentário (ver Observações — não está nas migrations do CHAT-CDT).

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('cadence_calendar_id_seq')` | sequence (default) | PK | confirmado (default) |
| 2 | regua | text | NO | — | seed/config (planilha) | edge `motor-v2-planejador` (select), `motor_v2_get_disparos` (select); UNIQUE `(regua,dia_ciclo,slot_index)`; `idx_..._regua_dia` | confirmado (edge + functions-analysis) |
| 3 | dia_ciclo | integer | NO | — | seed/config | mesmos consumidores; UNIQUE + `idx_..._regua_dia` | confirmado (edge + functions-analysis) |
| 4 | slot_index | integer | NO | — | seed/config | planejador (select); UNIQUE | confirmado (edge) |
| 5 | action_type | text | NO | — | seed/config | planejador (select); `motor_v2_get_disparos` filtra `action_type != PAUSA/NONE` | confirmado (functions-analysis: notes explícitas) |
| 6 | intensity | text | YES | — | seed/config | edge planejador (select) → copia p/ `disparos_log.intensity` | confirmado (edge cols) |
| 7 | template_pool_tag | text | YES | — | seed/config | edge planejador (select) → `disparos_log.template_pool_tag` | confirmado (edge cols) |
| 8 | notes | text | YES | — | seed/config (anotação humana) | **sem consumidor identificado** (não lida por nenhum writer/edge/função) | inferido (ausência em todas as fontes) |
| 9 | created_at | timestamptz | NO | `now()` | default | — | confirmado (default) |

## Relacionamentos (FKs)
- Nenhuma FK declarada (bloco-03). `regua`/`dia_ciclo`/`slot_index` casam logicamente com `disparos_log` e `cadence_slot_config` mas sem constraint física.

## Índices
| índice | unique | idx_scan | bytes | nota |
|--------|--------|----------|-------|------|
| `cadence_calendar_regua_dia_ciclo_slot_index_key` (UNIQUE) | sim | **6483** | 40 kB | **quente** — lookup por chave de negócio |
| `idx_cadence_calendar_regua_dia` | não | 14 | 16 kB | usado (scan por régua+dia) |
| `cadence_calendar_pkey` (id) | sim | 3 | 32 kB | PK; pouco usado mas integridade |

### Índices nunca usados (idx_scan=0)
Nenhum. Todos os três índices têm uso. **Desperdício = 0 MB.**

## Triggers
Nenhum (bloco-06).

## RLS / Policies
RLS **OFF**, 0 policies. Config-as-data lida pelo motor (service_role) — sem necessidade de RLS.

## Quem escreve / Quem lê
- **Escreve:** seed/migration de configuração (planilha de estratégia). Sem writer dinâmico em runtime (`n_tup_ins/upd/del = 0`).
- **Lê:** edge `motor-v2-planejador` (select de `regua,dia_ciclo,slot_index,action_type,intensity,template_pool_tag`); função `motor_v2_get_disparos` (select de `regua,dia_ciclo,slot_index,action_type`, filtrando `!= PAUSA/NONE`). Citação: edge-functions.json + functions-analysis.json.

## Observações
- **Contradição doc↔banco a verificar:** comentário diz "Seed em arquivo 002", mas as migrations `0001`–`0013` do CHAT-CDT **não contêm** `cadence_calendar` (grep negativo nas migrations). O "002" refere-se ao versionamento **do projeto Motor v2 / n8n**, não às migrations do CHAT-CDT. Tratar como tabela de outro repositório.
- Coluna `notes` (#8) sem consumidor funcional — documentação humana apenas.
- Sem espaço em nomes, sem policies duplicadas, sem dead tuples. Tabela de config saudável.
