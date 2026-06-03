# message_inbound

## Identificação

- **Nome:** `public.message_inbound`
- **Dono provável:** tabela de **origem n8n** (escrita via RPC no fluxo de webhook de inbound), com camada de **leitura analítica do CHAT-CDT** (`rpc_inbound_summary`). É um caso de fronteira — ver Classificação.
- **Linhas estimadas:** ~26.235 (n_live_tup = 27.588). `bloco-01-tabelas.json`.
- **Tamanho:** 26 MB total (heap 16 MB). `bloco-01-tabelas.json`.
- **Classificação:** **Compartilhada** (julgamento). Justificativa: o caminho de **escrita** vem do fluxo de inbound do n8n (workflow "...route_inbound..." chama o RPC `record_inbound_message`, `edge-functions.json`/`n8n-workflows.json`), enquanto a única **leitura** identificada é analítica e serve o dashboard de inbound do CHAT-CDT (`rpc_inbound_summary`, `functions-analysis.json`). Não classifico como pura "n8n" nem pura "CHAT-CDT" porque o lineage cruza as duas fronteiras. Evito anclá-la em qualquer afirmação de autoria — ver Observações.
- **Bloat:** ~1.040 bytes/linha (27,3 MB / 26,2k linhas). Boa parte é índice (heap 16 MB de 26 MB) — ver "Índices nunca usados". n_dead_tup = 2, sem UPDATE/DELETE (n_tup_upd = 0, n_tup_del = 0): tabela append-only, sem bloat de MVCC. O peso está nos índices, não no heap.

## Finalidade

Registrar, 1 linha por mensagem recebida (inbound) do WhatsApp, para fins de analytics — taxa de resposta humana e volume de opt-out (COMMENT da tabela: *"Strategic Swarm Health: mensagens recebidas (inbound) pra analytics... 1 linha por mensagem, dedup por wamid"*). A inserção é idempotente por `wamid` (`record_inbound_message`, `INSERT ... ON CONFLICT (wamid) DO NOTHING`, `functions-analysis.json`). É um **sink append-only**: muito do conteúdo é gravado mas nunca relido (ver Quem lê).

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | `id` | bigint | NO | (identity/sequence do banco) | banco: coluna identity/sequence (bigint, sem default explícito no dump mas PK `message_inbound_pkey`) | sem consumidor identificado (PK nunca usada como lookup — `message_inbound_pkey` idx_scan=0, `bloco-04`); não há FK que referencie esta tabela (`bloco-03`) | inferido (origem = padrão de PK bigint; nenhum reader literal) |
| 2 | `wamid` | text | YES | — | n8n/Meta payload: extraído do payload da Graph API pelo RPC `record_inbound_message` (`writes.columns` inclui `wamid`, confiança confirmado, `functions-analysis.json`) | chave de **dedup** via `ON CONFLICT (wamid)` (`record_inbound_message`); índice `message_inbound_wamid_key` idx_scan=3796 (`bloco-04`) | confirmado (writer e uso de dedup literais) |
| 3 | `from_phone` | text | NO | — | RPC `record_inbound_message` (extrai `from` do payload Meta; `writes.columns`, confirmado) | sem consumidor identificado (nenhuma função/edge/n8n/view/stat lê `from_phone`; índice `idx_message_inbound_from` idx_scan=0) | confirmado (writer); leitor: sem consumidor identificado |
| 4 | `phone_number_id` | text | YES | — | RPC `record_inbound_message` (param `p_phone_number_id`; usado também para resolver `unit_id` por subselect em `disparadores_whatsapp`) | sem consumidor identificado como **coluna lida** após gravação (é usado *dentro* do RPC para resolver unit_id, mas o valor persistido não tem reader downstream conhecido) | confirmado (writer); leitor downstream: sem consumidor identificado |
| 5 | `unit_id` | uuid | YES | — | RPC `record_inbound_message`: resolvido por subselect em `disparadores_whatsapp` pelo `phone_number_id`/`numero_telefone` (`functions-analysis.json` notes) | `rpc_inbound_summary` (lê `unit_id` para agrupar por unidade, confirmado); RLS `health_select_message_inbound` filtra por `user_can_read_unit(unit_id)` (`bloco-09`) | confirmado |
| 6 | `type` | text | YES | — | RPC `record_inbound_message` (extrai `type` do payload Meta; `writes.columns`, confirmado) | sem consumidor identificado | confirmado (writer); leitor: sem consumidor identificado |
| 7 | `body` | text | YES | — | RPC `record_inbound_message` (extrai `body` via operadores jsonb; `writes.columns`, confirmado) | sem consumidor identificado (nenhum reader; opt-out já é pré-computado em `is_optout`) | confirmado (writer); leitor: sem consumidor identificado |
| 8 | `is_optout` | boolean | NO | `false` | RPC `record_inbound_message`: detecção de opt-out por regex sobre o body (purpose, confirmado) | `rpc_inbound_summary` (conta opt-outs por unidade, confirmado); índice parcial `idx_message_inbound_optout WHERE is_optout` (idx_scan=0, nunca usado) | confirmado |
| 9 | `received_at` | timestamptz | NO | `now()` | default `now()` no INSERT do RPC (`record_inbound_message`, `writes.columns`) | `rpc_inbound_summary` (filtro/agrupamento temporal por dia, confirmado) | confirmado |
| 10 | `raw_value` | jsonb | YES | — | RPC `record_inbound_message`: payload Meta bruto (`writes.columns`, confirmado) | sem consumidor identificado (preservação forense; nenhuma função/view/stat o relê) | confirmado (writer); leitor: sem consumidor identificado |

