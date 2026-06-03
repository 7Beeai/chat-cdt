# disparadores_whatsapp

## Identificação

- **Nome:** `public.disparadores_whatsapp`
- **Dono provável:** **n8n / fluxo de cobrança** — registry dos números/WABAs usados em disparos. CLAUDE.md lista explicitamente como tabela do n8n a **não alterar**. `docs/03-database.md` (linha 22): *"registry de números/WABAs do n8n"*.
- **Linhas estimadas:** 21 (n_live_tup = 21). `bloco-01-tabelas.json`.
- **Tamanho:** 144 kB total (heap 24 kB) — quase tudo é índice e bloat de UPDATE. `bloco-01-tabelas.json`.
- **Classificação:** **Cobrança** (conforme dica de tarefa e CLAUDE.md).
- **Bloat:** 144 kB / 21 linhas ≈ 7 kB/linha — desproporcional para 13 colunas estreitas. Causa: **9.687 UPDATEs** (n_tup_upd) na janela sobre apenas 21 linhas vivas (contador `disparos_sucesso_hoje` incrementado a cada disparo bem-sucedido), gerando n_dead_tup=37 e churn de versões. Sem VACUUM manual (last_vacuum=null; só autoanalyze). Tabela minúscula, então o "bloat" é irrelevante em MB absolutos, mas o **padrão de write-amplification** é o ponto: 1 número recebe ~centenas de UPDATEs/dia.

## Finalidade

Gerenciar os números de WhatsApp usados para **disparos** (cobrança) e controlar seus limites diários (COMMENT da tabela). Cada linha = um número/instância com: telefone, token WABA, limite diário, contador do dia, flag `ativo`, vínculo de unidade e credenciais Chatwoot. O motor de cobrança v2 (RPCs `motor_v2_*` e edge functions `motor-v2-*`) lê esta tabela para escolher de qual número disparar e para montar o payload de template Meta; o loop de disparo do n8n incrementa o contador via PostgREST.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | uuid | NO | `gen_random_uuid()` | default do banco no INSERT (registro manual/n8n) | PostgREST UPDATE `WHERE id = $2` (writer do contador, `bloco-10b` queryid 2736…); `buscar_links_resgate_pendente` expõe `d.id AS number_instance`; `motor_v2_get_disparos`/`motor_v2_relacionamento_get_disparos` selecionam `id` (`functions-analysis.json`) | confirmado |
| 2 | `numero_telefone` | text | NO | — | cadastro manual/n8n (sem default) | `motor_v2_get_disparos`, `motor_v2_relacionamento_get_disparos`, `get_pausas_vencidas`, `motor_v2_recalc_gate`, `buscar_links_resgate` (todos confirmado, `functions-analysis.json`); edges `motor-v2-planejador`/`-sortear-relacionamento` (`edge-functions.json`); índice único `idx_disparadores_numero_telefone` idx_scan=5812 | confirmado |
| 3 | `disparos_sucesso_hoje` | integer | NO | `0` | **incrementado** pelo loop de disparo via PostgREST UPDATE por `id` (`bloco-10b` queryid 2736…, 9687 calls); reset diário também por esse caminho | usado como ordenação de balanceamento: `SELECT ... ORDER BY disparos_sucesso_hoje ASC` (`bloco-10b` queryid 3910…, 1286 calls) para escolher o número menos usado; lido por `buscar_links_resgate`, `motor_v2_get_disparos` etc. | confirmado |
| 4 | `limite_diario` | integer | NO | `1000` | default 1000 / cadastro | sem consumidor **explícito** identificado; é retornado pelos `SELECT *` (queryid 3910…) e pela lógica de cap diário — **inferido-consumido** (não há reader literal por nome de coluna nas funções analisadas) | inferido (retornado em `SELECT *`, mas nenhum reader nomeado) |
| 5 | `ativo` | boolean | NO | `true` | flag de cadastro | filtro em quase todo reader: `motor_v2_get_disparos`, `_relacionamento_`, `get_pausas_vencidas`, `recalc_gate`, `buscar_links_resgate*` (`functions-analysis.json`); PostgREST `WHERE ativo IS TRUE` (queryid 3910…) e `WHERE ativo = $1` (queryid -1421…); índice `disparadores_whatsapp_unit_id_ativo_idx` idx_scan=6824 | confirmado |
| 6 | `ultima_atualizacao_contador` | timestamptz | NO | `now()` | escrita junto do contador no mesmo PostgREST UPDATE (`bloco-10b` queryid 2736…) | sem reader **explícito**; serve à lógica de reset diário (compara data) — **inferido-consumido** | inferido (escrito junto do contador; reset diário compara, mas sem reader nomeado nas funções) |
| 7 | `waba_token` | text | YES | — | cadastro/credencial WABA | `motor_v2_get_disparos`, `_relacionamento_`, `get_pausas_vencidas`, `buscar_links_resgate*` (confirmado); PostgREST `WHERE waba_token IS NOT NULL` (queryid -1421…) | confirmado |
| 8 | `unidade` | text | YES | — | rótulo textual de unidade (cadastro) | retornado no SELECT do motor (`disparadores_whatsapp.unidade` em queryid -1421…); **não** confundir com `unit_id` (FK). Reader nomeado: sem consumidor identificado por nome além do `SELECT` de payload | inferido (aparece em SELECT de payload; sem reader que use o valor por nome) |
| 9 | `chatwoot_inbox_id` | integer | YES | — | cadastro Chatwoot | **lido** por `motor_v2_relacionamento_get_disparos` (`reads.columns` confirmado, `functions-analysis.json`) — usado no payload de relacionamento | confirmado |
| 10 | `chatwoot_inbox_token` | text | YES | — | cadastro Chatwoot | sem consumidor identificado (nenhuma função/edge/n8n/view/stat o lê) | confirmado (origem cadastro); leitor: sem consumidor identificado |
| 11 | `chatwoot_account_id` | integer | YES | — | cadastro Chatwoot | sem consumidor identificado | confirmado (origem cadastro); leitor: sem consumidor identificado |
| 12 | `unit_id` | uuid | NO | — | cadastro; FK para `units` | filtro/agrupamento em todos os readers do motor (`WHERE unit_id = $1`, queryid 3910…); embed PostgREST `units:units(name)` (`edge-functions.json`); índices `_unit_id_ativo_idx` (6824), `_unit_id_idx` (618) | confirmado |
| 13 | `waba_id` | text | YES | — | cadastro WABA (Graph) | `motor_v2_get_disparos`, `_relacionamento_` (reads confirmado); `record_meta_account_event` resolve `unit_id` por subselect em `waba_id` (`functions-analysis.json`); PostgREST `WHERE waba_id IS NOT NULL` (queryid -1421…) | confirmado |

