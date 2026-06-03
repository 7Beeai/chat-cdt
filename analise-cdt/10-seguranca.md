# 10 — Segurança e Performance

> **Fontes.** Advisors de segurança do Supabase (autoritativos, capturados na auditoria) + RAW locais: `raw/bloco-01-tabelas.json` (RLS por tabela, seq/idx scan, bloat), `raw/bloco-04-indices.json` (tamanho/uso de índices), `raw/bloco-09-policies.json` (policies RLS), `raw/bloco-11-cron.json` (jobs pg_cron), `raw/bloco-14-db-webhooks.json` (Database Webhooks), `raw/bloco-10b-stat-por-chamadas.json` + `raw/bloco-10c-stat-janela.json` (pg_stat_statements), `raw/edge-functions.json` (auth das edge functions), `raw/functions-analysis.json` (SECURITY DEFINER + search_path), `raw/views-analysis.json`.
>
> **Caveat de janela (pg_stat_statements).** `bloco-10c`: `stats_reset = 2026-06-01T14:11Z`, `snapshot = 2026-06-02T03:25Z` → **janela de apenas 13h14m**. Todas as métricas de `total_ms`/`calls` de `bloco-10b` cobrem ~13h, não o histórico completo. Já as métricas de `pg_stat_user_tables` (seq_scan/idx_scan em `bloco-01`) são acumuladas desde o último reset de estatísticas da tabela (muito mais antigas). **Não comparar as duas escalas diretamente.**
>
> **Mapeamento de severidade.** ERROR do advisor → **Alta**; WARN → **Média**; INFO → **Baixa**. Ajustado para cima por explorabilidade (ex.: endpoint sem auth com service_role). Cada item traz **severidade · evidência (fonte) · impacto**. `(†)` = inferência.
>
> **Reconciliação dos números do advisor (confere com os RAW):**
> - **13 `rls_disabled_in_public`** = exatamente as 13 tabelas com `rls_on=false` em `bloco-01` (incluindo as duas `agents_bak_*`).
> - **10 `rls_enabled_no_policy`** = exatamente as 10 tabelas com `rls_on=true & n_policies=0` em `bloco-01`.
> - **24 `function_search_path_mutable`** = 11 SECURITY DEFINER + 13 INVOKER (`functions-analysis.json`: 96 de 115 funções são SECURITY DEFINER; 11 delas têm `search_path=null`).
> - **3 `security_definer_view`** = `ganhos_mes_atual`, `estornos_mes_atual`, `cobranca_diaria_mes_atual` (ver `04-views.md`).

---

## Resumo executivo

| # | Achado | Severidade | Categoria |
|---|---|---|---|
| A1 | 13 tabelas em `public` com **RLS desligada** | **Alta** | Segurança |
| A2 | Policies `qual=true` para `authenticated` em dados financeiros/cliente (vazamento cross-unidade) | **Alta** | Segurança |
| A3 | Edge function `create-admin-users`: sem auth + senha hardcoded + service_role + CORS `*` | **Alta** | Segurança |
| A4 | 3 views `SECURITY DEFINER` no dashboard financeiro | **Alta** | Segurança |
| A5 | Policy `anon` enumera todos os links de pagamento `abacate` | **Alta** | Segurança |
| M1 | 24 funções com `search_path` mutável (11 são SECURITY DEFINER) | **Média** | Segurança |
| M2 | `payment_gateway_configs` guarda `api_key` em texto puro | **Média** | Segurança |
| M3 | Postgres com CVE conhecida (patch disponível) | **Média** | Segurança |
| M4 | OTP com expiração longa + proteção de senha vazada desligada | **Média** | Segurança |
| M5 | Policies duplicadas/sobrepostas (god-table tem 2×CRUD) | **Média** | Segurança/Perf |
| P1 | `user_roles` 90,6M seq_scan — overhead de avaliação de RLS | **Média** | Performance |
| P2 | `user_units` 1,2M seq_scan, `idx_scan=0` | **Média** | Performance |
| P3 | ~548MB de índices `idx_scan=0` na god-table (write amplification) | **Média** | Performance |
| P4 | God-table `clientes_cobranca_dashboard`: 1,79GB / 95k linhas, duplicata de `setembro` | **Média** | Performance |
| P5 | Cron `limpeza-links-pagamento` falha ~48% das execuções | **Média** | Performance |
| B1 | 10 tabelas com RLS ligada mas **sem policy** (deny-all / app não lê) | **Baixa** | Segurança/Func. |
| B2 | Database Webhook legado disparou ~3,96M vezes (**já remediado**) | **Baixa** | Performance (histórico) |