Sem gaps de ordinal (posições 1–10 contínuas) → **nenhuma coluna droppada**. Nenhuma coluna com espaço no nome.

## Relacionamentos (FKs)

- **Saindo:** nenhuma FK declarada (`unit_id` é uuid solto, sem constraint para `units` — `bloco-03` não lista FK da `message_inbound`).
- **Entrando:** nenhuma tabela referencia `message_inbound` (`bloco-03`).

Observação: `unit_id` é semanticamente um FK para `units`, mas sem constraint física — integridade delegada ao RPC.

## Índices

| índice | def (resumo) | único | idx_scan | bytes | situação |
|--------|--------------|-------|----------|-------|----------|
| `message_inbound_wamid_key` | UNIQUE (`wamid`) | sim | 3796 | 3,96 MB | **em uso** (dedup do INSERT) |
| `message_inbound_pkey` | UNIQUE (`id`) | sim (PK) | 0 | 639 kB | PK nunca usada como lookup |
| `idx_message_inbound_from` | (`from_phone`, `received_at DESC`) | não | 0 | 1,46 MB | NUNCA USADO |
| `idx_message_inbound_optout` | (`received_at DESC`) WHERE `is_optout` | não | 0 | 57 kB | NUNCA USADO |
| `idx_message_inbound_unit` | (`unit_id`, `received_at DESC`) | não | 0 | 1,97 MB | NUNCA USADO |
| `idx_message_inbound_unit_received` | (`unit_id`, `received_at`) | não | 0 | 1,88 MB | NUNCA USADO |

### Índices nunca usados (idx_scan=0)

Desperdício somado dos não-PK nunca usados (`from` + `optout` + `unit` + `unit_received`): **1,46 + 0,057 + 1,97 + 1,88 ≈ 5,37 MB**. Incluindo a PK `message_inbound_pkey` (também idx_scan=0, 639 kB) → ~6,0 MB de índices sem scan numa tabela de 26 MB.

**Redundância:** `idx_message_inbound_unit` (`unit_id`, `received_at DESC`) e `idx_message_inbound_unit_received` (`unit_id`, `received_at` ASC) cobrem as **mesmas colunas**, diferindo apenas na direção de ordenação — ambos nunca usados. Um dos dois é dispensável de saída; na prática `rpc_inbound_summary` não usa nenhum (faz scan filtrando por `received_at`/`unit_id` sem ter acionado estes índices na janela).

Todos os índices úteis a queries por `unit_id`/`received_at`/`from_phone` estão idx_scan=0 porque o único leitor real (`rpc_inbound_summary`) roda sobre agregações que, no volume atual, o planner resolve por seq_scan (seq_scan=1117 na tabela).

## Triggers

Nenhuma (`bloco-06-triggers.json` vazio para esta tabela). O `received_at default now()` cobre o timestamp sem trigger.

## RLS / Policies

RLS **ligado** (rls_on=true, rls_forced=false). 1 policy, **sem duplicatas**:

- `health_select_message_inbound` — PERMISSIVE, role `authenticated`, cmd **SELECT**, qual `user_can_read_unit(unit_id)`. (`bloco-09`)

