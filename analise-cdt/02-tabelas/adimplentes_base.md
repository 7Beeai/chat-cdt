# adimplentes_base

## Identificação

- **Nome**: `public.adimplentes_base`
- **Dono provável**: **n8n / Motor v2 (cobrança/relacionamento)** — NÃO é tabela do CHAT-CDT. Evidência: nenhuma das 15 migrations em `chat-cdt/infra/supabase/migrations/` referencia a tabela (grep vazio); `docs/analise-banco.md` linha 32 a classifica como `n8n`; o COMMENT da tabela (bloco-01) diz literalmente "Motor v2: base de adimplentes pra trilho relacionamento".
- **Linhas estimadas**: ~157.213 (`n_live_tup` = 157.214; `linhas_estimadas` = 157.213 — bloco-01). `n_tup_ins` = 157.216, `n_tup_upd` = 4.745, `n_tup_del` = 2.
- **Tamanho**: 234 MB total (heap 211 MB) — bloco-01.
- **Classificação**: **Cobrança** (trilho de relacionamento do Motor v2; convive com `clientes_cobranca_*`).
- **Alerta de bloat**: 245.514.240 bytes / 157.214 linhas ≈ **1,56 KB por linha** — alto para 16 colunas em que a maioria é texto curto/uuid/data. O peso vem da coluna `raw_data jsonb` (linha bruta da planilha guardada inteira). Heap de 211 MB + TOAST. Ver Observações.

## Finalidade