---

# SEGURANÇA

## SEVERIDADE ALTA

### A1 — 13 tabelas em `public` com RLS desligada
- **Severidade:** Alta (advisor `rls_disabled_in_public` = ERROR ×13).
- **Evidência:** `bloco-01-tabelas.json`, campo `rls_on=false` em: `cobranca_sync_backup`, `data_freshness_log`, `cadence_calendar`, `agents_bak_20260601_precancel`, `agents_bak_20260601_prerename`, `cobranca_clientes_removidos`, `template_master`, `sync_snapshots`, `cadence_slot_config`, `gate_config`, `log_limpeza_links`, `adimplentes_import_log`, `system_state`. (13 — confere 1-a-1 com o advisor, contando as duas `agents_bak_*`.)
- **Impacto:** Sem RLS, qualquer role com `GRANT` na tabela (tipicamente `anon`/`authenticated` via PostgREST) lê/escreve todas as linhas. Conteúdo sensível aqui: `cobranca_sync_backup` (9k linhas de backup de cobrança), `cobranca_clientes_removidos` (PII de clientes removidos), `system_state` (**kill switches globais** — `cadence_enabled` etc., operável por UPDATE direto), `gate_config`/`cadence_slot_config` (políticas do motor). **A exposição real depende dos GRANTs concedidos ao PostgREST — não tenho a matriz de grants, então marco o vetor de leitura externa como inferido (†).** Independentemente do grant, RLS-off em `public` é ERROR e viola o princípio de defesa em profundidade.
- **Ação:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em todas; dropar as 2 `agents_bak_*` (backups pré-rename de 2026-06-01, 14/13 linhas) e `cobranca_sync_backup`/`sync_snapshots`/`template_master` se forem lixo morto (todas com `n_live_tup=0` ou near-zero e `idx_scan` ~0).

### A2 — Policies `qual=true` para `authenticated` em dados financeiros e de cliente (vazamento cross-unidade)
- **Severidade:** Alta. Mais grave que as duplicatas de M5: estas policies **anulam o isolamento por unidade**, porque numa tabela com múltiplas policies PERMISSIVE o resultado é o **OR** delas — `true` vence sempre.
- **Evidência (`bloco-09-policies.json`):**
  - `clientes_cobranca_setembro` → "Authenticated users can read setembro data" (`roles=[authenticated]`, SELECT `qual=true`). É a **gêmea** da god-table (`comentario` em bloco-01: "This is a duplicate of clientes_cobranca"), 49.633 linhas de dados de cliente/cobrança. Convive com policies unit-scoped (`user_has_access_to_unit`), mas o `true` torna-as inúteis → **qualquer operador lê todas as unidades**.
  - `pagamentos_orfaos` → SELECT `true` **e UPDATE `true`** (`authenticated`). Qualquer usuário autenticado **altera** pagamentos órfãos.
  - `payouts` e `payout_pagamentos` → SELECT `true` (`authenticated`) — dados financeiros de repasse.
  - `webhook_events_log`, `spreadsheet_sync_log`, `template_status_log` → SELECT `true` (`authenticated`) — menos sensível, mas ainda sem escopo.
- **Impacto:** Quebra de multi-tenancy. Um operador da unidade X lê (e em `pagamentos_orfaos`, escreve) dados de todas as unidades. Em `clientes_cobranca_setembro` isso é PII + valores de dívida de ~50k clientes.
- **Ação:** Remover as policies `qual=true` e deixar apenas as unit-scoped (`user_has_access_to_unit(unit_id)`); para `pagamentos_orfaos`, restringir UPDATE a admin/agente.