Só há policy de **leitura**. Não há policy de INSERT para `authenticated` → as escritas chegam por `record_inbound_message` (SECURITY DEFINER, contorna RLS) e/ou service role do n8n. A policy governa apenas a leitura pela UI do CHAT-CDT (multi-tenant por unidade).

## Quem escreve / Quem lê

**Escreve (1 caminho):**
- RPC `record_inbound_message` (SECURITY DEFINER) — INSERT idempotente de todas as 9 colunas de payload (`id` é identity). Acionado pelo workflow n8n de inbound (nós "Parse Inbound (analytics)" / "RPC record_inbound_message", `continueOnFail=true`/`neverError=true` — blindados para não afetar o roteamento). Evidência: `functions-analysis.json` (writes confirmado), `n8n-workflows.json`, `edge-functions.json`. n_tup_ins=3791 na janela.

**Lê (1 consumidor identificado):**
- `rpc_inbound_summary` (SQL STABLE) — resumo diário por unidade (entregas/interações/opt-outs, % resposta) para o dashboard de inbound. Lê apenas `unit_id`, `is_optout`, `received_at` (confirmado, `functions-analysis.json`).
- RLS `user_can_read_unit(unit_id)` na leitura pela UI.

Não há leitor identificado para `from_phone`, `phone_number_id`, `type`, `body`, `raw_value`, `id`.

## Observações

1. **Sink write-only (achado principal):** 5 colunas de conteúdo (`from_phone`, `phone_number_id`, `type`, `body`, `raw_value`) e a PK `id` são gravadas mas **não têm leitor identificado** em nenhuma função/edge/n8n/view/stat. A tabela funciona como arquivo forense/analítico append-only; o único valor consumido é o agregado de `unit_id`/`is_optout`/`received_at` por `rpc_inbound_summary`, mais `wamid` para dedup. Não é "morta" — é um sink de retenção.

2. **Contradição doc↔banco (contagem de linhas):** `docs/03-database.md` (linha 20) diz *"`message_inbound` (11k linhas)"*; `docs/analise-banco.md` (linha 35) diz *"27 mil"*. O banco real tem ~27,5k (n_live_tup). O número novo (analise-banco.md) bate; o 03-database.md está **desatualizado** (~2,5× menor).

3. **COMMENT↔docs (natureza):** o COMMENT da tabela a descreve como analytics de "Strategic Swarm Health"; `docs/03-database.md` a rotula "inbound do webhook do n8n"; `docs/04-n8n-contract.md` (linha 97) reforça *"`message_inbound` continua sendo escrito (n8n recebe seu próprio webhook)"*. As duas visões são **complementares, não contraditórias**: origem da escrita = fluxo n8n; finalidade da leitura = analytics. Não tratar nenhum dos dois rótulos como exclusivo. (A dica de tarefa mencionando "Chatwoot" para esta tabela está **incorreta** — Chatwoot são colunas da `disparadores_whatsapp`, não desta.)

4. **Buraco de dedup:** `wamid` é `is_nullable = YES`. Logo `ON CONFLICT (wamid) DO NOTHING` **não deduplica linhas com `wamid` NULL** (NULL nunca conflita em índice único). Isso contradiz o COMMENT *"dedup por wamid / 1 linha por mensagem"* para qualquer payload sem `wamid`. `message_inbound_wamid_key.idx_tup_read=5` sugere pouquíssimos conflitos reais, mas o risco existe.

5. **`unit_id` sem FK:** semanticamente aponta para `units` mas sem constraint física (`bloco-03`). Integridade depende inteiramente do subselect em `disparadores_whatsapp` dentro do RPC.

6. **Desperdício de índice:** ~5,4 MB de índices não-PK nunca scaneados (ver seção Índices), incluindo o par redundante `idx_message_inbound_unit` / `idx_message_inbound_unit_received` (mesmas colunas, direções opostas). Candidatos a DROP se o regime de leitura permanente confirmar que `rpc_inbound_summary` não os aciona. (Ressalva: janela de stat ~13h; não é regime permanente.)

7. **Autoria não comprovada:** `record_inbound_message` e `rpc_inbound_summary` **não estão definidos** em nenhuma migration local do CHAT-CDT (`grep` em `infra/supabase/migrations/`); existem só no banco vivo. "Não estar nas migrations do CHAT-CDT" **não prova** autoria n8n nem CHAT-CDT — por isso a autoria fica **inferida**, e só o caminho de dados (n8n→RPC→tabela→summary) é **confirmado**.
