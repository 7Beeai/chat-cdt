# 04 — Views do banco (11 views)

> **Fontes.** Tabelas/colunas-fonte, métrica e finalidade de cada view: `analise-cdt/raw/views-analysis.json`. Definição SQL completa (CTEs/CASE/filtros de período): `analise-cdt/raw/bloco-07-views.json` (campo `definicao`). Contagem de views (11) confere com `00-resumo.md` (linha 33). A atribuição **SECURITY DEFINER** das 3 views `*_mes_atual` vem dos **security advisors do Supabase** (autoritativos), capturados em `03-funcoes.md` (tabela de advisors, item #4 `security_definer_view`) — **não** do texto da definição (o keyword fica em `pg_class.reloptions`, não no `definicao`).
>
> **Domínio.** **Nenhuma das 11 views é do CHAT-CDT** (`chat_*`). Verificado por grep nas migrations `chat-cdt/infra/supabase/migrations/` (0001–0010): nenhuma define qualquer destas views → todas são **do n8n/cobrança** (criadas fora do versionamento do CHAT-CDT). Seguindo a convenção de `02-tabelas/` (que coloca `phone_health`/`waba_*`/`template_*`/`message_log` sob o guarda-chuva n8n), todas caem no **domínio cobrança** em sentido amplo. Honestamente, há **dois sub-domínios** dentro disso:
> - **Financeiro / dashboard de cobrança (4):** `available_units`, `ganhos_mes_atual`, `estornos_mes_atual`, `cobranca_diaria_mes_atual`.
> - **Monitoramento de infra Meta/WhatsApp (7):** `v_message_perf_24h`, `v_phone_health_current`, `v_template_current`, `v_template_health`, `v_waba_capability_current`, `v_waba_health_current`, `v_waba_violations_recent`. (são saúde de envio/templates/WABA, não pagamentos — mas n8n-owned, não `chat_`.)
>
> **Legenda.** `secdef`: **S** = `SECURITY DEFINER` (confirmado pelo advisor Supabase); **·** = não flagado pelo advisor (presumido INVOKER — *inferido*, ver nota abaixo). `(†)` = inferência. Padrão `DISTINCT ON (k) + ORDER BY k, observed_at DESC` = "último snapshot por k a partir de um log histórico".

## Nota sobre o modo de segurança (secdef)

O advisor de segurança do Supabase flagra **exatamente 3** views como `SECURITY DEFINER` (rodam com privilégio do dono, ignoram a RLS do chamador): **`ganhos_mes_atual`**, **`estornos_mes_atual`**, **`cobranca_diaria_mes_atual`** — as 3 métricas do **dashboard financeiro** (sufixo `*_mes_atual`). Isso é ERROR no advisor (#4 `security_definer_view`).

Para as **outras 8 views o advisor é silencioso** e o texto do `definicao` (bloco-07) **não contém keyword de segurança** em nenhuma das 11 (Postgres guarda `security_invoker` em `reloptions`, não no corpo). Portanto, afirmo apenas: **3 confirmadas SECURITY DEFINER pelo advisor; as outras 8 não foram flagadas** (presumidamente `SECURITY INVOKER`/default — **inferido (†)**, não confirmado pela varredura).

---

## A. Sub-domínio financeiro / dashboard de cobrança (4)

### A.1 `available_units` — catálogo de unidades

| campo | valor |
|---|---|
| **tipo** | view (SELECT direto, sem CTE/filtro/agregação) |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `units` |
| **colunas-fonte** | `units`: `id`, `name`, `code`, `created_at`, `updated_at` |
| **métrica** | Lista de todas as unidades do sistema, ordenadas por nome. |
| **finalidade** | View pública de catálogo de unidades; fonte simples para seletores/filtros de unidade na operação. |
| **definição (resumo)** | `SELECT id, name, code, created_at, updated_at FROM units ORDER BY name`. Sem CTE, sem filtro de período, sem agregação. |

### A.2 `ganhos_mes_atual` — ganhos e comissão por unidade (DASHBOARD · SECURITY DEFINER)

| campo | valor |
|---|---|
| **tipo** | view com CTEs (`exception_codes`, `periodo`, `realizado`, `com_projecao`) + CASE de comissão |
| **secdef** | **S** (SECURITY DEFINER — advisor Supabase #4) |
| **tabelas-fonte** | `pagamentos`, `units` |
| **colunas-fonte** | `pagamentos`: `unit_id`, `valor`, `data_pagamento`, `reembolso_realizado` · `units`: `id`, `name`, `code` |
| **métrica** | Por unidade no mês corrente: `valor_realizado`, `valor_projetado`, `qtd_pagamentos`, `dia_atual`, `dias_no_mes`, `percentual_comissao`, flag `comissao_fixa`, `comissao_realizada`, `comissao_projetada`. **Métrica de dashboard** (`*_mes_atual`). |
| **finalidade** | Ranking/resumo de desempenho de arrecadação e comissão por unidade no mês atual; base do painel de ganhos. Ordenado por `valor_realizado DESC`. |
| **definição (resumo)** | **Filtro de período:** mês corrente em `America/Sao_Paulo` — `inicio_mes = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')` até `agora`. CTE `periodo` calcula `dia_atual` e `dias_no_mes`. CTE `realizado` soma `valor` e conta pagamentos por unidade, **excluindo estornos** (`reembolso_realizado IS NOT TRUE`). CTE `com_projecao`: `LEFT JOIN units` com realizado e projeta o mês (`realizado / dia_atual * dias_no_mes`). **CASE de comissão sobre o valor PROJETADO:** `<=15000 → 10%`, `<=30000 → 9%`, `<=45000 → 8%`, senão `7%`; **6 unidades de `exception_codes` (`ibirite`, `pousoalegre001`, `cabofrio001`, `varginha001`, `trescoracoes001`, `portoalegre001`) têm 7% fixo** (`comissao_fixa = true`). `comissao_realizada = valor_realizado * pct`; `comissao_projetada = valor_projetado * pct`. Valores em reais (`valor/100`, centavos→reais). |

### A.3 `estornos_mes_atual` — total de estornos do mês (DASHBOARD · SECURITY DEFINER)

| campo | valor |
|---|---|
| **tipo** | view com 1 CTE (`periodo`); agregação simples |
| **secdef** | **S** (SECURITY DEFINER — advisor Supabase #4) |
| **tabelas-fonte** | `pagamentos` |
| **colunas-fonte** | `pagamentos`: `valor`, `data_pagamento`, `reembolso_realizado` |
| **métrica** | `valor_total` reembolsado e `qtd_estornos` no mês corrente. **Métrica de dashboard** (`*_mes_atual`). |
| **finalidade** | Indicador agregado de reembolsos do mês atual; complementa a arrecadação com o que foi devolvido. |
| **definição (resumo)** | CTE `periodo` limita ao mês corrente em `America/Sao_Paulo`. **Filtra `reembolso_realizado = true`** (oposto das views de ganhos/cobranca, que excluem estornos). `COALESCE(..., 0)` quando não há estornos; `valor/100` (centavos→reais). Linha única agregada (sem GROUP BY). |

### A.4 `cobranca_diaria_mes_atual` — série diária de arrecadação (DASHBOARD · SECURITY DEFINER)

| campo | valor |
|---|---|
| **tipo** | view com CTEs (`exception_codes`, `periodo`, `realizado_unit`, `unit_pct`) + CASE de comissão + GROUP BY dia |
| **secdef** | **S** (SECURITY DEFINER — advisor Supabase #4) |
| **tabelas-fonte** | `pagamentos`, `units` |
| **colunas-fonte** | `pagamentos`: `unit_id`, `valor`, `data_pagamento`, `reembolso_realizado` · `units`: `id`, `code` |
| **métrica** | Por **dia do mês** corrente: `dia`, `valor_total` recebido, `qtd_pagamentos`, `comissao_total` estimada. **Métrica de dashboard** (`*_mes_atual`). |
| **finalidade** | Série diária de arrecadação do mês atual para o dashboard, convertendo centavos→reais e aplicando o `%` de comissão por unidade para compor a comissão total do dia. |
| **definição (resumo)** | **Filtro de período:** mês corrente em `America/Sao_Paulo`. CTE `periodo` (`dia_atual`, `dias_no_mes`). CTE `realizado_unit` soma realizado por unidade no mês (exclui estornos `reembolso_realizado IS NOT TRUE`). CTE `unit_pct` fixa o `%` de comissão por unidade via **mesmo CASE sobre o valor PROJETADO** (`realizado/dia_atual*dias_no_mes`): `<=15000→10`, `<=30000→9`, `<=45000→8`, senão `7`; as 6 `exception_codes` → `7%` fixo. SELECT final: `JOIN unit_pct` por `unit_id`, exclui estornos, `valor/100`, `comissao_total = sum(valor/100 * pct/100)`, **`GROUP BY` dia do mês** (`EXTRACT(day FROM data_pagamento)`), `ORDER BY dia`. |

---

## B. Sub-domínio monitoramento de infra Meta/WhatsApp (7)

### B.1 `v_message_perf_24h` — performance de entrega 24h por unidade

| campo | valor |
|---|---|
| **tipo** | view agregada (`GROUP BY`); sem CTE; janela móvel 24h |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `message_log`, `units` |
| **colunas-fonte** | `message_log`: `unit_id`, `status`, `delivered_at`, `sent_at`, `read_at` · `units`: `id`, `bi_name` |
| **métrica** | Por unidade nas últimas 24h: `total_sent`, `pct_delivered`, `pct_failed`, `pct_read`, `avg_delivery_secs`, `avg_read_secs`. |
| **finalidade** | Monitoramento operacional de saúde de envio de mensagens WhatsApp por unidade na janela recente, para detectar degradação de entregabilidade. |
| **definição (resumo)** | **Filtro de período:** janela móvel 24h — `WHERE sent_at >= now() - interval '24h'`. Percentuais via `COUNT(*) FILTER (WHERE status ...)`; `pct_delivered` considera `status IN ('delivered','read')`; `NULLIF(count,0)` evita divisão por zero. Latências via `EXTRACT(epoch FROM delivered_at - sent_at)` e `read_at - sent_at`. `LEFT JOIN units` por `bi_name`. `GROUP BY unit_id, bi_name`. |

### B.2 `v_phone_health_current` — snapshot atual de saúde de cada número

| campo | valor |
|---|---|
| **tipo** | view `DISTINCT ON` (último snapshot por número) |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `phone_health`, `units` |
| **colunas-fonte** | `phone_health`: `phone_number_id`, `unit_id`, `quality_rating`, `status`, `observed_at`, `event`, `current_limit` · `units`: `id`, `bi_name`, `name`, `code` |
| **métrica** | Estado corrente por número: `quality_rating`, `status`, `current_limit`, último `event`. |
| **finalidade** | Visão do estado corrente de cada phone number (qualidade/limite/status) por unidade, para monitorar saúde da infra de envio. |
| **definição (resumo)** | **Sem filtro de período** (último por número). `DISTINCT ON (phone_number_id) + ORDER BY phone_number_id, observed_at DESC` = último snapshot por número a partir do log histórico `phone_health`. `LEFT JOIN units` para `bi_name`/`name` (exposto como `unit_name`)/`code`. |

### B.3 `v_template_current` — estado atual de cada template

| campo | valor |
|---|---|
| **tipo** | view `DISTINCT ON` + `LEFT JOIN LATERAL` (enriquecimento) |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `template_status_log`, `template_inventory` |
| **colunas-fonte** | `template_status_log`: `template_name`, `status`, `category`, `created_at` · `template_inventory`: `template_name`, `quality_score`, `rejection_reason`, `updated_at` |
| **métrica** | Por template: `status`, `category`, `observed_at`, `quality_score`, `rejection_reason`. |
| **finalidade** | Consolida o status corrente de cada template (do log de status) enriquecido com qualidade/motivo de rejeição mais recente do inventário, para monitorar aprovação/qualidade. |
| **definição (resumo)** | `DISTINCT ON (template_name) + ORDER BY template_name, created_at DESC` pega o status mais recente por template em `template_status_log`. `LEFT JOIN LATERAL` puxa a linha mais recente de `template_inventory` (`ORDER BY updated_at DESC NULLS LAST LIMIT 1`) para `quality_score`/`rejection_reason`. `WHERE template_name IS NOT NULL`. `created_at` do log exposto como `observed_at`. |

### B.4 `v_template_health` — saúde agregada de templates por unidade/status

| campo | valor |
|---|---|
| **tipo** | view agregada (`GROUP BY`); sem join |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `template_inventory` |
| **colunas-fonte** | `template_inventory`: `unit_code`, `status`, `paused_by_sentinel`, `category` |
| **métrica** | Por `unit_code` × `status` × `paused_by_sentinel`: `total`, `utility`, `marketing`. |
| **finalidade** | Resumo de quantos templates cada unidade tem em cada status (incluindo pausados pelo sentinel), com quebra por categoria, para visão macro. |
| **definição (resumo)** | **Sem filtro de período.** `GROUP BY unit_code, status, paused_by_sentinel`. `count(*) FILTER (WHERE category='UTILITY')` e `... 'MARKETING'` separam contagens por categoria. Sem joins. |

### B.5 `v_waba_capability_current` — snapshot atual de capacidade da WABA

| campo | valor |
|---|---|
| **tipo** | view `DISTINCT ON` (última capacidade por WABA) |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `waba_capability`, `units` |
| **colunas-fonte** | `waba_capability`: `waba_id`, `unit_id`, `max_phone_numbers`, `max_daily_conversations`, `observed_at` · `units`: `id`, `bi_name`, `name` |
| **métrica** | Por WABA: `max_phone_numbers`, `max_daily_conversations`. |
| **finalidade** | Estado corrente dos limites de capacidade de cada conta WABA por unidade, para planejamento/monitoramento de capacidade de envio. |
| **definição (resumo)** | **Sem filtro de período.** `DISTINCT ON (waba_id) + ORDER BY waba_id, observed_at DESC` = última capacidade observada por WABA a partir do histórico `waba_capability`. `LEFT JOIN units` para `bi_name`/`name` (`unit_name`). |

### B.6 `v_waba_health_current` — snapshot atual de saúde da WABA

| campo | valor |
|---|---|
| **tipo** | view `DISTINCT ON` (último snapshot por WABA) + extração JSONB |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `waba_health`, `units` |
| **colunas-fonte** | `waba_health`: `waba_id`, `unit_id`, `name`, `account_review_status`, `business_verification_status`, `health_status`, `observed_at` · `units`: `id`, `bi_name`, `name` |
| **métrica** | Por WABA: `account_review_status`, `business_verification_status`, `can_send_message` (de JSONB), nome. |
| **finalidade** | Estado corrente de cada conta WABA (review/verificação/capacidade de envio) por unidade, para monitorar risco de bloqueio de envio. |
| **definição (resumo)** | **Sem filtro de período.** `DISTINCT ON (waba_id) + ORDER BY waba_id, observed_at DESC` = último snapshot por WABA. Extrai JSONB: `health_status ->> 'can_send_message'`. `LEFT JOIN units` (`bi_name`, `name` como `unit_name`). **Atenção:** `wh.name` (nome do WABA) e `u.name` (nome da unidade) coexistem. |

### B.7 `v_waba_violations_recent` — feed de violações recentes da WABA

| campo | valor |
|---|---|
| **tipo** | view (lista cronológica, **sem deduplicação**) |
| **secdef** | · (não flagado) |
| **tabelas-fonte** | `waba_violations`, `units` |
| **colunas-fonte** | `waba_violations`: `id`, `waba_id`, `unit_id`, `event`, `violation_type`, `restriction_type`, `restriction_expires_at`, `ban_state`, `affected_phone_number`, `observed_at` · `units`: `id`, `bi_name`, `name` |
| **métrica** | Lista de violações: `violation_type`, `restriction_type`, `restriction_expires_at`, `ban_state`, `affected_phone_number`, ordenada da mais recente. |
| **finalidade** | Feed cronológico de incidentes/violações de política das contas WABA por unidade, para alerta e acompanhamento de restrições/banimentos. |
| **definição (resumo)** | **Sem filtro de período e sem `DISTINCT ON`:** lista **todas** as violações `ORDER BY observed_at DESC`. `LEFT JOIN units` para `bi_name`/`name` (`unit_name`). |

---

## Síntese

| # | view | sub-domínio | tipo / técnica | secdef | filtro de período |
|---|---|---|---|:--:|---|
| 1 | `available_units` | financeiro/catálogo | SELECT direto | · | — |
| 2 | `ganhos_mes_atual` | **dashboard financeiro** | CTEs + CASE comissão | **S** | mês corrente (SP) |
| 3 | `estornos_mes_atual` | **dashboard financeiro** | CTE + agregação | **S** | mês corrente (SP) |
| 4 | `cobranca_diaria_mes_atual` | **dashboard financeiro** | CTEs + CASE + GROUP BY dia | **S** | mês corrente (SP) |
| 5 | `v_message_perf_24h` | infra Meta/WhatsApp | agregação + FILTER | · | janela móvel 24h |
| 6 | `v_phone_health_current` | infra Meta/WhatsApp | `DISTINCT ON` snapshot | · | — (último) |
| 7 | `v_template_current` | infra Meta/WhatsApp | `DISTINCT ON` + LATERAL | · | — (último) |
| 8 | `v_template_health` | infra Meta/WhatsApp | agregação + FILTER | · | — |
| 9 | `v_waba_capability_current` | infra Meta/WhatsApp | `DISTINCT ON` snapshot | · | — (último) |
| 10 | `v_waba_health_current` | infra Meta/WhatsApp | `DISTINCT ON` + JSONB | · | — (último) |
| 11 | `v_waba_violations_recent` | infra Meta/WhatsApp | lista (sem dedup) | · | — |

- **As 3 `*_mes_atual` (`ganhos`/`estornos`/`cobranca_diaria`) são as métricas do dashboard financeiro e as únicas 3 views `SECURITY DEFINER`** (advisor Supabase #4 `security_definer_view`, ERROR — rodam com privilégio do dono e ignoram a RLS do chamador). Compartilham o **mesmo CASE de comissão** (10/9/8/7% sobre o valor *projetado* nas faixas 15k/30k/45k) e a mesma lista de **6 unidades `exception_codes` fixas em 7%** (`ibirite`, `pousoalegre001`, `cabofrio001`, `varginha001`, `trescoracoes001`, `portoalegre001`).
- **Para as outras 8 views o advisor é silencioso** → presumido `SECURITY INVOKER` (**inferido (†)**; o `definicao` em bloco-07 não traz keyword de segurança).
- **Nenhuma view é `chat_`** (CHAT-CDT) — verificado por grep nas migrations `infra/supabase/migrations/`; todas são n8n-owned, fora do versionamento do CHAT-CDT.