Base de filiados **adimplentes** (mensalidade em dia) por unidade, alimentada por importação semanal de planilhas XLSX do BI vindas do Google Drive. Serve de "trilho de relacionamento" do Motor v2: clientes que NÃO estão inadimplentes recebem mensagens semanais de relacionamento/retenção (não cobrança). A coluna `bi_atual` faz exclusão lógica (quem saiu do último XLSX vira `false`); `last_relacionamento_at` controla o cooldown de 7 dias; `relacionamento_opt_out` marca quem pediu para não receber.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | bigint | NO | `nextval('adimplentes_base_id_seq')` | sequence (default) | `motor_v2_relacionamento_get_disparos` (read), n8n "motor-v2-sortear-relacionamento" (read), `route_inbound` não lê id (lê só unit_id/matricula/nome/telefone/bi_atual/updated_at) | confirmado (default é literal; leitura por get_disparos/sortear: functions-analysis + edge-functions) |
| 2 | `unit_id` | uuid | NO | — | upsert (`motor_v2_adimplentes_upsert`, vindo do JSON do import) | `route_inbound`, `motor_v2_relacionamento_get_disparos`, `motor_v2_relacionamento_stats` (FILTER/predicado), `motor_v2_adimplentes_finalize` (predicado), n8n sortear; FK → `units.id` | confirmado (escrita em upsert.columns; leituras em reads.columns — functions-analysis) |
| 3 | `matricula` | text | NO | — | upsert (do JSON do import) | `route_inbound` (read), `motor_v2_relacionamento_get_disparos` (read), n8n "CDT Relacionamento" Map Adimplente (read), n8n sortear (read) | confirmado (writer único = upsert; leituras literais em functions-analysis/n8n-workflows) |
| 4 | `telefone` | text | YES | — | upsert (do JSON do import) | `route_inbound` (norm_phone_br), `motor_v2_relacionamento_get_disparos`, `motor_v2_relacionamento_stats`, `isa_registrar_opt_out` (predicado norm_phone_br), n8n "CDT Relacionamento" (filtro `telefone eq` — query PostgREST 131 chamadas/13h, bloco-10b) | confirmado (writer = upsert; consumo literal por múltiplas funções + query do stat) |
| 5 | `nome` | text | YES | — | upsert (do JSON do import) | `route_inbound`, `motor_v2_relacionamento_get_disparos`, n8n "CDT Relacionamento" Map Adimplente | confirmado (functions-analysis reads.columns + n8n) |
| 6 | `ultimo_pagamento` | date | YES | — | **desconhecida** — NENHUM writer conhecido. `motor_v2_adimplentes_upsert` NÃO inclui esta coluna na sua lista de write (só unit_id/matricula/telefone/nome/status/raw_data/bi_atual/import_batch_id/imported_at/updated_at). Possivelmente preenchida direto pelo serviço externo `:8100` fora da RPC, ou vestigial. | **sem consumidor identificado** | inferido (ausência em todos writers/readers conhecidos — functions-analysis, n8n, stat) |
| 7 | `status` | text | YES | — | upsert (`motor_v2_adimplentes_upsert`, do JSON) | **sem consumidor identificado** (nenhuma função/n8n/view lê `status` desta tabela) | inferido (presente em upsert.columns; ausência em todos reads — functions-analysis) |
| 8 | `raw_data` | jsonb | YES | — | upsert (`motor_v2_adimplentes_upsert`, do JSON do import — guarda a linha bruta da planilha) | **sem consumidor identificado** (nenhum reader mapeia raw_data; só vem em SELECT *) | inferido (writer = upsert; nenhum read literal — functions-analysis/n8n/views) |
| 9 | `imported_at` | timestamptz | NO | `now()` | upsert (set explícito na RPC; default `now()` como fallback) | **sem consumidor identificado** (`adimplentes_import_log.imported_at` é coluna distinta, gravada por finalize — não confundir) | inferido (escrita em upsert.columns; nenhum read desta coluna) |
| 10 | `import_batch_id` | uuid | YES | — | upsert (`motor_v2_adimplentes_upsert`) | `motor_v2_adimplentes_finalize` (lê no predicado `import_batch_id IS DISTINCT FROM p_batch_id` para marcar bi_atual=false) | confirmado (escrita em upsert; leitura em finalize.notes — functions-analysis) |
| 11 | `bi_atual` | boolean | NO | `true` | upsert escreve `true`; `motor_v2_adimplentes_finalize` escreve `false` para linhas fora do batch atual | predicado de quase tudo: `route_inbound`, `get_disparos`, `stats`, `isa_registrar_opt_out`, índices parciais `WHERE bi_atual`, n8n "CDT Relacionamento"/sortear | confirmado (writers = upsert/finalize; leituras como predicado em functions-analysis) |
| 12 | `last_relacionamento_at` | timestamptz | YES | — | `motor_v2_relacionamento_get_disparos` (CTE upd) e n8n sortear (após disparo) | `motor_v2_relacionamento_get_disparos` (cooldown 7d), `motor_v2_relacionamento_stats` (funil semanal), índices `idx_ab_relac_sweep`/`idx_adimplentes_base_unit_elegivel` | confirmado (write+read em get_disparos.columns; stats reads — functions-analysis) |
| 13 | `created_at` | timestamptz | NO | `now()` | default `now()` no INSERT (não setado explicitamente pela RPC upsert) | **sem consumidor identificado** | inferido (default literal; nenhum read em functions-analysis/n8n/stat) |
| 14 | `updated_at` | timestamptz | NO | `now()` | escrita por `motor_v2_adimplentes_upsert`, `motor_v2_adimplentes_finalize`, `motor_v2_relacionamento_get_disparos`, `isa_registrar_opt_out` (em todo UPDATE). Sem trigger de bump (bloco-06 vazio) — é set manual nas RPCs. | `route_inbound` lê `updated_at` (reads.columns) | confirmado (writers múltiplos em functions-analysis; leitura por route_inbound) |
| 15 | `last_relacionamento_template` | text | YES | — | `motor_v2_relacionamento_get_disparos` (grava qual template `rel_*` foi sorteado) | n8n "CDT Relacionamento" Map Adimplente (lê para dar contexto ao agente isa_tt) | confirmado (write em get_disparos.columns; read em n8n-workflows) |
| 16 | `relacionamento_opt_out` | boolean | NO | `false` | `isa_registrar_opt_out` (UPDATE → `true`); default `false` no insert | `motor_v2_relacionamento_get_disparos` (exclui opt-out), `motor_v2_relacionamento_stats` | confirmado (writer = isa_registrar_opt_out.writes; readers em functions-analysis) |

> **Gaps de ordinal**: posições 1–16 contínuas, sem buracos → nenhuma coluna droppada detectável (bloco-02).

## Relacionamentos (FKs)

- `adimplentes_base.unit_id` → `units.id` (constraint `adimplentes_base_unit_id_fkey`, `ON DELETE no action`, `ON UPDATE no action`) — bloco-03. É a única FK; `matricula`/`telefone` não têm FK formal para `clientes_cobranca_*` (o cruzamento é por `norm_phone_br(telefone)` em runtime).
- Sem FKs apontando PARA esta tabela (bloco-03: nenhum `ref_tabela == adimplentes_base`).
- **Chave de negócio**: `UNIQUE (unit_id, matricula)` — usada no `ON CONFLICT` do upsert.

## Índices

