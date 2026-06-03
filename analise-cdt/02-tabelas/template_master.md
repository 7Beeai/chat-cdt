# template_master

## Identificação
- **Nome**: `public.template_master`
- **Dono provável**: **n8n / Cobrança** (vocabulário de cadência: `fase`, `dia_ciclo`, `slot`, `variante`, `pause_after_submit`). Não é tabela do CHAT-CDT — não aparece em migrations, edge functions nem código do app.
- **Linhas estimadas**: `n_live_tup=0` e `linhas_estimadas=-1`. **Atenção**: `-1` significa **nunca analisada** (`last_analyze`/`last_autoanalyze` ambos null), não necessariamente vazia. Como `seq_scan=0` e `idx_scan=0` (nenhuma leitura sequer tentada) e `n_tup_ins=0`, é plausível que esteja de fato vazia/recém-criada, mas isso não é provável só pelo `-1`.
- **Tamanho**: 104 kB total (heap 40 kB).
- **Classificação**: **Cobrança** (provável config de cadência), com forte característica de **sem consumidor identificado / dormente**. Diverge da dica de contexto ("Compartilhada"): não há nenhum reader/writer em functions-analysis, edge-functions, n8n-workflows, views-analysis nem pg_stat_statements (bloco-10a/b: 0 hits).
- **Alerta de bloat**: irrelevante (tabela vazia/mínima).

## Finalidade
Aparente **catálogo declarativo de templates por posição na cadência**: para cada `template_name`, define categoria, idioma, em que `fase`/`dia_ciclo`/`slot`/`variante` da régua ele se encaixa, os `components` (estrutura Meta), `metadata` e se deve ser pausado após submissão (`pause_after_submit`). A PK ser `template_name` e haver índice `(fase, dia_ciclo, slot)` sugere uso como **seed/source-of-truth para submeter templates à Meta** ou para o motor montar a cadência. **Porém não há consumidor identificado** — pode ser tabela planejada, semente manual ou substituída por `template_inventory` + `cadence_calendar`/`cadence_slot_config`.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | template_name | text | NO | — (PK) | desconhecida (provável seed manual/n8n; sem writer capturado) | **sem consumidor identificado** | inferido (ausência em todos os blocos) |
| 2 | category | text | NO | `'UTILITY'` | desconhecida (default + seed) | **sem consumidor identificado** | inferido |
| 3 | language | text | NO | `'pt_BR'` | desconhecida (default + seed) | **sem consumidor identificado** | inferido |
| 4 | fase | text | NO | — | desconhecida (seed) | **sem consumidor identificado** (indexado em `idx_template_master_fase`, mas idx_scan=0) | inferido |
| 5 | dia_ciclo | integer | NO | — | desconhecida (seed) | **sem consumidor identificado** | inferido |
| 6 | slot | integer | NO | — | desconhecida (seed) | **sem consumidor identificado** | inferido |
| 7 | variante | integer | NO | — | desconhecida (seed) | **sem consumidor identificado** | inferido |
| 8 | components | jsonb | NO | — | desconhecida (seed; estrutura Meta) | **sem consumidor identificado** | inferido |
| 9 | metadata | jsonb | YES | — | desconhecida | **sem consumidor identificado** | inferido |
| 10 | pause_after_submit | boolean | NO | `false` | desconhecida (default + seed) | **sem consumidor identificado** | inferido |
| 11 | created_at | timestamptz | NO | `now()` | default | **sem consumidor identificado** | inferido |
| 12 | updated_at | timestamptz | NO | `now()` | default | **sem consumidor identificado** | inferido |

Sem gaps de ordinal (1..12 contíguos). Nenhuma coluna com espaço no nome.

## Relacionamentos (FKs)
Nenhuma FK de ou para esta tabela (bloco-03). PK = `template_name`. Acoplamento apenas potencial (por valor) com `template_inventory.template_name` e com as tabelas de cadência (`cadence_calendar`/`cadence_slot_config` usam `fase`/`dia_ciclo`/`slot`), mas não há FK declarada nem consumidor que faça o join.

## Índices
| índice | tipo | idx_scan | bytes | nota |
|--------|------|----------|-------|------|
| `template_master_pkey` | UNIQUE/PK (template_name) | **0** | 16.384 | NUNCA USADO (tabela sem leituras) |
| `idx_template_master_fase` | btree (fase, dia_ciclo, slot) | **0** | 16.384 | NUNCA USADO |

### Índices nunca usados (idx_scan=0)
- `template_master_pkey` — 16.384 bytes
- `idx_template_master_fase` — 16.384 bytes
- **Desperdício somado: 32.768 bytes (~32 kB).** Ambos com scan=0, consistente com a tabela estar dormente. (O PK é estrutural; o desperdício "real" removível é o `idx_template_master_fase`.)

## Triggers
Nenhum (bloco-06 vazio). `updated_at` não tem trigger de manutenção — dependeria do writer setá-lo.

## RLS / Policies
- **RLS DESABILITADO** (`rls_on=false`, `n_policies=0`). **Flag**: tabela sem RLS num banco compartilhado com produção. Como está vazia e sem consumidor, o risco prático hoje é baixo, mas se vier a receber dados (config de cadência) e for exposta via PostgREST, qualquer chave anônima/autenticada leria tudo. Recomenda-se habilitar RLS antes de popular/expor.

## Quem escreve / Quem lê
- **Escreve**: nenhum writer identificado em functions-analysis, edge-functions, n8n-workflows ou pg_stat_statements. Origem dos dados (se houver) = seed manual/sync não capturado.
- **Lê**: nenhum reader identificado (0 hits em bloco-10a/b; ausente de funções/views/edge/n8n). `seq_scan=0` e `idx_scan=0` confirmam: na janela do snapshot, **a tabela não foi tocada por nenhuma query**.

## Observações
- **Tabela dormente / sem consumidor identificado**, não "morta": o esquema é coerente e específico (catálogo de templates por posição de cadência), sugerindo intenção de uso (seed para submissão à Meta ou planejamento de cadência). Pode ter sido superada por `template_inventory` (estado real dos templates) combinado com `cadence_calendar`/`cadence_slot_config` (posicionamento).
- **RLS OFF** num projeto compartilhado é o principal alerta de governança.
- **`linhas_estimadas=-1`** = nunca analisada; não tratar como prova de vazio. Recomendar `ANALYZE` para ter contagem real antes de decidir descartar.
- Diverge da dica "Compartilhada / chat lê": **não há leitura do CHAT-CDT nem de ninguém** nesta janela.