### A3 — Edge function `create-admin-users`: sem auth + senha hardcoded + service_role + CORS `*`
- **Severidade:** Alta (achado próprio da auditoria de edge functions — **não** é item de advisor).
- **Evidência (`edge-functions.json`, slug `create-admin-users`):** `verify_jwt=false`; usa `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS); campo `notes`: *"senha temporaria fixa 'TempPassword123!' e emails admin hardcoded (victor@7bee.com, andre@7bee.com) — endpoint sensivel sem autenticacao propria; ... CORS aberto a '*'"*. Opera sobre `profiles`, `user_roles` (role `admin`) e `auth.admin.createUser`.
- **Impacto:** Endpoint HTTP público que cria/garante contas **admin** com senha conhecida. **Atenuante honesto:** a função é **idempotente / create-if-missing** — só cria o que faltar. O caminho de takeover (login com `TempPassword123!`) só existe se essas contas admin estiverem ausentes ou se a senha temporária nunca foi trocada. Ainda assim é Alta por defesa em profundidade: bootstrap com service_role nunca deveria ser invocável anonimamente, e a senha jamais deveria estar no código.
- **Contexto (por que esta é a exceção, e não as outras `verify_jwt=false`):** há ~17 edge functions com `verify_jwt=false` (`edge-functions.json`), mas a maioria autentica o chamador por **outro** mecanismo — assinatura de webhook (`WOOVI_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `ABACATE_WEBHOOK_SECRET`) ou segredo de chamador (`INTERNAL_API_KEY`, `AGENT_TOOLS_SECRET`, `MOTOR_V2_API_KEY`, `NOTIFY_ORPHAN_INTERNAL_KEY`). `create-admin-users` é a que se destaca por **não ter nenhum segredo de chamador** na lista de `secrets` (só `SUPABASE_URL` + `SERVICE_ROLE_KEY`). `cancel-payment-links` também não exibe segredo de chamador — **vale verificar** (não tenho o corpo para confirmar se valida origem).
- **Ação:** Exigir `verify_jwt=true` + checagem de admin, ou um header-secret dedicado; gerar senha aleatória e forçar reset no primeiro login; restringir CORS; idealmente remover o endpoint após o bootstrap.

### A4 — 3 views `SECURITY DEFINER` no dashboard financeiro
- **Severidade:** Alta (advisor `security_definer_view` = ERROR ×3).
- **Evidência:** advisor + `04-views.md`: `ganhos_mes_atual`, `estornos_mes_atual`, `cobranca_diaria_mes_atual` (as 3 com sufixo `*_mes_atual`). Rodam com o privilégio do **dono** da view, ignorando a RLS de quem consulta. Fonte: `pagamentos` (+`units`).
- **Impacto:** Como rodam como dono, a RLS de `pagamentos` (escopo por unidade) **não se aplica** ao consultar a view → um operador de uma unidade vê arrecadação/comissão/estornos agregados de **todas** as unidades através dessas 3 views. (`pagamentos` tem policy unit-scoped, mas a view a contorna.)
- **Ação:** Recriar com `WITH (security_invoker=true)` (Postgres 15+) e confirmar que a RLS de `pagamentos` cobre o caso de uso do dashboard; ou substituir por RPC SECURITY DEFINER com checagem de role explícita.

### A5 — Policy `anon` enumera todos os links de pagamento `abacate`
- **Severidade:** Alta (depende da intenção; sinalizar para validação).
- **Evidência (`bloco-09-policies.json`):** `links_pagamentos_gerados` → policy `anon_select_abacate_only` (`roles=[anon]`, SELECT `qual=(pix_gateway = 'abacate')`). Permite a **qualquer anônimo** ler **todos** os links com gateway abacate — não apenas o seu próprio link.
- **Impacto:** Enumeração de links de pagamento (valores, matrícula, status) sem autenticação. Se o fluxo de checkout esperava expor só **um** link por token, esta policy é larga demais.
- **Ação:** Verificar se é intencional para o checkout público. Se sim, escopar por um token/ID único na URL (não por gateway inteiro). Se não, remover a policy. **Marcar para validação com o time** — não dá pra afirmar exploração sem ver o checkout.