| índice | def | único | idx_scan | bytes | nota |
|--------|-----|-------|----------|-------|------|
| `adimplentes_base_pkey` | btree(id) | sim (PK) | 1.506 | 3,48 MB | OK |
| `adimplentes_base_unit_id_matricula_key` | btree(unit_id, matricula) | sim | **160.470** | 12,83 MB | índice mais quente — serve o `ON CONFLICT` do upsert e lookups por matrícula |
| `idx_ab_norm_telefone_atual` | btree(norm_phone_br(telefone)) WHERE bi_atual | não | 165 | 4,71 MB | serve `route_inbound`/`stats`/`isa_registrar_opt_out` (lookup por telefone normalizado) |
| `idx_adimplentes_base_unit_elegivel` | btree(unit_id, last_relacionamento_at) WHERE (bi_atual = true) | não | 29 | 1,05 MB | varredura de elegíveis do relacionamento (get_disparos/sortear) |
| `idx_ab_relac_sweep` | btree(unit_id, last_relacionamento_at) WHERE bi_atual | não | **0** | 1,12 MB | **NUNCA USADO** — ver abaixo |

### Índices nunca usados (idx_scan = 0)

- **`idx_ab_relac_sweep`** — `idx_scan = 0`. **Desperdício: ~1,12 MB (1.171.456 bytes).**
- **Não é só "nunca usado": é DUPLICATA de `idx_adimplentes_base_unit_elegivel`.** Ambos têm a mesma chave `(unit_id, last_relacionamento_at)` e predicado equivalente (`WHERE bi_atual` ≡ `WHERE bi_atual = true`). O planner sempre escolhe `idx_adimplentes_base_unit_elegivel` (29 scans) e nunca o `sweep` (0). Recomendação: **dropar `idx_ab_relac_sweep`** (redundância, não apenas ociosidade). Pelos timestamps no stat-por-tempo (bloco-10a), `idx_ab_relac_sweep` foi criado depois e tornou o `unit_elegivel` redundante — ou vice-versa; de qualquer modo um dos dois sobra.
- **Desperdício total de índice morto: ~1,12 MB.**

## Triggers

- **Nenhum trigger** nesta tabela (bloco-06: filtro por `tabela == adimplentes_base` e por keyword retornaram vazio). Em particular, `updated_at` **não** é mantido por trigger — é set manualmente em cada RPC de UPDATE. Diferente das tabelas do CHAT-CDT, que usam triggers de bump.

## RLS / Policies

- `rls_on = true`, `rls_forced = false` (bloco-01).
- **`n_policies = 0`** (bloco-01) e bloco-09 não tem nenhuma linha com `tablename == adimplentes_base`.
- **Consequência**: RLS habilitada SEM policy = **deny-all** para qualquer role que não dê bypass. O acesso real acontece por (a) `service_role` (n8n/edge, que ignora RLS) e (b) funções `SECURITY DEFINER` (`route_inbound`, `motor_v2_relacionamento_*`, `isa_registrar_opt_out` — todas `security_definer:true` exceto `upsert`/`finalize` que são `security_definer:false` e portanto rodam com a permissão do chamador, tipicamente service_role no import).
- **Contradição com doc** (criticamente avaliada): `docs/analise-banco.md` linha 59 lista esta tabela em `rls_enabled_no_policy` — **bate com o banco** (advisor do Supabase também sinalizaria). O alerta é legítimo: a tabela está "RLS on, 0 policy". Não é falha funcional hoje porque só service_role/SECURITY DEFINER a tocam, mas qualquer acesso futuro via `anon`/`authenticated` direto retornaria vazio silenciosamente.

## Quem escreve / Quem lê

**Pipeline de escrita (lineage do import semanal):**
XLSX no Google Drive → n8n **"Sync Adimplentes - Relacionamento (Motor v2)"** (googleDriveTrigger, poll 15 min) baixa o binário e faz multipart POST para o **serviço externo `http://host.docker.internal:8100/adimplentes/sync`** → esse serviço *(inferido)* chama as RPCs **`motor_v2_adimplentes_upsert`** (INSERT … ON CONFLICT (unit_id,matricula), `bi_atual=true`) e **`motor_v2_adimplentes_finalize`** (marca `bi_atual=false` em quem não veio no batch + grava `adimplentes_import_log`) → tabela.
- ⚠️ A ligação n8n→RPC é **inferida**: o workflow "Sync Adimplentes" NÃO tem nó Supabase/Postgres nem URL `/rest/v1/` — toda a persistência ocorre dentro do serviço `:8100` (n8n-workflows notes). As RPCs `upsert`/`finalize` são os únicos writers conhecidos da tabela (functions-analysis), daí a inferência.

