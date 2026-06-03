# links_pagamentos_gerados

## Identificação

- **Nome:** `public.links_pagamentos_gerados`
- **Dono provável:** **n8n / cobrança**. Evidências: (a) DDL não existe nas migrations do CHAT-CDT (`infra/supabase/migrations/` só referencia a tabela em **leitura**, em `0008_debtor_context_enriched.sql` via `chat_debtor_context`); (b) a policy de acesso por unidade usa `user_has_access_to_unit(...)` e **não** o helper `chat_user_has_unit` do CHAT-CDT (bloco-09-policies); (c) escrita/leitura concentrada em edge functions de gateway (Woovi/Stripe/Abacate) e RPCs de cobrança.
- **Classificação:** **Cobrança**.
- **Linhas:** o `reltuples` reporta `linhas_estimadas = 42508`, mas `n_live_tup = 561` (e `n_tup_ins = 570`, `n_tup_del = 0`). A divergência (~75x) vem de a tabela **nunca ter sido analisada/vacuumada** (`last_analyze`, `last_autoanalyze`, `last_vacuum`, `last_autovacuum` todos `NULL` — bloco-01). **Trate ~561 como a contagem real**; o 42508 é estatística obsoleta. (bloco-01-tabelas)
- **Tamanho:** 32 MB total / 17 MB heap (bloco-01).
- **ALERTA DE BLOAT:** 32 MB / 17 MB de heap para ≤561 linhas vivas + **915 linhas mortas (dead > live)** e **zero vacuum/analyze na história da tabela**. bytes/linha viva ≈ 59 KB — altíssimo. Forte sinal de bloat + lacuna de manutenção (autovacuum aparentemente nunca rodou nesta tabela). Recomenda-se `VACUUM (ANALYZE)`.

## Finalidade

