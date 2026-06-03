# agents_bak_20260601_precancel

## Identificação

- **Nome:** `public.agents_bak_20260601_precancel`
- **Dono provável:** **n8n / cobrança** (snapshot de `agents` — ver tabela `agents`). Ausente de migrations e de `docs/`.
- **Linhas estimadas:** `linhas_estimadas=-1` (nunca houve ANALYZE; `last_analyze=null`), mas `n_live_tup=14` e `n_tup_ins=14` (bloco-01) → **14 linhas**.
- **Tamanho:** 144 kB total / heap 8192 bytes (1 página). Fonte: bloco-01.
- **Classificação:** **Morta/Backup** — backup datado 2026-06-01, RLS OFF, sufixo `precancel`.
- **Alerta de bloat:** não. 1 página de heap; resto é TOAST de `prompt`. Sem dead tuples (`n_dead_tup=0`).

## Finalidade

Cópia de segurança (CTAS — `CREATE TABLE ... AS SELECT`) da tabela `agents` tirada em 2026-06-01, **antes de um "cancel"** (sufixo `precancel`). Tinha **14 linhas** — uma a mais que as 13 vivas hoje em `agents` e que as 13 de `agents_bak_20260601_prerename`. A sequência de contagens 14 (precancel) → 13 (prerename) → 13 (live) conta a história do dia: um registro foi removido ("cancel") e depois houve um "rename" (provável renomeação de persona). Esta tabela preserva o estado de 14 linhas anterior ao cancelamento.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | name | text | YES | — | CTAS de `agents.name` em 2026-06-01 | **sem consumidor identificado** (nenhum n8n/função/edge/view/stat referencia esta tabela) | **confirmado** que é cópia (CTAS); **inferido** que sem consumidor (ausência total nos blocos de consumo) |
| 2 | prompt | text | YES | — | CTAS de `agents.prompt` | **sem consumidor identificado** | idem |
| 3 | unidade | text | YES | — | CTAS de `agents.unidade` | **sem consumidor identificado** | idem |

**`is_nullable=YES` nas 3 colunas** (na `agents` viva, `name`/`prompt` são NOT NULL) — artefato de `CREATE TABLE AS SELECT`, que copia dados mas **perde constraints** (NOT NULL, PK). Sem gaps de ordinal (pos 1,2,3) → nenhuma coluna droppada.

## Relacionamentos (FKs)

Nenhuma (bloco-03 vazio). CTAS não copia FKs nem PK.

## Índices

Nenhum (bloco-04 não lista índices para esta tabela). Sem PK, sem índice — coerente com backup CTAS bruto.

### Índices nunca usados (idx_scan=0)

Não aplicável (não há índices). Desperdício de índice = 0 MB.

## Triggers

Nenhum (bloco-06 vazio).

## RLS / Policies

- **RLS:** OFF (`rls_on=false`, `n_policies=0`). Backup sem proteção de linha — exposto a qualquer role com acesso ao schema via service_role; baixo risco por ser dado de prompt (não PII), mas é uma surpresa de segurança herdada típica dos backups soltos.

## Quem escreve / Quem lê

- **Escreveu:** o comando CTAS de 2026-06-01 (14 inserts de uma vez; `n_tup_ins=14`, `n_tup_upd=0`, `n_tup_del=0`). Nenhuma escrita desde então.
- **Lê:** ninguém. `seq_scan=0`, `idx_scan=null`. Nenhuma referência em n8n-workflows, functions-analysis, edge-functions, views-analysis ou pg_stat_statements.

## Observações

- **Backup descartável:** snapshot pontual sem consumidor; candidato a `DROP TABLE` após confirmar que a operação de 2026-06-01 ficou estável. Manter só ocupa 144 kB e polui o catálogo.
- **Constraints perdidas:** colunas nuláveis e ausência de PK confirmam origem CTAS (vs. tabela viva NOT NULL).
- **14 vs 13 linhas:** preserva o registro que foi removido no "cancel"; é o único lugar onde esse 14º registro ainda existe.
- **Ausente de `docs/`** (esperado para backup ad-hoc).
