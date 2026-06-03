# chat_config

## Identificação
- **Nome**: `public.chat_config`
- **Dono provável**: CHAT-CDT (prefixo `chat_`; criada em `migrations/0003_config_table.sql`, aplicada via MCP como `chat_cdt_config_table`).
- **Linhas estimadas**: **2 linhas esperadas** (`app_origin`, `cron_secret`). `n_live_tup=0` / `linhas_estimadas=-1` / `last_analyze=null` — estatísticas de ANALYZE ausentes; **não é vazia** (pkey teve idx_scan=345, idx_tup_read=348 → as chaves estão sendo lidas).
- **Tamanho**: 32 kB total (heap 8 kB).
- **Classificação**: **CHAT-CDT** (key-value de configuração para o push fanout).
- **Bloat**: nenhum.

## Finalidade
Tabela key-value que substitui os GUCs `app.app_origin` / `app.cron_secret` (o Supabase Cloud bloqueia `ALTER DATABASE ... SET`, mesmo para `postgres`). Guarda a origem da app (`app_origin`) e o segredo de cron (`cron_secret`) que o trigger `chat_notify_handoff` usa para chamar `/api/internal/push/notify` via `net.http_post`.

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | key | text | NO | — (PK) | insert manual pós-migration (`'app_origin'`, `'cron_secret'`) | **lido por `chat_notify_handoff`**: `where key = 'app_origin'` / `'cron_secret'`; PK `chat_config_pkey` (idx_scan=345) | confirmado (`functions-analysis` read `[value,key]`; def da função) |
| 2 | value | text | NO | — | insert manual (URL da app; segredo cron) | **lido por `chat_notify_handoff`** (`select value into origin/secret`) | confirmado (def da função 0003) |
| 3 | updated_at | timestamptz | NO | `now()` | default / `do update set updated_at=now()` no upsert | sem consumidor identificado | confirmado (origem) |

`pos` 1..3 contínuos — **nenhuma coluna droppada**. **Nenhuma coluna com espaço.**

## Relacionamentos (FKs)
Nenhuma FK. Tabela isolada.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| `chat_config_pkey` | `unique(key)` | 345 | 16 kB |

### Índices nunca usados (idx_scan=0)
Nenhum. O único índice (PK) é quente. **0 kB desperdiçados.**

## Triggers
Nenhum (bloco-06 vazio).

## RLS / Policies
- RLS **ON**. 1 policy, **sem sobreposição**.
- `chat_config_deny_all` (ALL, public): `using (false) with check (false)`. **Deny-all** — anon/authenticated não tocam. `EXECUTE` revogado e grants só para `service_role` (0003). O acesso real é via `chat_notify_handoff` (`SECURITY DEFINER`, bypassa RLS).

## Quem escreve / Quem lê
- **Escreve**: insert/upsert **manual** pós-migration (documentado em 0003: `insert ... values ('app_origin', ...), ('cron_secret', ...) on conflict do update`). Carrega secret → não vai pelo repositório. Nenhum writer automatizado.
- **Lê**: única leitura é `chat_notify_handoff()` (`functions-analysis`: read `chat_config`, columns `[value, key]`, `confidence:confirmado`; def em 0003 e `bloco-05b`). 345 idx_scans no pkey = uma leitura por handoff `→queued` (2 SELECTs por disparo: origin + secret).
- Não aparece em app/lib, edge, n8n, views nem em stat 10a/10b (acesso é interno ao trigger).

## Observações
- **Contradição doc↔banco (rule 5)**: `CLAUDE.md` ainda afirma *"Push fanout depende de 2 GUCs no banco: `app.app_origin` e `app.cron_secret`. Sem eles, `chat_notify_handoff` é no-op."* — **isso está desatualizado**. A migration 0003 **substituiu explicitamente** o mecanismo de GUC pela tabela `chat_config` ("Supabase Cloud bloqueia `ALTER DATABASE ... SET`"). O trigger hoje lê de `chat_config`, não de `current_setting('app.*')`. Atualizar o CLAUDE.md / docs.
- `updated_at` existe para auditoria de rotação do secret mas não tem leitor — `sem consumidor identificado`.
- Segurança correta: deny-all + EXECUTE revogado + grants só `service_role`. Valor sensível (`cron_secret`) protegido.
