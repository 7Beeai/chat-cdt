# 11 — Plano de Reorganização (fundamentado nos achados)

> **Escopo.** Este documento diz **o que reorganizar e por quê**, e em **que ordem**. Ele **não desenha o schema v2** — isso é etapa seguinte. Tudo aqui sai dos achados de `00`–`10` e de `raw/`.
>
> **Restrição-mãe.** O banco `ubwcxktaruxqacxltovq` é **compartilhado com o n8n em produção** (170k+ msgs, motor de cobrança vivo). Toda ação abaixo é classificada por risco e marca a dependência com o n8n. Nada de DDL às cegas.
>
> **Caveats herdados (válidos para todo o plano):**
> - **Ponto cego da app Next.js** (`08-dependencias.md`): as 5 fontes de backend (funções, edge, n8n, views, triggers) **não enxergam** o cliente Supabase em `app/`+`lib/`. "Sem reader/writer" ≠ "morto" para tabelas `chat_*`.
> - **Sem matriz de GRANTs** (`10-seguranca.md`, A1): o vetor "anônimo lê tudo" nas tabelas RLS-off é **inferido** — depende de grants ao PostgREST que não extraí.
> - **Janela do `pg_stat_statements` ≈ 13h** (`raw/bloco-10c`): qualquer `idx_scan=0`/`calls` baseado nessa janela precisa ser **reconfirmado num período maior** antes de dropar índice. Os contadores de `pg_stat_user_tables` (seq/idx acumulados) são mais antigos e mais confiáveis.

---

## 1. Mapa de acoplamento — o que está amarrado e por quê

Fonte: `08-dependencias.md` §1 e §4; triggers em `raw/bloco-06`.

### 1.1 Os três hubs (mexer aqui = risco sistêmico)
| Hub | Fan-in | Fan-out | Por que está acoplado |
|---|---|---|---|
| **`units`** | 38 readers | 0 writers | Âncora multi-tenant. Quase toda RLS (`user_has_access_to_unit`, `chat_user_has_unit`) e todos os relatórios/views leem `units`. Catálogo gerido manualmente. |
| **`clientes_cobranca_setembro` ↔ `clientes_cobranca_dashboard`** | 18 / 24 | 17 / 15 | **Duas god-tables** mantidas em paralelo, ligadas por trigger síncrono (abaixo). ~38 colunas em comum. |
| **`pagamentos`** | 29 readers | 3 writers | Ledger financeiro; fonte das 3 views `*_mes_atual` e de toda reconciliação. |

### 1.2 As arestas de acoplamento mais sensíveis
- **`setembro` → `dashboard`** via trigger `mirror_disparo_fields_to_dashboard` (espelha ~18 colunas: `cadence_*`, `disparos*`, `status`, `slots_*`, `last_inbound_at`, `regua_at_entry`). **Qualquer mudança de schema em `setembro` propaga ao `dashboard` (1,8 GB) sincronamente.** É a aresta que liga os dois maiores hubs. (`05-triggers.md`, `08` §1.2)
- **`register_payment`** (1 RPC) escreve **5 tabelas** num fluxo: `pagamentos` + `setembro` + `dashboard` + `links_pagamentos_gerados` + `pagamentos_orfaos`. Centraliza o acoplamento do lado pagamento→cobrança. (`functions-analysis`, `03-funcoes.md`)
- **`sync_cobranca_v2`** (1 RPC) escreve **6 tabelas** (setembro ins/upd/del, dashboard upsert/upd, `spreadsheet_sync_log`, `cobranca_sync_backup`, `cobranca_clientes_removidos`, `sync_snapshots`). É o coração do pipeline da planilha. (`09-fluxo-planilha.md`)
- **Cadeia de RLS**: `units`/`profiles`/`user_units`/`user_roles`/`user_unit_permissions` são lidas por **toda** policy de cobrança e de chat → acoplamento de performance (P1/P2 do `10`).
- **Saúde → gate**: `waba_health`/`phone_health`/`waba_violations` —trigger→ `gate_state` → `event_log`. (`08` §1.2)
- **n8n ↔ chat**: implementado por `agent-tools` (edge) + `chat_record_outbound_message` (RPC), **não** pelo `UPDATE conversations SET routing` direto que `docs/04-n8n-contract.md` previa. Acoplamento real diverge do documentado. (`07-n8n.md`)

