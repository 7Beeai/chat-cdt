# app_internal_config

## Identificação
- **Nome**: `public.app_internal_config`
- **Dono provável**: Cobrança / infra de Edge Functions (chaves internas usadas pelo fluxo de pagamentos/órfãos). Não é do CHAT-CDT (sem referência em `migrations/`, `docs/`, nem `chat_` prefix).
- **Linhas**: **desconhecido** — `linhas_estimadas = -1` e `n_live_tup = 0` com `last_analyze`/`last_autoanalyze` = null. Isso é o **sentinela do Postgres "nunca foi ANALYZE'd" (reltuples = -1)**, não um zero medido. Por inferência funcional a tabela **está populada**: contém ao menos a chave `NOTIFY_ORPHAN_INTERNAL_KEY`, lida por duas funções vivas (`call_reconcile_function`, `notify_orphan_payment_created`) — se estivesse vazia, esses caminhos seriam no-ops permanentes. Fonte: bloco-01 + functions-analysis.
- **Tamanho**: 32 KB total / 8 KB heap. Fonte: bloco-01.
- **Classificação**: **Cobrança** (config/secret store de chaves internas).
- **Bloat**: irrelevante (tabela mínima).

## Finalidade
Key-value store de configuração interna da aplicação. Guarda segredos/chaves usados por funções `SECURITY DEFINER` para autenticar chamadas HTTP (via pg_net) às Edge Functions internas — notadamente `NOTIFY_ORPHAN_INTERNAL_KEY`, usada no header `x-internal-key` para disparar `notify-orphan-email` e as funções de reconciliação. Mantém o segredo dentro do banco (acessível só a service_role/secdef) em vez de hardcoded.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | key | text | NO | — | App/seed (inserido fora do escopo capturado; ex.: `NOTIFY_ORPHAN_INTERNAL_KEY`) | `call_reconcile_function` (`WHERE key=...`), `notify_orphan_payment_created` (`WHERE key=...`) — ambas SECURITY DEFINER | confirmado (functions-analysis, reads columns=[value,key]) |
| 2 | value | text | NO | — | App/seed | mesmas duas funções leem `value` da chave | confirmado (functions-analysis) |
| 3 | updated_at | timestamptz | NO | `now()` | default | sem consumidor identificado (nenhum leitor de `updated_at`) | inferido (sem leitura em nenhuma fonte) |

PK em `key` (`app_internal_config_pkey`). 3 colunas contíguas, sem gaps.

## Relacionamentos (FKs)
Nenhuma FK (bloco-03 sem linhas). Padrão para um KV store.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| app_internal_config_pkey | UNIQUE btree(key) | 3 | 16 KB |

### Índices nunca usados (idx_scan=0)
Nenhum. A PK foi usada (idx_scan=3), consistente com os lookups por `key` das duas funções.

## Triggers
Nenhum trigger (bloco-06 sem linhas). Note que `updated_at` **não** tem trigger de manutenção (diferente de `webhook_configs`), então só é atualizado se a aplicação setar explicitamente.

## RLS / Policies
RLS **ON** (não forçado), **0 policies**. Postura coerente de lockdown: deny-all para `anon`/`authenticated`; só alcançável por `service_role` ou pelas funções `SECURITY DEFINER` que a leem. Adequado para um cofre de segredos. (Contraste com `data_freshness_log`, que está com RLS OFF.)

## Quem escreve / Quem lê
- **Escreve**: nenhum writer aparece em edge-functions/functions-analysis/n8n/stat dentro da janela. Seed/inserção manual via console/migration fora do escopo capturado (inferido pela necessidade funcional da chave existir).
- **Lê**: `call_reconcile_function` (lê `NOTIFY_ORPHAN_INTERNAL_KEY`; se null → RAISE WARNING + retorna NULL) e `notify_orphan_payment_created` (mesma chave para header `x-internal-key`). Ambas `confirmado` em functions-analysis.

## Observações
- **Não está vazia** apesar de `n_live_tup=0`: o valor 0 vem de a tabela nunca ter sido analisada (sentinela `-1` em reltuples). Tratar contagem como "desconhecida".
- `updated_at` sem trigger e sem leitor → coluna de telemetria sem consumidor; só teria valor se a aplicação a escrevesse no upsert.
- Cofre de segredos no banco: revisar se o segredo deveria estar em Supabase Vault / secret manager em vez de tabela texto-plano (mesmo com RLS deny-all, service_role lê em claro).
