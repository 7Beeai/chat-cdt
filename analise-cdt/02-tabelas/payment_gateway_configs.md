# payment_gateway_configs

## Identificação
- **Nome**: `public.payment_gateway_configs`
- **Dono provável**: Cobrança (ecossistema n8n/pagamentos). **Não pertence ao CHAT-CDT** — ausente das migrations locais e do código.
- **Linhas estimadas**: indeterminado (`linhas_estimadas=-1` = nunca analisada; PK `idx_tup_read=52`, unique `idx_tup_read=583` → poucas dezenas de linhas, ~2 por unidade ativa: woovi/stripe/abacate).
- **Tamanho**: 48 kB total / 8 kB heap (`bytes_total=49152`). Sem bloat — tabela de configuração pequena, muito lida.
- **Classificação**: **Cobrança** (config/credenciais).
- **COMMENT da tabela**: *"Credenciais de API dos gateways de pagamento por franquia. Inserir manualmente via Dashboard para cada franquia ativa."* — confirma natureza sensível.

## Finalidade
**Cofre de credenciais de gateway por unidade.** Cada linha guarda a `api_key` (App ID Woovi / Secret Key Stripe `sk_live_...` / Bearer Abacate) usada pelas edge functions para falar com os provedores em nome de cada franquia, além de config de **payout PIX** (chave PIX de saque por unidade). É a fonte de verdade de credenciais — as edge functions resolvem `api_key` por `(unit_id, platform, is_active)` em vez de usar secrets globais do Deno. **Tabela de segurança crítica.**

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | PK | confirmado |
| 2 | unit_id | uuid | NO | — (FK→units.id) | inserção manual (Dashboard, per COMMENT) | **todas** as edges de pagamento (filtro por unidade); índice unique `(unit_id, platform)`; bloco-10b (`WHERE unit_id=$1 AND platform=$2 AND is_active=$3`) | confirmado |
| 3 | platform | text | NO | — | inserção manual | filtro em todas as edges (`woovi`/`stripe`/`abacate`); índice unique | confirmado (COMMENT: 'woovi'\|'stripe'; código adiciona 'abacate') |
| 4 | api_key | text | NO | — | inserção manual | **Bearer/auth** em process-reembolso, cancel-payment-links, generate-payment-link, generate-payment-link-abacate, process-payouts, reconcile-{woovi,stripe,abacate}-pull; bloco-10b (`SELECT api_key WHERE unit_id/platform/is_active`, 579 calls/0,04ms) | confirmado |
| 5 | is_active | boolean | NO | `true` | default | filtro `is_active=true` em todas as edges; índice unique parcial implícito | confirmado |
| 6 | created_at | timestamptz | NO | `now()` | default | sem consumidor de leitura identificado (auditoria) | inferido |
| 7 | updated_at | timestamptz | NO | `now()` | default | sem consumidor de leitura identificado | inferido |
| 8 | payout_pix_key | text | YES | — | inserção manual | `process-payouts` (chave PIX de destino do saque) | confirmado (edge-functions reads `payout_pix_key`) |
| 9 | payout_pix_key_type | text | YES | — | inserção manual | `process-payouts` (tipo da chave PIX) | confirmado (edge-functions reads `payout_pix_key_type`) |
| 10 | payout_enabled | boolean | NO | `false` | default | `process-payouts` (gate por unidade — só faz saque se habilitado) | confirmado (edge-functions reads `payout_enabled`) |
| 11 | api_key_v2 | text | YES | — | inserção manual (Abacate v2) | **sem consumidor identificado nas fontes** — todas as edges analisadas leem `api_key` (v1), nenhuma lê `api_key_v2` | inferido (COMMENT documenta uso v2 list/audit/refund, mas nenhum reader capturado) |

**Colunas com espaço no nome**: nenhuma.

## Relacionamentos (FKs)
- `payment_gateway_configs.unit_id` → `units.id` (`on_delete=a`, `on_update=a`). (bloco-03)

## Índices
(bloco-04)

| índice | def | unique | idx_scan | bytes | papel |
|--------|-----|--------|----------|-------|-------|
| `payment_gateway_configs_pkey` | (id) | sim/PK | 2 | 16 kB | estrutural |
| `payment_gateway_configs_unit_id_platform_key` | (unit_id, platform) | sim | **582** | 16 kB | **hot path** — toda resolução de credencial por unidade+plataforma; índice mais usado do conjunto das 5 tabelas |

### Índices nunca usados (idx_scan=0)
Nenhum. Ambos os índices são usados (582 + 2 scans). **Desperdício: 0 kB.**

## Triggers
Nenhuma (bloco-06 sem entrada). Observação: `updated_at` tem default `now()` mas **não há trigger** de atualização — então `updated_at` só reflete a hora de inserção, salvo UPDATE manual explícito.

## RLS / Policies
- `rls_on=true`, `rls_forced=false`, **`n_policies=0`** (bloco-01).
- **Interpretação correta (contradiz a doc)**: RLS ligada + zero policies = **deny-all** para `authenticated`/`anon`. Apenas `service_role` (edge functions com SERVICE_ROLE_KEY) consegue ler. Para uma **tabela de credenciais isso é o comportamento desejado** — segredo protegido.
- **Contradição com `docs/analise-banco.md` (linha 59)**: a doc lista `payment_gateway_configs` entre "tabelas expostas sem RLS efetiva" (`rls_enabled_no_policy`). Avaliação crítica: **o enquadramento da doc é impreciso para esta tabela** — `rls_enabled_no_policy` aqui significa *fechada para todos exceto service_role*, o **oposto** de "exposta". Não há vazamento de credenciais via RLS.

## Quem escreve / Quem lê
- **Escreve**: inserção/edição **manual via Dashboard** (per COMMENT). Nenhuma função/edge/n8n captura write — confirmado por functions-analysis e n8n-workflows (zero writers).
- **Lê (intenso)**: `process-reembolso`, `cancel-payment-links`, `generate-payment-link`, `generate-payment-link-abacate`, `process-payouts`, `reconcile-woovi-pull`, `reconcile-stripe-pull`, `reconcile-abacate-pull` — todas via `SELECT ... WHERE unit_id=? AND platform=? AND is_active=true` usando SERVICE_ROLE_KEY. Confirmado pelo stat de 579 calls (bloco-10b) e pelos 582 scans do índice unique.

## Observações
- **Tabela mais "quente" do conjunto** (584 idx_scan totais; lida por 8 edges distintas) e ao mesmo tempo a mais sensível (segredos de pagamento de todas as franquias).
- **`api_key_v2` sem consumidor identificado**: o COMMENT diz que serve a endpoints v2 do Abacate (list/audit/refund), mas nenhuma das edges analisadas a lê — ou o consumidor é mais novo que o snapshot de código, ou ainda não foi implementado. Marcar como "sem consumidor identificado nas fontes", **não** "morta".
- **`updated_at` enganoso**: sem trigger de manutenção, não rastreia a última rotação de credencial de forma confiável.
- **Estatísticas cegas**: `last_analyze`/`last_vacuum` = null, `linhas_estimadas=-1`. Recomendável `ANALYZE`.
- **Risco operacional**: credenciais em texto claro (`api_key`, `api_key_v2`) — protegidas só por RLS deny-all + service_role. Sem coluna de criptografia/Vault. Auditar acesso de service_role.