### 1.3 Redundância estrutural (alvo nº 1 de reorg)
A duplicação **`dashboard` × `setembro`** é a maior dívida estrutural: dois objetos de 50–52 colunas, ~38 em comum, mantidos por escritas duplas (`register_payment`, `sync_cobranca_v2`, `sync_data_ultimo_disparo_from_message_log`, `rollback_sync`) e por um trigger de espelhamento. O COMMENT "duplicate of…" é **historicamente verdadeiro** (origem por CTAS) mas **enganoso** quanto ao papel atual: hoje `setembro` é o estado operacional do motor e `dashboard` é o read-model financeiro espelhado. (`02-tabelas/clientes_cobranca_dashboard.md`, `…setembro.md`)

---

## 2. Peso morto e quase-morto (com confiança)

Fonte: `08-dependencias.md` §4; `02-tabelas/*`; `raw/bloco-01`/`bloco-04`.

### 2.1 Tabelas — veredictos
| Tabela | Veredicto | Evidência |
|---|---|---|
| `template_master` | **Morta** | vazia, RLS off, idx 0, 0 reader/writer em qualquer fonte. |
| `webhook_configs` | **Morta** | vazia, idx 0, 0 reader/writer. |
| `sales_leads` | **Morta** | vazia, só trigger `updated_at`. |
| `todos` | **Morta** | boilerplate vazio (2 colunas). |
| `faturamento_baixas` | **Morta (quase)** | 1 linha, idx residual, 0 reader/writer. |
| `agents_bak_20260601_precancel` | **Backup datado** | snapshot manual de `agents`, RLS off. |
| `agents_bak_20260601_prerename` | **Backup datado** | snapshot manual de `agents`, RLS off. |
| `cobranca_sync_backup`, `sync_snapshots` | **NÃO mexer** | transientes (truncados entre syncs); usados por `rollback_sync`. n_live=0 é normal. |
| **`chat_push_subscriptions`** | **VIVA — NÃO dropar** | aparece R0∩W0 só pelo ponto cego da app; leitura/escrita confirmadas por grep em `app/api/push/*`. |

> **Divergência de classificação a reconciliar:** o cross-cutting `08` (autoritativo) marca `template_master`, `webhook_configs`, `sales_leads`, `todos`, `faturamento_baixas` como **Morta/Backup**; alguns MDs por-tabela as marcaram pelo domínio (ex.: `template_master`="Cobrança"). Use `08` para decisão de descarte.

### 2.2 Índices mortos / redundantes (ganho imediato de espaço + escrita mais barata)
- **~548 MB** em **12 índices `idx_scan=0`** só em `clientes_cobranca_dashboard` (inclui `idx_dashboard_disparos_equipe` 109 MB e **dois índices idênticos sobre `unit_id`**). (`10`/P3, `02-tabelas/clientes_cobranca_dashboard.md`)
- Duplicatas puras: `setembro` (~5,5 MB, 2 índices), `pagamentos` (`correlation_id` triplo-indexado + `unit_id` quase-redundante), `adimplentes_base` (`idx_ab_relac_sweep` duplica `idx_adimplentes_base_unit_elegivel`), `links_pagamentos_gerados` (3 nunca usados + 1 redundante com UNIQUE). (`02-tabelas/*`)
- **Ação só após reconfirmar `idx_scan=0` numa janela > 13h** (caveat).

### 2.3 Colunas sem consumidor / suspeitas (não dropar sem dono confirmar)
- `adimplentes_base.raw_data` (jsonb, **~1,56 KB/linha → dirige os 234 MB**, lido só por `SELECT *`). Forte candidato a slim-down. (`02-tabelas/adimplentes_base.md`)
- `clientes_cobranca_dashboard.data_ultima_mensagem` (TEXT, **sem writer**) lida pelo inbox enquanto o tráfego vivo escreve `data_ultima_mensagem_temp` (timestamptz) → **inbox lê dado stale**. (`02-tabelas/clientes_cobranca_dashboard.md`)
- `setembro.cadence_variante`, `setembro.last_resgate_ia_at` — **sem writer** em nenhuma fonte (reservadas/legado). (`02-tabelas/clientes_cobranca_setembro.md`)
- ~bloco de colunas `baixa_*`/`reembolso_*_at`/`_by` em `pagamentos` sem reader de leitura (só auditoria/FK). (`02-tabelas/pagamentos.md`)

