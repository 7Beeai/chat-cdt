# webhook_configs

## Identificação
- **Nome**: `public.webhook_configs`
- **Dono provável**: Cobrança / config (mapeamento unidade → URL de webhook). Não é do CHAT-CDT (sem referência em `migrations/`, `docs/`, sem prefixo `chat_`).
- **Linhas**: **desconhecido** — `linhas_estimadas = -1` (sentinela "nunca ANALYZE'd") e `n_live_tup = 0`, com `last_analyze` null. Diferente de `app_internal_config`, aqui **não há writer nem reader em nenhuma fonte** e `n_tup_ins = 0`, então a leitura mais defensável é "provavelmente vazia / vestigial", mas formalmente: **contagem desconhecida, sem consumidor identificado**. Fonte: bloco-01.
- **Tamanho**: 32 KB total / 8 KB heap. Fonte: bloco-01.
- **Classificação**: **Cobrança (config) — candidata a Morta/vestigial**. Estrutura de config planejada mas sem uso observável.
- **Bloat**: irrelevante.

## Finalidade
Tabela de configuração para mapear, por unidade (`unit_code`) e tipo (`webhook_type`), uma `webhook_url` de destino, com flag `is_active`. Pela forma, destina-se a rotear/configurar webhooks de saída por unidade. Nenhum consumidor a usa de fato nas evidências capturadas — a configuração efetiva dos webhooks parece estar em outro lugar (Edge Functions usam env vars/secrets, não esta tabela).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | PK; sem leitor identificado | inferido (sem uso) |
| 2 | unit_code | text | NO | — | App (esperado) | sem consumidor identificado | inferido (sem leitura/escrita em qualquer fonte) |
| 3 | webhook_type | text | NO | — | App (esperado) | sem consumidor identificado | inferido |
| 4 | webhook_url | text | NO | — | App (esperado) | sem consumidor identificado | inferido |
| 5 | is_active | boolean | YES | `true` | default | sem consumidor identificado | inferido |
| 6 | created_at | timestamptz | NO | `now()` | default | sem consumidor identificado | inferido |
| 7 | updated_at | timestamptz | NO | `now()` | default; mantido pelo trigger `update_webhook_configs_updated_at` | trigger atualiza no UPDATE; sem leitor | confirmado p/ a manutenção (bloco-06); sem leitor |

7 colunas contíguas, sem gaps.

## Relacionamentos (FKs)
Nenhuma FK (bloco-03 sem linhas). `unit_code` é texto solto, sem FK para `units`/`disparadores_whatsapp` — não há integridade referencial de unidade.

## Índices
| índice | def | idx_scan | bytes |
|--------|-----|----------|-------|
| webhook_configs_pkey | UNIQUE btree(id) | **0** | 16 KB |

### Índices nunca usados (idx_scan=0)
- `webhook_configs_pkey` (16 KB) — a própria PK nunca foi usada (`idx_scan=0`), coerente com tabela sem nenhum acesso. Desperdício desprezível (16 KB), mas é mais um sinal de tabela não-utilizada.

## Triggers
- `update_webhook_configs_updated_at` — BEFORE UPDATE, FOR EACH ROW, executa `update_updated_at_column()` (mantém `updated_at = now()`). Genérico de housekeeping; só dispara se houver UPDATE — que nunca ocorreu (`n_tup_upd=0`). Fonte: bloco-06.

## RLS / Policies
RLS **ON** (não forçado). 1 policy:
- `Only admins can manage webhook configs` — PERMISSIVE, roles `public`, cmd `ALL`, `qual = has_role((SELECT auth.uid()), 'admin'::app_role)`. Lockdown coerente: só admins gerenciam. Sem policy de SELECT separada → não-admins não leem nada.

## Quem escreve / Quem lê
- **Escreve**: ninguém nas fontes (edge/functions/n8n/stat). `n_tup_ins = n_tup_upd = n_tup_del = 0`.
- **Lê**: ninguém identificado. `seq_scan=0`, `idx_scan=0`.

## Observações
- **Tabela sem uso observável (vestigial)**: nenhuma linha, nenhum acesso, PK nunca varrida. A presença de trigger de `updated_at` e policy de admin sugere intenção de uso futuro (config de webhooks por unidade gerenciada por admin), mas hoje é estrutura morta.
- **Sobreposição funcional**: a configuração real de webhooks vive em env vars/secrets das Edge Functions (woovi/stripe/abacate) e, para chaves internas, em `app_internal_config`. Esta tabela duplicaria esse papel se algum dia for ligada.
- `unit_code` sem FK — se reativada, validar integridade de unidade.
- Decisão recomendada: confirmar com o time se é roadmap; caso contrário, candidata a drop após validação (mas é da esfera Cobrança/n8n — não tocar sem alinhamento, conforme regra do projeto de não alterar tabelas do n8n).
