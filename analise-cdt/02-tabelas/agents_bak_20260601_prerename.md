# agents_bak_20260601_prerename

## Identificação

- **Nome:** `public.agents_bak_20260601_prerename`
- **Dono provável:** **n8n / cobrança** (snapshot de `agents` — ver tabela `agents`). Ausente de migrations e de `docs/`.
- **Linhas estimadas:** `linhas_estimadas=-1` (sem ANALYZE), mas `n_live_tup=13` e `n_tup_ins=13` (bloco-01) → **13 linhas**.
- **Tamanho:** 128 kB total / heap 8192 bytes (1 página). Fonte: bloco-01.
- **Classificação:** **Morta/Backup** — backup datado 2026-06-01, RLS OFF, sufixo `prerename`.
- **Alerta de bloat:** não. 1 página de heap; resto é TOAST de `prompt`. Sem dead tuples (`n_dead_tup=0`).

## Finalidade

Cópia de segurança (CTAS) da tabela `agents` tirada em 2026-06-01, **antes de um "rename"** (sufixo `prerename`). Tinha **13 linhas** — já depois do "cancel" (a `_precancel` tinha 14) e antes da renomeação. A ordem dos eventos do dia: `agents_bak_20260601_precancel` (14 linhas, pré-cancelamento) → remoção de 1 registro → `agents_bak_20260601_prerename` (13 linhas, pré-renomeação) → `agents` viva (13 linhas). Esta tabela preserva o estado nominal anterior ao rename (provável troca de `name` de alguma persona, ex.: ajuste de chave usada nos filtros n8n).

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | name | text | YES | — | CTAS de `agents.name` em 2026-06-01 | **sem consumidor identificado** (nenhum n8n/função/edge/view/stat referencia esta tabela) | **confirmado** que é cópia (CTAS); **inferido** sem consumidor (ausência total nos blocos de consumo) |
| 2 | prompt | text | YES | — | CTAS de `agents.prompt` | **sem consumidor identificado** | idem |
| 3 | unidade | text | YES | — | CTAS de `agents.unidade` | **sem consumidor identificado** | idem |

**`is_nullable=YES` nas 3 colunas** (na `agents` viva, `name`/`prompt` são NOT NULL) — artefato de CTAS (perde NOT NULL e PK). Sem gaps de ordinal (pos 1,2,3) → nenhuma coluna droppada.

## Relacionamentos (FKs)

Nenhuma (bloco-03 vazio).

## Índices

Nenhum (bloco-04 sem entradas para esta tabela). Sem PK/índice — coerente com CTAS.

### Índices nunca usados (idx_scan=0)

Não aplicável (sem índices). Desperdício = 0 MB.

## Triggers

Nenhum (bloco-06 vazio).

## RLS / Policies

- **RLS:** OFF (`rls_on=false`, `n_policies=0`). Backup desprotegido — mesma observação de segurança herdada da `_precancel`.

## Quem escreve / Quem lê

- **Escreveu:** o CTAS de 2026-06-01 (`n_tup_ins=13`, sem updates/deletes). Nenhuma escrita posterior.
- **Lê:** quase ninguém — `seq_scan=1` (1 leitura sequencial pontual, provavelmente a própria inspeção/validação do dia do rename), `idx_scan=null`. Nenhuma referência em n8n-workflows, functions-analysis, edge-functions, views-analysis ou pg_stat_statements → sem consumidor de produção.

## Observações

- **Backup descartável:** snapshot pontual sem consumidor de produção; candidato a `DROP TABLE` junto com `agents_bak_20260601_precancel` após estabilização da operação de 2026-06-01.
- **Constraints perdidas:** colunas nuláveis e sem PK confirmam CTAS.
- **Diferença vs `_precancel`:** 13 linhas (vs 14) — captura o estado já sem o registro cancelado, mas com os nomes antigos antes do rename. Útil só como diff forense do dia.
- **Ausente de `docs/`** (esperado para backup ad-hoc).