Sem gaps de ordinal (1–13 contínuas) → **nenhuma coluna droppada**. Nenhuma coluna com espaço no nome. Posições 7–13 (`waba_token`, `unidade`, `chatwoot_*`, `unit_id`, `waba_id`) são acréscimos posteriores ao núcleo original (1–6), mas sem buracos de ordinal.

## Relacionamentos (FKs)

- **Saindo:** `disparadores_whatsapp.unit_id → units.id` (`disparadores_whatsapp_unit_id_fkey`, ON DELETE/UPDATE = `a`/NO ACTION). `bloco-03`.
- **Entrando:** nenhuma tabela referencia esta. `waba_id`/`numero_telefone` são chaves naturais usadas por subselects (`record_inbound_message`, `record_meta_account_event`) mas **sem FK física**.

## Índices

| índice | def (resumo) | único | idx_scan | bytes | situação |
|--------|--------------|-------|----------|-------|----------|
| `disparadores_whatsapp_pkey` | UNIQUE (`id`) | sim (PK) | 9687 | 16 kB | **em uso** (UPDATE do contador por id) |
| `disparadores_whatsapp_unit_id_ativo_idx` | (`unit_id`, `ativo`) | não | 6824 | 16 kB | **em uso** (seleção do motor) |
| `idx_disparadores_numero_telefone` | UNIQUE (`numero_telefone`) | sim | 5812 | 16 kB | **em uso** (lookup por telefone) |
| `disparadores_whatsapp_unit_id_idx` | (`unit_id`) | não | 618 | 16 kB | em uso (parcialmente redundante com o composto) |
| `idx_disparadores_chatwoot_inbox_id` | UNIQUE (`chatwoot_inbox_id`) | sim | 0 | 16 kB | **NUNCA USADO** |

### Índices nunca usados (idx_scan=0)

- `idx_disparadores_chatwoot_inbox_id` (UNIQUE em `chatwoot_inbox_id`) — **16 kB** desperdiçados. Desperdício total: **~16 kB** (irrelevante em MB, mas o índice único impõe custo de manutenção em cada UPDATE da linha e bloqueia `chatwoot_inbox_id` duplicado sem que ninguém faça lookup por ele).

**Distinção precisa:** `chatwoot_inbox_id` **é lido** (por `motor_v2_relacionamento_get_disparos`), mas seu **índice único nunca é scaneado** — porque a leitura chega via `unit_id`/`ativo`, não por lookup direto `WHERE chatwoot_inbox_id = ?`. Coluna usada ≠ índice usado.

**Redundância parcial:** `disparadores_whatsapp_unit_id_idx` (só `unit_id`) é prefixo de `disparadores_whatsapp_unit_id_ativo_idx` (`unit_id`, `ativo`); o composto já cobre buscas por `unit_id`. Os 618 scans do simples poderiam migrar para o composto — candidato a DROP do simples.

## Triggers

Nenhuma (`bloco-06-triggers.json` vazio). O reset diário de `disparos_sucesso_hoje` **não** é por trigger — é feito pelo mesmo caminho PostgREST UPDATE (lógica no n8n/edge), comparando `ultima_atualizacao_contador`.

## RLS / Policies