---

## SEVERIDADE MÉDIA

### M1 — 24 funções com `search_path` mutável (11 são SECURITY DEFINER)
- **Severidade:** Média (advisor `function_search_path_mutable` = WARN ×24); as 11 SECURITY DEFINER são o **subconjunto prioritário**.
- **Evidência (`functions-analysis.json`):** 96 de 115 funções são SECURITY DEFINER; 11 têm `search_path=null`: `add_to_blacklist`, `can_access_unit`, `get_all_units`, `get_unit_details`, `get_user_accessible_units`, `record_inbound_message`, `record_message_status`, `record_meta_account_event`, `sentinel_apply_meta_event`, `sentinel_register_variation`, `user_has_access_to_unit`. As outras 13 sem search_path são INVOKER.
- **Impacto:** Numa função SECURITY DEFINER sem `search_path` fixo, um atacante que consiga criar objetos num schema no `search_path` (ex.: tabela/função homônima) pode sequestrar referências não-qualificadas e executar código com o privilégio do dono. **Atenuante honesto:** o advisor flagra o *risco de configuração*; tenho o campo `reads` mas **não o corpo completo** dessas 11 funções, então não afirmo que haja referência não-qualificada explorável — por isso Média, não Alta. `user_has_access_to_unit` é a mais crítica (gate de RLS de várias tabelas; lê `user_roles`+`user_unit_permissions`).
- **Ação:** `ALTER FUNCTION ... SET search_path = public, pg_temp` nas 24 (priorizar as 11 SECURITY DEFINER). Padronizar como nas que já têm (`has_role`, `user_can_read_unit` já trazem `search_path='public'`).

### M2 — `payment_gateway_configs` guarda credenciais (`api_key`) em texto puro
- **Severidade:** Média.
- **Evidência:** `bloco-01` — `comentario`: *"Credenciais de API dos gateways de pagamento por franquia. Inserir manualmente via Dashboard para cada franquia ativa."*; guarda `api_key` dos gateways. RLS: `rls_on=true`, `n_policies=0`.
- **Nuance de RLS (importante):** RLS **ligada + 0 policies = deny-all** para `anon`/`authenticated`. Ou seja, a tabela **não vaza via PostgREST** (diferente das de A1, que estão com RLS *off*). O risco aqui **não** é exposição de API, e sim **credenciais em repouso em texto puro** — qualquer dump do banco, backup ou acesso via service_role expõe as chaves dos gateways (Stripe/Woovi/Abacate).
- **Ação:** Mover segredos para Supabase Vault (`vault.secrets`) e referenciar por id; ou cifrar em coluna. Manter a policy deny-all (ou criar policy admin-only explícita) e auditar quem tem service_role.

### M3 — Postgres com vulnerabilidade conhecida (patch disponível)
- **Severidade:** Média (advisor `vulnerable_postgres` ×1; patch disponível).
- **Evidência:** advisor de segurança Supabase — versão do Postgres com CVE corrigida em release de patch já disponível.
- **Impacto:** Exposição a CVE conhecida do engine enquanto não atualizado.
- **Ação:** Agendar upgrade de versão do Postgres no painel Supabase (idealmente fora do horário de pico; coordenar com n8n por ser banco compartilhado).

### M4 — OTP com expiração longa + proteção de senha vazada desligada
- **Severidade:** Média (advisors `auth_otp_long_expiry` + `auth_leaked_password`, ambos WARN).
- **Evidência:** advisors de auth do Supabase: (a) `auth_otp_long_expiry` — janela de validade do OTP acima do recomendado; (b) `auth_leaked_password` — checagem contra base de senhas vazadas (HaveIBeenPwned) **desativada**.
- **Impacto:** OTP longo amplia a janela de interceptação/reuso; sem leaked-password protection, usuários podem definir senhas já comprometidas.
- **Ação:** Reduzir expiração do OTP (≤ 1h, recomendado ~5–15min) e ativar "Leaked password protection" no painel Auth.