Registra cada **link/cobrança de pagamento** gerado para uma matrícula inadimplente (PIX/Woovi via OpenPix, cartão via Stripe, e PIX via Abacate Pay), com a chave de idempotência `correlation_id`. Guarda o link e o PIX copia-e-cola, o valor/régua usados na geração (para detectar mudança), janela de expiração, gateway, contadores de reenvio ("resgate") e o ciclo de vida (`status`/`cancelado_at`). Serve de fonte para: páginas de checkout, reconciliação de webhooks de pagamento, jobs de cancelamento/expiração e o contexto de cobrança exibido no CHAT-CDT.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NO | `nextval(...id_seq)` | sequence (default) | PK; nenhum leitor de negócio específico (joins usam correlation_id) | confirmado (default) |
| 2 | matricula | text | NO | — | `upsert_payment_link` / edge `generate-payment-link*` (PostgREST INSERT) | `chat_debtor_context`, `get_pay_checkout`, `get_open_payment_links`, `buscar_links_resgate*`, `get_phone_pending_debts`, `resolve_orfao_matricula`, `register_payment`, `get_pay_receipt` (functions-analysis) | inferido (nome genérico; mas writer único `upsert_payment_link` escreve literalmente — functions-analysis) |
| 3 | whatsapp | text | YES | — | `upsert_payment_link` (functions-analysis) | `buscar_links_resgate*` (col lida); stat SELECT calls=372 lê `matricula,whatsapp,unit_id,link_pagamento` (bloco-10b) | inferido (nome genérico) |
| 4 | plataforma_pagamento_utilizada | text | YES | — | `upsert_payment_link` (functions-analysis) | `buscar_links_resgate*`, `link_payout_charges` (functions-analysis) | confirmado (escrita/leitura literal por `upsert_payment_link` / `link_payout_charges`) |
| 5 | correlation_id | text | NO | — | `upsert_payment_link` (INSERT, chave do ON CONFLICT) | praticamente todos os leitores: `register_payment`, `get_pay_checkout`, `get_pay_receipt`, `get_open_payment_links`, `buscar_links_resgate*`, `cleanup_expired_links`, `cancel_pending_links_on_payment`, `link_payout_charges`, `resolve_orfao_matricula`, `chat_debtor_context` (via último link) (functions-analysis) | confirmado (chave de idempotência; UNIQUE `..._correlation_id_key`) |
| 6 | link_pagamento | text | YES | — | `upsert_payment_link` (INSERT + DO UPDATE) (functions-analysis) | `chat_debtor_context`, `get_open_payment_links`, `buscar_links_resgate*`, `get_phone_pending_debts`, `limpar_links_pagamento_expirados` (functions-analysis); stat SELECT (bloco-10b) | confirmado (escrita/leitura literal por `upsert_payment_link`) |
| 7 | data_link_gerado | timestamptz | YES | `now()` | default + `upsert_payment_link` (INSERT) | `buscar_links_resgate*` (janela 24h), `get_open_payment_links`, `get_pay_checkout`, `chat_debtor_context`, `get_phone_pending_debts`, índice `idx_links_resgate_pendente` (functions-analysis / bloco-04) | confirmado |
| 8 | unit_id | uuid | YES | — | `upsert_payment_link` (INSERT) | FK→units; `chat_debtor_context`, `get_pay_checkout`, `get_open_payment_links`, `buscar_links_resgate*`, `resolve_orfao_matricula`; policy RLS por unidade; índice `idx_links_unit` (functions-analysis / bloco-09) | inferido (nome genérico; escrita literal por `upsert_payment_link`) |
| 9 | created_at | timestamptz | YES | `now()` | default | `get_open_payment_links`, `get_pay_checkout`, `chat_debtor_context`, `check_data_freshness` (MAX), `get_phone_pending_debts`, edge `reconcile-abacate-pull` (janela N horas) (functions-analysis); stat SELECT por created_at (bloco-10a) | confirmado |
| 10 | updated_at | timestamptz | YES | `now()` | trigger `update_updated_at_column` (BEFORE UPDATE) + `upsert_payment_link` DO UPDATE (bloco-06 / functions-analysis) | **sem consumidor identificado** (nenhuma função/edge/stat SELECT lê `updated_at`; só `SELECT *` poderia tocá-la, não-específico) | inferido |
| 11 | cancelado_at | timestamptz | YES | — | `cancel_pending_links_on_payment` (trigger handler), `register_payment`, edge `cancel-payment-links` (PostgREST UPDATE, stat calls=266) (functions-analysis / bloco-10b) | `buscar_links_resgate*` (filtro `IS NULL`), `get_open_payment_links`, `get_phone_pending_debts`, `limpar_links_pagamento_expirados`, índices parciais `idx_links_resgate_pendente`/`uniq_pending_link_per_matricula` (functions-analysis / bloco-04) | confirmado (COMMENT: "NULL = ativo") |
| 12 | valor | numeric | YES | — | edge `generate-payment-link*` via PostgREST UPDATE (stat calls=400 `expires_at,regua,valor`; calls=161 inclui pix; bloco-10b) | `get_open_payment_links`, `get_pay_checkout`, `chat_debtor_context` (functions-analysis) | inferido (nome genérico; COMMENT: "valor em centavos … detectar mudança de valor") |
| 13 | regua | text | YES | — | edge `generate-payment-link*` via PostgREST UPDATE (stat calls=400/161; bloco-10b) | `get_open_payment_links` (functions-analysis) | inferido (COMMENT: "régua no momento da geração … detectar mudança de régua") |
| 14 | expires_at | timestamptz | YES | `now() + '7 days'` | default + edge `generate-payment-link*` (sobrescreve se o gateway retorna; stat UPDATE calls=400/161; bloco-10b) | `cleanup_expired_links` (filtro `< now`), `get_pay_checkout`, `chat_debtor_context`, `get_phone_pending_debts`, `limpar_links_pagamento_expirados` (functions-analysis) | confirmado (COMMENT documenta a regra dos 7 dias) |
| 15 | pix_copia_cola | text | YES | — | edge Abacate (`generate-payment-link-abacate`) via PostgREST UPDATE (stat calls=161; bloco-10b) | `get_pay_checkout` (aliasado AS brcode), `chat_debtor_context` (functions-analysis) | confirmado (escrita/leitura literal) |
| 16 | resgate_count | integer | NO | `0` | default + job de resgate via PostgREST UPDATE (stat calls=228 `resgate_count,ultimo_resgate_at`; bloco-10b) | `buscar_links_resgate` (param de filtro), `buscar_links_resgate_pendente` (=0), índice `idx_links_resgate_pendente` (functions-analysis / bloco-04) | confirmado |
| 17 | ultimo_resgate_at | timestamptz | YES | — | job de resgate via PostgREST UPDATE (stat calls=228; bloco-10b) | **sem consumidor identificado** (nenhuma função/edge/stat SELECT lê `ultimo_resgate_at`; só `SELECT *`) | inferido |
| 18 | pix_gateway | text | YES | — | edge Abacate via PostgREST UPDATE (stat calls=161; bloco-10b) | `get_pay_checkout`, `get_pay_receipt` (functions-analysis); **policy `anon_select_abacate_only` filtra por `pix_gateway='abacate'`** (bloco-09); índice parcial `idx_lpg_pix_gateway` (NUNCA USADO) | confirmado (escrita/leitura literal) |
| 19 | status | text | NO | `'pending'` | default + `register_payment` (→paid), `cleanup_expired_links` (→expired), `cancel_pending_links_on_payment` (→cancelled), edge via PostgREST UPDATE (stat calls=106 `gateway_charge_id,status`; bloco-10b) | `get_open_payment_links` (filtro pending), `get_pay_checkout`, `chat_debtor_context`; índice `uniq_pending_link_per_matricula` (parcial em status='pending') / `idx_lpg_status` (NUNCA USADO) (functions-analysis / bloco-04) | inferido (nome genérico; writers escrevem literal) |
| 20 | gateway_charge_id | text | YES | — | `upsert_payment_link` (DO UPDATE), edge via PostgREST UPDATE (stat calls=106; bloco-10b) | `register_payment` (resolve via gateway_charge_id/correlation_id) (functions-analysis); índice parcial `idx_links_gateway_charge_id` (NUNCA USADO) | confirmado (escrita/leitura literal por `register_payment`) |

