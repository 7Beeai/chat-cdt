# log_limpeza_links

## Identificação

- **Nome:** `public.log_limpeza_links`
- **Dono provável:** **n8n / cobrança**. Escrita pela função `limpar_links_pagamento_expirados`, que toca tabelas de cobrança (`clientes_cobranca_setembro`, `clientes_cobranca_dashboard`, `links_pagamentos_gerados`). Ausente das migrations do CHAT-CDT. `docs/03-database.md` lista explicitamente `log_limpeza_links` como tabela do **n8n com RLS OFF** ("surpresa de segurança herdada — flagged mas fora do nosso escopo").
- **Linhas estimadas:** `linhas_estimadas=-1` (sem ANALYZE), mas `n_live_tup=1` e `n_tup_ins=1` (bloco-01) → **exatamente 1 linha** (1 insert bem-sucedido em toda a história).
- **Tamanho:** 32 kB total / heap 8192 bytes. Fonte: bloco-01.
- **Classificação:** **Cobrança** (tabela de telemetria/log do cron de limpeza de links; domínio n8n/cobrança). Não é "Morta" — tem writer ativo e finalidade clara, mas é write-only (sem leitor).
- **Alerta de bloat:** nenhum (1 linha).

## Finalidade

Tabela de auditoria/log do job que limpa links de pagamento mortos. A função `limpar_links_pagamento_expirados` (functions-analysis.json) faz NULL em `link_pagamento`/`correlation_id` de `clientes_cobranca_setembro` e `clientes_cobranca_dashboard` para links cancelados/expirados/pagos (CTE `dead` sobre `links_pagamentos_gerados`) e, ao final, **insere uma linha** aqui registrando quantos registros foram atualizados (`registros_atualizados`) e um detalhe estruturado (`detalhe` jsonb). É puramente observabilidade do cron.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval('log_limpeza_links_id_seq')` | sequence (default) | **sem consumidor de leitura identificado** | **confirmado** (default no bloco-02) |
| 2 | data_execucao | timestamptz | NO | `now()` | default do banco no INSERT | **sem consumidor de leitura identificado** | **confirmado** (default) |
| 3 | registros_atualizados | integer | NO | — | escrito por `limpar_links_pagamento_expirados` (INSERT) | **sem consumidor de leitura identificado** | **confirmado** (functions-analysis: writes[].columns inclui `registros_atualizados`, confidence "confirmado") |
| 4 | detalhe | jsonb | YES | — | escrito por `limpar_links_pagamento_expirados` (INSERT) | **sem consumidor de leitura identificado** | **confirmado** (functions-analysis: writes[].columns inclui `detalhe`, confidence "confirmado") |

Sem gaps de ordinal (pos 1–4 contíguos) → nenhuma coluna droppada. Tabela **write-only**: writer conhecido e confirmado, mas **nenhum leitor** em n8n-workflows, edge-functions, views-analysis ou pg_stat_statements (bloco-10 sem hits).

## Relacionamentos (FKs)

Nenhuma (bloco-03 vazio). Não referencia `links_pagamentos_gerados` nem cobrança por FK — o vínculo é só lógico (a função processa esses dados e registra o agregado aqui).

## Índices

| índice | tipo | idx_scan | bytes | def |
|--------|------|----------|-------|-----|
| log_limpeza_links_pkey | UNIQUE/PRIMARY | 0 | 16384 | `... btree (id)` |

### Índices nunca usados (idx_scan=0)

`log_limpeza_links_pkey` tem `idx_scan=0`. Desperdício: **16384 bytes ≈ 16 kB**. Esperado: a tabela só recebe INSERT (PK servida pela sequence, sem lookup por id) e nunca é consultada. O índice de PK é estrutural; o "desperdício" é nominal enquanto não houver leitura.

## Triggers

Nenhum (bloco-06 vazio).

## RLS / Policies

- **RLS:** OFF (`rls_on=false`, `n_policies=0`). Confirmado e já documentado em `docs/03-database.md` como uma das "7 tabelas do n8n com RLS OFF" — surpresa de segurança herdada, fora do escopo do CHAT-CDT. Como contém apenas contadores/jsonb de log (sem PII de devedor explícita, a depender do conteúdo de `detalhe`), o risco é baixo mas a inconsistência existe.

## Quem escreve / Quem lê

- **Escreve:** função `limpar_links_pagamento_expirados` (INSERT de `registros_atualizados` + `detalhe`; `id`/`data_execucao` por default). Fonte: functions-analysis.json (confidence "confirmado"). `security_definer=false`, `search_path=null`.
- **Lê:** ninguém identificado. `seq_scan=0`, `idx_scan=0`, sem ocorrências em pg_stat_statements. É um log que ninguém consulta programaticamente.

## Observações

- **Contradição com a dica de tarefa ("cron limpeza-links que falha ~48%"):** os dados **não confirmam** falha frequente. `n_tup_ins=1` significa **um único insert bem-sucedido em toda a vida da tabela**. Se o cron rodasse com frequência e falhasse ~48%, ainda assim os ~52% de sucessos teriam gerado muitas linhas — não 1. Hipóteses compatíveis com a evidência: (a) o cron raramente roda / está praticamente desligado; (b) só inseriu 1 vez com sucesso; (c) a função foi recém-criada/ativada na janela; ou (d) falhas ocorrem **antes** do INSERT final (ex.: erro no UPDATE das tabelas de cobrança aborta a transação e o log nunca é gravado — o que explicaria "falha alta" + "quase nenhum log"). A dica deve ser tratada como hipótese a investigar, não fato. (Esta análise é read-only e não tem acesso ao histórico de execuções do cron/n8n para fechar a questão.)
- **Write-only por design:** log sem leitor — útil só para inspeção manual eventual. Considerar painel/alerta que de fato leia `registros_atualizados`/`detalhe`, senão o log não cumpre função de observabilidade.
- **RLS OFF já flagada em docs/** — consistente entre doc e banco; é dívida de segurança herdada do n8n.