### M5 — Policies duplicadas/sobrepostas (god-table com CRUD em dobro)
- **Severidade:** Média (segurança + performance — cada policy extra é avaliada em toda query).
- **Evidência (`bloco-09-policies.json`):** `clientes_cobranca_dashboard` tem **8 policies** (`bloco-01`: `n_policies=8`), com pares redundantes:
  - **DELETE ×2:** "Only admins can delete clients - dashboard" (`EXISTS user_roles ... role=admin`) e "Only admins can delete dashboard records" (`has_role(...,'admin')`) — mesma intenção, formas diferentes.
  - **INSERT ×2:** "Only admins can insert dashboard records" (`has_role`) vs. "Users can insert clients in their units - dashboard" (`user_has_access_to_unit`).
  - **SELECT ×2:** "Only admins and collections agents can read dashboard" (`has_role admin OR collections_agent`) vs. "Users can view clients from their units - dashboard" (`user_has_access_to_unit`).
  - **UPDATE ×2:** análogo. Mesmo padrão em `clientes_cobranca_setembro` (6 policies). 
- **Impacto:** (1) **Segurança** — policies OR-eadas dificultam raciocinar sobre o acesso efetivo; uma policy ampla "vence" e pode anular uma restrita (relacionado a A2). (2) **Performance** — cada SELECT na god-table avalia múltiplos predicados (incl. `has_role`/`user_has_access_to_unit`, que leem `user_roles`/`user_unit_permissions`), multiplicando o overhead descrito em P1.
- **Ação:** Consolidar para 1 policy por comando; padronizar em `has_role`/`user_has_access_to_unit` (não misturar com `EXISTS user_roles`).

---

## SEVERIDADE BAIXA

### B1 — 10 tabelas com RLS ligada e **sem policy** (deny-all / gap funcional)
- **Severidade:** Baixa (advisor `rls_enabled_no_policy` = INFO ×10).
- **Evidência (`bloco-01`, `rls_on=true & n_policies=0`):** `adimplentes_base` (157k linhas), `event_log` (41k), `cliente_cadencia` (22k), `blacklist_global`, `fila_humana`, `disparos_log`, `payment_gateway_configs`, `faturamento_baixas`, `gate_state`, `app_internal_config`. (10 — confere com advisor.)
- **Impacto:** RLS ligada sem policy = **deny-all** para `anon`/`authenticated` (não é vazamento). Na prática é um **gap funcional**: a app só acessa essas tabelas via service_role/edge functions. Ex.: `adimplentes_base` tem 157k linhas que **o frontend não consegue ler** por RLS. `payment_gateway_configs` aparece aqui e em M2 (lá a preocupação é credencial em repouso, não exposição).
- **Ação:** Confirmar que o acesso pretendido é só backend (service_role). Se a UI precisar ler alguma (ex.: `event_log` para auditoria, `fila_humana` para o time humano), criar policy explícita. Caso contrário, documentar como intencionalmente backend-only.

### B2 — Database Webhook legado disparou ~3,96M vezes (já remediado)
- **Severidade:** Baixa (histórico — **resolvido em 2026-05-27**).
- **Evidência (`bloco-14-db-webhooks.json`):** hook `\tcancel-links-on-regua-valor-update` (note o `\t` literal no nome) com **3.962.003 invocações** entre 2026-02-22 e 2026-05-26. `_obs`: era um Database Webhook **per-row** disparado em updates em massa da coluna `regua_valor` em `clientes_cobranca_*`. **Substituído em 2026-05-27** pelo trigger `cancel_links_on_regua_valor_update` (AFTER UPDATE OF regua_valor → `http_request` → edge `cancel-payment-links`), que acumula apenas **5.304** invocações desde então.
- **Impacto (histórico):** ~3,96M chamadas HTTP saindo do banco em 3 meses — custo de CPU/rede e risco de rate-limit na edge function, por amplificação per-row em UPDATEs em lote. **Já mitigado**; mantido aqui como lição: triggers/webhooks per-row em colunas atualizadas em massa amplificam brutalmente.
- **Ação:** Nenhuma urgente. Validar que o trigger atual não recria o padrão em cargas grandes (idealmente statement-level ou com filtro de transição).

