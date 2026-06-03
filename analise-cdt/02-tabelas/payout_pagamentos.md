# payout_pagamentos

## Identificação
- **Nome**: `public.payout_pagamentos`
- **Dono provável**: Cobrança (ecossistema n8n/pagamentos). Ausente das migrations CHAT-CDT e do código local.
- **Linhas estimadas**: indeterminado (`linhas_estimadas=-1` = nunca analisada; `n_live_tup=0`, `n_tup_ins=0` na janela). Tabela de junção, sem dados materializados ainda (espelha `payouts` que está com heap vazio).
- **Tamanho**: 24 kB total / 0 bytes heap. Só índices; heap vazio.
- **Classificação**: **Cobrança** (junção payout↔charge).
- **Bloat**: n/a (heap vazio).

## Finalidade
Tabela de **junção (N:N degenerada)** que detalha **quais pagamentos PIX compõem cada payout**. Quando um payout Abacate vira `COMPLETE`, a RPC `link_payout_charges(p_payout_id)` insere aqui uma linha por charge da unidade dentro da janela [payout anterior → payout atual], com valor bruto e a taxa fixa de 80 centavos por charge. Serve para reconciliar o repasse recebido com os pagamentos que o originaram (conferência de saldo).

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | payout_id | uuid | NO | — (FK→payouts.id) | `link_payout_charges` (insert; do `p_payout_id`) | PK composta; FK; sem reader programático além de conferência app-side | confirmado (functions-analysis write `payout_id`) |
| 2 | pagamento_id | bigint | NO | — (FK→pagamentos.id) | `link_payout_charges` (insert; `pagamentos.id` da CTE candidatos) | PK composta; índices `idx_..._pagamento` e `..._pagamento_unique` (arbiter ON CONFLICT) | confirmado (functions-analysis write) |
| 3 | valor_bruto_cents | bigint | NO | — | `link_payout_charges` (insert; de `pagamentos.valor`) | sem consumidor de leitura identificado (conferência app-side) | confirmado (functions-analysis write) |
| 4 | valor_taxa_cents | bigint | NO | `0` | `link_payout_charges` (insert; **constante 80** — taxa fixa por charge) | sem consumidor de leitura identificado | confirmado (functions-analysis notes: "taxa fixa de 80 centavos") |
| 5 | created_at | timestamptz | NO | `now()` | default | sem consumidor de leitura identificado | inferido |

**Colunas com espaço no nome**: nenhuma.

## Relacionamentos (FKs)
- `payout_pagamentos.payout_id` → `payouts.id` (`on_delete=c` **CASCADE**). Apagar o payout remove seus vínculos. (bloco-03)
- `payout_pagamentos.pagamento_id` → `pagamentos.id` (`on_delete=r` **RESTRICT**). Não permite apagar um pagamento que já está num repasse. (bloco-03)
- PK composta `(payout_id, pagamento_id)`.

## Índices
(bloco-04)

| índice | def | unique | idx_scan | bytes | papel |
|--------|-----|--------|----------|-------|-------|
| `payout_pagamentos_pkey` | (payout_id, pagamento_id) | sim/PK | 0 | 8 kB | estrutural (PK composta) |
| `payout_pagamentos_pagamento_unique` | (pagamento_id) | sim | 0 | 8 kB | **arbiter de `ON CONFLICT(pagamento_id) DO NOTHING`** em `link_payout_charges` — garante que cada charge entra em no máximo um payout; idx_scan=0 não é desperdício |
| `idx_payout_pagamentos_pagamento` | (pagamento_id) | não | 0 | 8 kB | **REDUNDANTE** — duplica exatamente a coluna do `_pagamento_unique` (unique já serve toda busca por `pagamento_id`) |

### Índices nunca usados (idx_scan=0)
Todos os 3 com `idx_scan=0` (tabela ainda sem volume / RPC não rodou na janela). Avaliação:
- `payout_pagamentos_pkey` — estrutural, manter.
- `payout_pagamentos_pagamento_unique` — arbiter de idempotência, **essencial**, manter.
- **`idx_payout_pagamentos_pagamento` — genuinamente redundante**: é um btree não-único sobre `(pagamento_id)`, coluna já coberta pelo índice **unique** sobre `(pagamento_id)`. O unique atende qualquer lookup/FK-check que o não-único atenderia.
- **Único desperdício reclamável do conjunto das 5 tabelas: ~8 kB** (este índice duplicado). Recomendação: `DROP INDEX idx_payout_pagamentos_pagamento`.

## Triggers
Nenhuma (bloco-06).

## RLS / Policies
- `rls_on=true`, `rls_forced=false`, 1 policy (bloco-01/09):
  - `Authenticated read payout_pagamentos` — SELECT, role `authenticated`, `qual=true`.
- **Alerta**: leitura ampla (`qual=true`, sem escopo de unidade). Sem policy de INSERT/UPDATE/DELETE → escrita só via `service_role`/RPC `link_payout_charges` (SECURITY DEFINER), o que é correto.

## Quem escreve / Quem lê
- **Escreve**: RPC `link_payout_charges` (SECURITY DEFINER, search_path public) — `INSERT ... SELECT` da CTE de candidatos (join `pagamentos` × `links_pagamentos_gerados` por `correlation_id`) com `ON CONFLICT(pagamento_id) DO NOTHING`. Chamada pela edge `process-payouts` quando um payout vira COMPLETE. (functions-analysis, edge-functions)
- **Lê**: nenhum consumidor programático identificado nas fontes (functions/edge/n8n/views/stat). Leitura provável de conferência via app/Table Editor no outro repo — **sem consumidor identificado**, não "morta".

## Observações
- **Heap vazio (0 bytes)** + `n_tup_ins=0` → espelha o estado de `payouts` (feature de repasse recém-ativada/sem volume).
- **`valor_taxa_cents` é constante 80** no writer (taxa fixa Abacate por charge), não derivada de dado real do gateway — caveat: se a taxa Abacate mudar, este valor fica desatualizado por ser hardcoded na RPC.
- **Índice duplicado** `idx_payout_pagamentos_pagamento` — única limpeza objetiva recomendada (~8 kB).
- **Estatísticas cegas**: `last_analyze`/`last_vacuum`=null, `linhas_estimadas=-1`.
- **Todas as colunas de valor sem reader programático** — a tabela é hoje write-mostly (auditoria de composição do repasse); o consumo de leitura, se existir, está no app do outro repositório.