> Ordinais 1–20 contíguos: **nenhuma coluna droppada** (sem gaps). **Nenhum nome de coluna com espaço.**

## Relacionamentos (FKs)

- `links_pagamentos_gerados.unit_id` → `units.id` (`links_pagamentos_gerados_unit_id_fkey`; ON DELETE/UPDATE = `a` = NO ACTION). (bloco-03-fks)
- Sem FK declarada para `matricula`/`correlation_id` — o vínculo com `pagamentos` e `clientes_cobranca_*` é **lógico** (por `correlation_id` e `matricula`+`unit_id`), não referencial. (functions-analysis)

## Índices

| índice | único | idx_scan | bytes | observação |
|--------|-------|----------|-------|-----------|
| `links_pagamentos_gerados_pkey` (id) | sim/PK | 354 | 2.05 MB | PK |
| `links_pagamentos_gerados_correlation_id_key` (correlation_id) | sim | 571 | 3.56 MB | chave de idempotência (ON CONFLICT) |
| `idx_links_correlation` (correlation_id) | não | 2908 | 3.49 MB | **redundante** com o UNIQUE acima (mesma coluna) — candidato a remoção |
| `idx_links_matricula` (matricula) | não | 3634 | 1.63 MB | mais usado |
| `idx_links_unit` (unit_id) | não | 288 | 0.84 MB | RLS/joins por unidade |
| `idx_links_resgate_pendente` (data_link_gerado, resgate_count) WHERE cancelado_at IS NULL | não | 55 | 1.97 MB | jobs de resgate |
| `uniq_pending_link_per_matricula` (unit_id, matricula) WHERE status='pending' AND cancelado_at IS NULL | sim | 173 | 0.60 MB | garante 1 link pendente por matrícula/unidade |
| `idx_links_gateway_charge_id` (gateway_charge_id) WHERE NOT NULL | não | **0** | 0.92 MB | **NUNCA USADO** |
| `idx_lpg_pix_gateway` (pix_gateway) WHERE NOT NULL | não | **0** | 0.15 MB | **NUNCA USADO** |
| `idx_lpg_status` (status) | não | **0** | 0.70 MB | **NUNCA USADO** |

### Índices nunca usados (idx_scan=0)

- `idx_links_gateway_charge_id` — 917504 B
- `idx_lpg_pix_gateway` — 155648 B
- `idx_lpg_status` — 696320 B

**Desperdício somado ≈ 1.69 MB** (1.769.472 bytes). Caveat: a janela do snapshot é ~13h e estes índices podem ser recentes; verifique antes de dropar. Adicionalmente, `idx_links_correlation` é **redundante** com o UNIQUE `..._correlation_id_key` (3.49 MB potencialmente recuperáveis), embora esteja sendo usado (2908 scans) — escolha um dos dois. (bloco-04-indices)

## Triggers

- `update_links_pagamentos_gerados_updated_at` — BEFORE UPDATE FOR EACH ROW → `update_updated_at_column()` (mantém `updated_at`). (bloco-06-triggers)
- **Não há** trigger de DB que cancele links por mudança de régua. O "cancel_links_on_regua" mencionado na dica é, na verdade, a **edge function `cancel-payment-links`** disparada por **Database Webhook em UPDATE de `clientes_cobranca_setembro`** (quando `regua`/`valor_inadimplente` muda) — não um trigger desta tabela. (edge-functions / bloco-06)

## RLS / Policies

RLS habilitada (`rls_on = true`, `rls_forced = false`). Duas policies PERMISSIVE de SELECT (bloco-09):

1. `Acesso por unidade em links_pagamentos_gerados` — roles `public`, SELECT, `USING user_has_access_to_unit(unit_id)`.
2. `anon_select_abacate_only` — role `anon`, SELECT, `USING (pix_gateway = 'abacate')`.