---

# PERFORMANCE

> Lembrete do caveat: métricas de `pg_stat_statements` (total_ms/calls) cobrem só **~13h** (`bloco-10c`). Métricas de `pg_stat_user_tables` (seq_scan/idx_scan) são acumuladas desde o reset da tabela e refletem um período bem maior.

### P1 — `user_roles`: 90,6M seq_scan — overhead de avaliação de RLS (não é problema de índice)
- **Severidade:** Média.
- **Evidência (`bloco-01`):** `user_roles` com **`seq_scan=90.587.825`** e `idx_scan=0`, sobre **7 linhas / 40KB**. A função `has_role` (`functions-analysis.json`: `reads user_roles[user_id,role]`) é chamada em praticamente toda policy de admin (ver os vários `has_role(auth.uid(),'admin')` em `bloco-09`).
- **Impacto — leitura honesta:** os 90,6M **não** indicam um scan caro por chamada. A tabela tem 7 linhas; o Postgres **escolhe** seq_scan porque é mais barato que um índice nesse tamanho, e cada scan custa microssegundos. O número alto = **volume de avaliação de RLS** (`has_role` reexecutado a cada linha/consulta protegida), não custo unitário. O custo agregado é CPU gasto reavaliando a mesma role milhões de vezes.
- **Ação:** **Não** criar índice em `user_roles` (Postgres não usaria e não ajudaria). Reduzir a **frequência de avaliação**: usar `(SELECT auth.uid())` nas policies (já feito em várias — vira InitPlan, avaliado 1×/query, não 1×/linha), e considerar cachear a role por sessão (`current_setting`) ou consolidar policies (ver M5) para chamar `has_role` menos vezes.

### P2 — `user_units`: 1,2M seq_scan, `idx_scan=0`
- **Severidade:** Média.
- **Evidência (`bloco-01`):** `user_units` com **`seq_scan=1.219.180`**, **`idx_scan=0`**, sobre 53 linhas. Também `profiles` aparece com `seq_scan=10` mas `idx_scan=1.219.315` e `user_unit_permissions` com `idx_scan=732.175` — a cadeia de helpers de unidade é muito exercitada.
- **Impacto:** Mesmo diagnóstico de P1 — tabela minúscula (53 linhas), seq_scan é escolha do planner; o volume reflete a frequência das checagens de unidade (`chat_user_has_unit`/`user_has_access_to_unit`) nas policies de `contacts`/`conversations`/`messages`/dashboard. Métrica inflada por volume, não por custo unitário.
- **Ação:** Mesma de P1 (reduzir frequência de avaliação; `(SELECT ...)` para virar InitPlan). Índice não resolve em tabela de 53 linhas.

### P3 — ~548MB de índices `idx_scan=0` na god-table (over-indexação + write amplification)
- **Severidade:** Média.
- **Evidência (`bloco-04-indices.json`, agregado):** `clientes_cobranca_dashboard` tem **12 índices com `idx_scan=0` somando ~548MB** (confirmado por agregação local). É de longe o maior peso de índice morto do banco (próximos: `message_log` 59MB/3 idx, `event_log` 12MB/8 idx).
- **Impacto:** ~548MB ocupados sem nenhuma leitura os usando, **mais** custo de manutenção a cada escrita: a god-table teve `n_tup_upd=48.358` (`bloco-01`) — cada UPDATE precisa manter 12 índices inúteis (write amplification, WAL extra, autovacuum mais pesado).
- **Ação:** `DROP INDEX` nos 12 não utilizados (validar `idx_scan=0` numa janela maior antes — o reset de stats pode mascarar uso raro). Ganho direto de ~548MB + escritas mais baratas.