### 2.4 Crons redundantes
- `limpeza-links-pagamento` (`0 2 * * *`, **falha ~48% — 127/264**) coexiste com `cleanup_expired_links_daily` (`0 4 * * *`, 0 falhas) — provável **sobreposição**. Decidir um, desativar o outro, investigar a falha de `limpar_links_pagamento_expirados()`. (`10`/P5, `raw/bloco-11`)

---

## 3. Riscos de segurança por severidade

Resumo de `10-seguranca.md` (lá estão evidência+impacto+ação completos). Ordem = prioridade de correção.

### Alta
| # | Achado | Ação-núcleo |
|---|---|---|
| A2 | Policies `qual=true` p/ `authenticated` em `clientes_cobranca_setembro`, `pagamentos_orfaos` (SELECT **e UPDATE**), `payouts`, `payout_pagamentos` → **vazamento cross-unidade** (PII + valores de ~50k clientes) | remover as policies `true`; manter só as unit-scoped; restringir UPDATE de órfãos a admin/agente |
| A3 | `create-admin-users`: `verify_jwt=false` + service_role + senha hardcoded `TempPassword123!` + CORS `*` | exigir JWT/secret de chamador, senha aleatória + reset forçado, restringir CORS, remover pós-bootstrap |
| A4 | 3 views `SECURITY DEFINER` (`ganhos_/estornos_/cobranca_diaria_mes_atual`) contornam a RLS de `pagamentos` → operador vê todas as unidades | recriar com `security_invoker=true` (PG15+) ou trocar por RPC com checagem de role |
| A1 | 13 tabelas com **RLS off** em `public` (inclui `system_state`=kill switches, `cobranca_clientes_removidos`=PII) | `ENABLE ROW LEVEL SECURITY` + policy explícita; dropar as mortas (§2.1) |
| A5 | Policy `anon` `anon_select_abacate_only` enumera **todos** os links abacate (matrícula/whatsapp) | validar intenção do checkout; escopar por token único ou remover |

### Média
- **M1** — 24 funções com `search_path` mutável; **11 são SECURITY DEFINER** (`user_has_access_to_unit` é a mais crítica). → `ALTER FUNCTION … SET search_path=public, pg_temp`.
- **M2** — `payment_gateway_configs.api_key` em **texto puro** (RLS deny-all protege exposição via PostgREST, mas não o repouso). → Vault/cifra.
- **M3** — Postgres com CVE (patch disponível). → upgrade coordenado com n8n.
- **M4** — OTP longo + leaked-password protection desligada. → ajustar no painel Auth.
- **M5** — Policies duplicadas/sobrepostas (`dashboard` 8 policies = 2×CRUD; `setembro` 6). → consolidar 1 por comando; padronizar helper.

### Baixa
- **B1** — 10 tabelas RLS-on **sem policy** (deny-all; gap funcional p/ a UI ler ex. `event_log`/`fila_humana`). → criar policy onde a UI precisar; documentar o resto como backend-only.
- **B2** — Database Webhook legado `cancel-links-on-regua-valor-update` disparou **~3,96 M** vezes (fev–mai) — **já remediado** em 2026-05-27 (trigger atual: 5.304). → validar que o trigger atual não recria o padrão per-row em cargas grandes.

### Performance (severidade Média, no `10` §Performance)
- **P1/P2** — `user_roles` 90,6 M seq_scan / `user_units` 1,2 M seq_scan: **não** é falta de índice (tabelas de 7/53 linhas) e sim **frequência de avaliação de RLS**. → usar `(SELECT auth.uid())` nas policies (vira InitPlan, 1×/query), consolidar policies, considerar cache de role por sessão.
- **P3** — ~548 MB de índices mortos na god-table (write amplification em 48k updates). → §2.2.
- **P4** — `dashboard` 1,79 GB: **não é bloat de tupla morta** (`n_dead_tup=0`); é over-indexação + duplicação com `setembro`. → §1.3/§2.2.

---

## 4. Ordem sugerida de reorganização