**Flags:**
- **Policies sobrepostas/permissivas:** sendo ambas PERMISSIVE e a #1 alvo de `public` (que inclui `anon`), o filtro efetivo para anônimos é `user_has_access_to_unit(unit_id) OR pix_gateway='abacate'`.
- **Exposição de PII a anônimo:** `anon_select_abacate_only` deixa qualquer usuário **anon** ler linhas com `pix_gateway='abacate'`. A stat SELECT calls=372 (bloco-10b) lê `matricula, whatsapp, unit_id, link_pagamento` — ou seja, telefone e matrícula ficam enumeráveis anonimamente para qualquer cobrança Abacate. É provavelmente intencional (página pública de checkout `get_pay_checkout`), mas vale escrutínio: idealmente o checkout deveria expor só via RPC SECURITY DEFINER por `correlation_id`, não SELECT direto anon na tabela inteira.
- A policy usa `user_has_access_to_unit` (não o `chat_user_has_unit` do CHAT-CDT) — **corrobora a posse n8n/cobrança**.

## Quem escreve / Quem lê

**Escrevem:**
- `upsert_payment_link` (RPC SECURITY DEFINER) — INSERT/UPSERT por `correlation_id`: `correlation_id, matricula, whatsapp, link_pagamento, unit_id, plataforma_pagamento_utilizada, data_link_gerado, gateway_charge_id`; no DO UPDATE: `link_pagamento, gateway_charge_id, updated_at`. Chamado pelas edges `generate-payment-link` e `generate-payment-link-abacate`. (functions-analysis / edge-functions)
- **Edge functions via PostgREST direto** (não só pela RPC): UPDATE de `expires_at, regua, valor` (stat calls=400), `expires_at, pix_copia_cola, pix_gateway, regua, valor` (calls=161), `resgate_count, ultimo_resgate_at` (calls=228), `cancelado_at` (calls=266, edge `cancel-payment-links`), `gateway_charge_id, status` (calls=106). (bloco-10b-stat)
- `register_payment` (RPC, via webhooks Woovi/Stripe/Abacate + `reconcile-abacate-pull`) — UPDATE `status (→paid), updated_at, ...` filtrando por `correlation_id`. (functions-analysis / edge-functions)
- `cleanup_expired_links` (job) — UPDATE `status (→expired)` de pendentes vencidos. (functions-analysis)
- `cancel_pending_links_on_payment` (trigger handler em `clientes_cobranca_*` quando `pagamento_feito` vira true) — UPDATE `cancelado_at, status (→cancelled)`. (functions-analysis)

**Leem:**
- `chat_debtor_context` (CHAT-CDT, RPC do contexto de cobrança no inbox; migration 0008) — último link + PIX + status.
- `get_pay_checkout` / `get_pay_receipt` (páginas de pagamento/recibo Abacate).
- `get_open_payment_links` (links pendentes por unidade).
- `buscar_links_resgate` / `buscar_links_resgate_pendente` (jobs de reenvio).
- `get_phone_pending_debts`, `limpar_links_pagamento_expirados`, `resolve_orfao_matricula`, `link_payout_charges`, `check_data_freshness` (MAX created_at). (functions-analysis)

## Observações

- **Manutenção/estatística:** tabela nunca analisada nem vacuumada (bloco-01) → `reltuples` (42508) é lixo estatístico vs. 561 linhas reais; planner pode escolher planos ruins. Rodar `VACUUM (ANALYZE)`.
- **Bloat:** 17 MB de heap para ≤561 vivas + 915 mortas é desproporcional; provável bloat por UPDATEs frequentes (n_tup_upd=1536) sem vacuum.
- **Índices:** 3 nunca usados (~1.69 MB) + redundância `idx_links_correlation` vs UNIQUE (~3.49 MB) — oportunidade real de enxugar.
- **Antipattern de gravação dispersa:** algumas colunas (`valor, regua, expires_at, pix_copia_cola, pix_gateway, resgate_count, ultimo_resgate_at, status, cancelado_at`) são escritas por **UPDATE direto via PostgREST** das edge functions, fora da RPC `upsert_payment_link`. Isso fragmenta a lógica de escrita entre RPC e REST e dificulta auditoria/RLS — a maior parte da superfície de mutação não passa pela função "oficial".
- **Sem consumidor identificado (2 colunas):** `updated_at` e `ultimo_resgate_at` — escritas, mas nenhum leitor específico encontrado (apenas `SELECT *` genérico poderia tocá-las). Não são "mortas": são colunas de telemetria de escrita.
- **Segurança:** ver seção RLS — exposição de telefone/matrícula a `anon` para cobranças Abacate.
- **Contradição doc↔banco:** o COMMENT da coluna `valor` diz "em centavos", mas o tipo é `numeric` (não inteiro) — verificar se realmente armazena centavos inteiros ou reais decimais ao consumir (`chat_debtor_context`/`get_pay_checkout`). Sem COMMENT na tabela.