### P4 — God-table `clientes_cobranca_dashboard`: 1,79GB / 95k linhas, duplicata de `setembro`
- **Severidade:** Média.
- **Evidência (`bloco-01`):** `clientes_cobranca_dashboard` — `bytes_total≈1,88GB` (1793 MB), `tamanho_heap=950 MB`, `n_live_tup=95.685`, **`n_dead_tup=0`**, autovacuum/autoanalyze recentes (2026-06-02 03:01), 52 colunas, 8 policies. `comentario`: *"This is a duplicate of clientes_cobranca_setembro"*.
- **Impacto — leitura honesta (não é bloat clássico):** com `n_dead_tup=0` e autovacuum recente, **não há inchaço por tuplas mortas**. A relação é 1,79GB mas o **heap é só 950MB** — os ~840MB restantes são **índices**, dos quais ~548MB são mortos (P3). Logo o problema real é: (1) **over-indexação** (P3), (2) **write amplification** (48k updates), (3) **duplicação** — é cópia de 52 colunas de `clientes_cobranca_setembro` (49k linhas, 43MB), dobrando manutenção e policies. 95k linhas em 950MB de heap ⇒ ~10KB/linha (52 colunas largas) — candidato a normalização.
- **Ação:** Resolver a duplicação `dashboard` vs `setembro` (uma view materializada ou uma única tabela canônica); aplicar P3; revisar se as 52 colunas são todas necessárias na tabela quente.

### P5 — Cron `limpeza-links-pagamento` falha ~48% das execuções
- **Severidade:** Média.
- **Evidência (`bloco-11-cron.json`):** job `limpeza-links-pagamento` (`SELECT limpar_links_pagamento_expirados()`, `0 2 * * *`): `runs=264`, **`failed=127`** → **~48,1%** de falha. `last_status=succeeded`, mas quase metade das execuções históricas falhou. Existe um job análogo `cleanup_expired_links_daily` (`0 4 * * *`) com `failed=0` — possível **sobreposição/redundância** de duas rotinas de limpeza de links.
- **Impacto:** Links de pagamento expirados podem não estar sendo limpos de forma confiável (acúmulo em `links_pagamentos_gerados`); ruído de falhas mascara problemas reais; dois jobs fazendo a mesma coisa é desperdício e risco de corrida.
- **Ação:** Investigar a causa das falhas de `limpar_links_pagamento_expirados()` (logs do cron / exceção da função). Decidir entre os dois jobs de limpeza e desativar o redundante.

---

## Notas de honestidade e limites desta análise

- **Vetor de exposição das tabelas RLS-off (A1):** depende dos `GRANT`s concedidos ao PostgREST (`anon`/`authenticated`). **Não tenho a matriz de grants** nos RAW → o impacto de leitura externa é **inferido (†)**. RLS-off em `public` é ERROR independentemente, mas o "qualquer anônimo lê tudo" só se confirma com grant presente.
- **Corpos das 11 funções SECURITY DEFINER (M1):** tenho `reads`/`writes` (`functions-analysis.json`), **não o SQL completo**. Não afirmo que haja referência não-qualificada explorável — por isso M1 fica em Média.
- **seq_scan (P1/P2):** explicitamente **não** recomendo índice em `user_roles`/`user_units` (7 e 53 linhas; o planner não usaria). A métrica é inflada por volume de chamadas de RLS, não por custo de scan.
- **God-table (P4):** **não** é bloat de tuplas mortas (`n_dead_tup=0`); é tamanho + over-indexação + duplicação.
- **Webhook 3,96M (B2):** **já remediado** em 2026-05-27 — listado como histórico/Baixa, não como problema ativo.
- **Janela de 13h (pg_stat_statements):** qualquer leitura de `total_ms`/`calls` de `bloco-10b` vale só para ~13h; não extrapolar para o histórico.