Sequenciada por **risco crescente** e por **dependência do n8n**. Cada fase é entregável e reversível antes da seguinte.

### Fase 0 — Higiene reversível, sem tocar estrutura (baixo risco, sem impacto n8n)
1. `ANALYZE` nas tabelas nunca analisadas (`links_pagamentos_gerados`, `pagamentos`, `clientes_cobranca_*`, etc. — `last_analyze=null` em `bloco-01`). Corrige planos e estimativas antes de qualquer decisão de índice.
2. `ALTER FUNCTION … SET search_path` nas 24 (priorizar as 11 SECDEF) — **M1**.
3. Auth hardening: OTP + leaked-password (**M4**); planejar upgrade Postgres (**M3**, coordenar n8n).
4. Mover `payment_gateway_configs.api_key` p/ Vault (**M2**).
5. Decidir o cron de limpeza redundante e investigar a falha de 48% (**P5/§2.4**).

### Fase 1 — Limpeza e RLS, sem mudar contrato de dados (baixo risco)
6. Ativar RLS nas 13 tabelas off + policies (**A1**); criar policies nas 10 deny-all que a UI precise (**B1**).
7. Remover policies `qual=true` (**A2**) e a `anon` abacate (**A5**) — *após validar o checkout público com o time*. Consolidar policies duplicadas (**M5**).
8. `security_invoker=true` nas 3 views financeiras (**A4**).
9. Dropar as tabelas mortas (§2.1: `template_master`, `webhook_configs`, `sales_leads`, `todos`, `faturamento_baixas`) e os 2 `agents_bak_*` — *após confirmar com o dono*. **Não** tocar `chat_push_subscriptions`, `cobranca_sync_backup`, `sync_snapshots`.
10. Dropar índices mortos/duplicados (§2.2) — **após reconfirmar `idx_scan=0` em janela > 13h**. Ganho ~0,55 GB + escrita mais barata.

### Fase 2 — Endurecimento de superfície (médio risco, coordenar n8n/edge)
11. Endurecer `create-admin-users` (**A3**); auditar `cancel-payment-links` (sem secret de chamador visível).
12. Revisar o Database Webhook `cancel_links_on_regua_valor_update` para statement-level / filtro de transição, evitando recriar a amplificação per-row (**B2**).
13. Reduzir frequência de avaliação de RLS (**P1/P2**): `(SELECT auth.uid())` nas policies, consolidação.

### Fase 3 — Estrutural (alto risco, exige desenho da v2 — fora deste documento)
14. Resolver a duplicação **`dashboard` × `setembro`** (§1.3): candidata a tabela canônica única + view (materializada) para o read-model financeiro, eliminando o trigger de espelhamento. **Mudança coordenada com o n8n** (ambos escrevem nas duas).
15. Slim-down de colunas: `adimplentes_base.raw_data` (234 MB sem leitor), colunas `*_temp` vs canônicas em `dashboard` (resolver o stale do inbox), colunas sem writer (`cadence_variante`, `last_resgate_ia_at`).
16. Renomear colunas com espaço (`"disparado com sucesso"`, `"forma de pagamento"`) — quebra clientes PostgREST/n8n, exige migração coordenada.

---

## 5. O que falta para fechar (lacunas honestas)

- **Matriz de GRANTs ao PostgREST** — sem ela, o impacto real de A1 (RLS-off) fica inferido. Extrair `information_schema.role_table_grants` antes de Fase 1.
- **Reconfirmar `idx_scan=0`** numa janela > 13h (caveat) antes de qualquer `DROP INDEX`.
- **Corpos das 11 funções SECDEF** — confirmar se há referência não-qualificada explorável (mantém M1 em Média, não Alta).
- **Validar com o time** a intenção das policies `anon`/`qual=true` (A2/A5) e do checkout abacate antes de removê-las.
- **Writers não capturados** (ponto cego): `disparadores_whatsapp` (upd 9.687 sem writer mapeado) e todas as `chat_*` dirigidas pela app — confirmar por leitura de `app/`+`lib/` antes de afirmar qualquer "sem uso".
- **Reconciliar classificação** por-tabela × `08` (autoritativo) nas ~5 tabelas divergentes.
- **Não desenhado aqui:** o schema v2 (Fase 3) — é a próxima etapa, com base neste mapa.