**Outros writers (runtime, não import):**
- `motor_v2_relacionamento_get_disparos` (SECURITY DEFINER) — UPDATE `last_relacionamento_at`, `last_relacionamento_template`, `updated_at` ao sortear.
- `isa_registrar_opt_out` (SECURITY DEFINER) — UPDATE `relacionamento_opt_out`, `updated_at` por telefone (chamada pelo n8n "CDT Relacionamento" via `/rpc/isa_registrar_opt_out`).
- n8n "motor-v2-sortear-relacionamento" (edge function cron 11:45 BRT) — UPDATE `last_relacionamento_at`/`updated_at` (com fallback REST quando RPC ausente).

**Leitores:**
- `route_inbound` (roteamento de inbound: prioriza cobrança, senão filiado ativo aqui).
- `motor_v2_relacionamento_get_disparos` e `motor_v2_relacionamento_stats` (seleção de elegíveis + funil; cruzam com `clientes_cobranca_setembro` via `norm_phone_br` para excluir inadimplentes).
- n8n **"CDT Relacionamento - Tatuapé"** — `Get many rows` filtro `telefone eq` (query PostgREST `SELECT * … WHERE telefone = $1`, **131 chamadas / 6,86 s no snapshot ~13h**, bloco-10b); o nó `Map Adimplente` consome apenas `telefone, nome, matricula, unit_id, last_relacionamento_template`.
- Edge function `motor-v2-sortear-relacionamento` (SELECT id/matricula/telefone/nome/unit_id/bi_atual/last_relacionamento_at).

> **Falsos positivos de keyword** (NÃO são consumidores diretos): n8n "DISPAROS MOTOR V2 - TT" e "Sync Planilha Power BI v3 (Robusto)" aparecem no grep por mencionarem a tabela em `notes`, mas suas listas `reads/writes` de `adimplentes_base` estão vazias — operam sobre `disparos_log`/`clientes_cobranca_*` via `motor_v2_get_disparos`/`sync_cobranca_v2`. Não escrevem/leem esta tabela diretamente.

## Observações

- **Bloat — `raw_data jsonb` é o vilão.** ~1,56 KB/linha. A coluna guarda a linha bruta inteira do XLSX e **nenhum leitor a consome** (só viaja em `SELECT *`). É o principal driver do heap/TOAST de 211 MB. Candidata a: (a) parar de gravar, (b) mover para tabela de staging descartável pós-import, ou (c) compressão/limpeza periódica. Antes de mexer, confirmar que o serviço `:8100` não relê `raw_data` em re-imports (não há evidência de que releia — sem consumidor identificado).
- **5 colunas sem consumidor identificado** (nenhum reader conhecido): `ultimo_pagamento`, `status`, `raw_data`, `imported_at`, `created_at`. Destas, `ultimo_pagamento` é a mais suspeita: **não tem writer conhecido** (origem desconhecida) — provavelmente preenchida pelo serviço `:8100` fora da RPC, ou está vazia/vestigial. Vale uma checagem de `count(ultimo_pagamento IS NOT NULL)`.
- **Índice redundante**: `idx_ab_relac_sweep` (0 scans, 1,12 MB) duplica `idx_adimplentes_base_unit_elegivel`. Dropar o primeiro.
- **RLS on + 0 policy**: deny-all efetivo; só funciona porque o tráfego é service_role / SECURITY DEFINER. Risco se alguém tentar ler via `authenticated`/`anon`.
- **Manutenção**: `last_analyze`/`last_vacuum` manuais = `null`; só autovacuum/autoanalyze (último em 2026-06-01). `n_dead_tup` = 4.734 (dentro do normal pós-import; updates de `bi_atual`/relacionamento geram dead tuples).
- **Sem nome de coluna com espaço**; nomenclatura consistente (snake_case).
- **Tabela irmã**: `adimplentes_import_log` (32 kB, RLS off, `idx_scan=0`) registra a auditoria de cada import — escrita por `motor_v2_adimplentes_finalize` (insert de batch_id/unit_id/file_name/file_id_drive/rows_total/new/updated/removed/imported_at). Note que o `imported_at` do log é coluna distinta do `imported_at` desta tabela.
- **Convivência n8n**: por CLAUDE.md, é tabela do fluxo n8n/Motor v2 — **não alterar estrutura** sem coordenar com o n8n. As recomendações acima (drop de índice redundante, tratamento de `raw_data`) afetam o Motor v2 e precisam de alinhamento, não são mudanças aditivas do CHAT-CDT.