RLS **ligado** (rls_on=true, rls_forced=false). 1 policy, **sem duplicatas**:

- `Only admins can manage disparadores_whatsapp` — PERMISSIVE, role `authenticated`, cmd **ALL**, qual e with_check = `has_role(auth.uid(), 'admin'::app_role)`. (`bloco-09`)

Apenas admins (UI) podem ler/escrever via cliente autenticado. **Todo o tráfego pesado contorna a RLS:** o UPDATE do contador (9687 calls), os SELECTs do motor (queryids 3910…/-1421…) e as RPCs `motor_v2_*` rodam via **service role** (edges) ou **SECURITY DEFINER** (a maioria das RPCs; exceção: `motor_v2_get_disparos` que é `security_definer=false` e depende do search_path/role do chamador). A policy governa só a gestão pela UI admin.

## Quem escreve / Quem lê

**Escreve:**
- **PostgREST UPDATE por `id`** (loop de disparo do n8n): `SET disparos_sucesso_hoje = ..., ultima_atualizacao_contador = ... WHERE id = $2`. 9687 calls, mean 0,09 ms (`bloco-10b` queryid 2736…). É o write dominante e bate com n_tup_upd=9687. Cobre incremento por disparo + reset diário.
- Cadastro de números (INSERT) não aparece na janela (n_tup_ins=0) — feito manualmente/fora da janela.

**Lê (consumidores confirmados):**
- RPCs: `motor_v2_get_disparos` (núcleo do disparo v2), `motor_v2_relacionamento_get_disparos`, `motor_v2_recalc_gate`, `get_pausas_vencidas`, `buscar_links_resgate`, `buscar_links_resgate_pendente`, `record_inbound_message` (resolve `unit_id` por `numero_telefone`), `record_meta_account_event` (resolve `unit_id` por `waba_id`/`numero_telefone`). (`functions-analysis.json`, confirmado)
- Edge functions: `motor-v2-planejador`, `motor-v2-sortear-relacionamento`, `motor-v2-fechamento` (SELECT de `numero_telefone`/`ativo`/`unit_id`, embed `units:units(name)`). (`edge-functions.json`, confirmado)
- PostgREST SELECTs: balanceamento por `disparos_sucesso_hoje ASC WHERE unit_id AND ativo` (queryid 3910…, 1286 calls); payload `WHERE ativo AND waba_id NOT NULL AND waba_token NOT NULL` (queryid -1421…, 78 calls).

## Observações

1. **COMMENT desatualizado vs schema (achado):** o COMMENT da tabela só fala em *"números... e controlar seus limites diários"* — silencia sobre as colunas posições 7–13 (`waba_token`, `unidade`, `chatwoot_inbox_id/_token/_account_id`, `unit_id`, `waba_id`), que são acréscimos posteriores. Os COMMENTs de coluna existem só para `disparos_sucesso_hoje`, `limite_diario` e `ativo`. Não há gaps de ordinal → nenhuma coluna foi droppada; as 7 últimas simplesmente foram adicionadas sem atualizar o COMMENT da tabela.

2. **Write-amplification:** 9687 UPDATEs sobre 21 linhas na janela. Cada UPDATE toca a linha inteira (PostgREST faz `UPDATE ... SET ... WHERE id`), e cada índice único (`pkey`, `numero_telefone`, `chatwoot_inbox_id`) precisa ser mantido — incluindo o `chatwoot_inbox_id` que **ninguém usa para lookup**. n_dead_tup=37 sem VACUUM manual. Em volume real (disparos/dia), isso é hot-row churn.

3. **Colunas Chatwoot semi-mortas:** das 3 colunas Chatwoot, só `chatwoot_inbox_id` tem leitor (`motor_v2_relacionamento_get_disparos`). `chatwoot_inbox_token` e `chatwoot_account_id` estão **sem consumidor identificado** — provável integração Chatwoot legada/parcial. Não classificar como mortas sem confirmar fora da janela de stat.

4. **`unidade` (text) vs `unit_id` (uuid):** coexistem; `unit_id` é a FK canônica e o eixo de todos os filtros do motor. `unidade` é rótulo textual herdado, aparece em payloads de SELECT mas sem reader que use o valor por nome — redundante com `units.name` (que o motor já busca via embed `units:units(name)`).

5. **`motor_v2_get_disparos` não é SECURITY DEFINER:** diferente das outras RPCs `motor_v2_*` (`functions-analysis.json`, `security_definer=false`). Depende do `search_path=public` e do papel do chamador (service role da edge `motor-v2-planejador`) para enxergar `disparadores_whatsapp`. Frágil se chamado por outro contexto.

6. **Sem contradição doc↔banco material** nesta tabela: `docs/03-database.md` e CLAUDE.md a descrevem corretamente como registry n8n sem `phone_number_id` da Graph (por isso o CHAT-CDT criou `chat_phone_numbers`, `0001_init.sql` linhas 37–38). Confirmado: `phone_number_id` da Graph **não** é coluna desta tabela.
