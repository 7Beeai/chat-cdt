# gate_config

## Identificação
- **Nome:** `public.gate_config`
- **Dono provável:** n8n / cobrança — **Motor v2** (políticas do gate; ausente das migrations do CHAT-CDT).
- **Linhas estimadas:** **desconhecida (nunca analisada)** — `linhas_estimadas=-1`, `last_analyze=null`, `n_live_tup=0`. Logicamente ~1 linha por cor de phone health (PK = `health_color`), provavelmente 3–4 (ex.: GREEN/YELLOW/RED).
- **Tamanho:** 32 kB total, heap 8 kB.
- **Classificação:** **Cobrança** (configuração / política).
- **Bloat:** sem dead tuples; trivial.
- **RLS:** OFF.

## Finalidade
Motor v2: **políticas do gate** (comentário bloco-01). Para cada cor de phone health define quais réguas estão ativas (`reguas_ativas`) e qual o multiplicador (`relacionamento_ratio`) do volume de relacionamento sobre inadimplentes contactados no slot 09:00. É a tabela de regra que o `motor_v2_recalc_gate` consulta para produzir `gate_state`.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | health_color | text | NO | — | seed/config (PK) | `motor_v2_recalc_gate` (select — chave de match com a cor calculada); edge `motor-v2-planejador` (select); PK `gate_config_pkey` | confirmado (functions-analysis + edge) |
| 2 | reguas_ativas | text[] | NO | — | seed/config | `motor_v2_recalc_gate` (→ `gate_state.reguas_efetivas`); edge planejador (select) | confirmado (functions-analysis + edge) |
| 3 | relacionamento_ratio | numeric | NO | — | seed/config | `motor_v2_recalc_gate` (→ `gate_state.relacionamento_ratio`); edge planejador (select) | confirmado (functions-analysis + edge) |
| 4 | notes | text | YES | — | seed/config (anotação humana) | **sem consumidor identificado** | inferido (ausência nas fontes) |
| 5 | updated_at | timestamptz | NO | `now()` | default / edição manual da config | **sem consumidor identificado** (não lido por nenhum reader) | inferido |

## Relacionamentos (FKs)
Nenhuma FK (bloco-03). PK é `health_color` (texto) — não há índice em `id` porque a tabela não tem `id`.

## Índices
| índice | unique | idx_scan | bytes | nota |
|--------|--------|----------|-------|------|
| `gate_config_pkey` (health_color) | sim | **2016** | 16 kB | quente — lookup por cor (mesmo nº de scans que gate_state, pareados no recalc) |

### Índices nunca usados (idx_scan=0)
Nenhum. **Desperdício = 0.**

## Triggers
Nenhum (bloco-06).

## RLS / Policies
RLS **OFF**, 0 policies. Lida por funções service_role e edges.

## Quem escreve / Quem lê
- **Escreve:** seed/config; edição manual de política (sem writer dinâmico — `n_tup_*=0`).
- **Lê:** `motor_v2_recalc_gate` (`reguas_ativas,relacionamento_ratio,health_color` — functions-analysis); edge `motor-v2-planejador` (mesmas 3 colunas — edge-functions.json). O `idx_scan=2016` casa exatamente com `gate_state` → ambos lidos no mesmo loop por unidade do recalc/planejador.

## Observações
- `linhas_estimadas=-1` ⇒ desconhecida, não zero (nunca rodou ANALYZE).
- `notes` e `updated_at` sem consumidor de leitura (config estática consumida só pelas 3 colunas de regra).
- Sem espaço em nomes, sem policy duplicada, sem contradição com docs.
