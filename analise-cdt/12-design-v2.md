# 12 — Desenho do schema v2 (núcleo de cobrança)

> **Escopo:** o núcleo de cobrança — as god-tables `clientes_cobranca_setembro`/`clientes_cobranca_dashboard`, com os anexos `pagamentos`/`links_pagamentos_gerados` e o motor v2 — mais os modelos transversais (dinheiro, tenancy/RLS, naming, auditoria). **O CHAT-CDT, auth e telemetria ficam como estão.**
>
> **Postura:** migração **aditiva expand/contract** num banco compartilhado com o n8n em **produção**. O n8n e as edge functions continuam lendo/escrevendo **as mesmas interfaces** (nomes de tabela/coluna via PostgREST, URLs de RPC, chave `matricula`) durante toda a transição. Nada de big-bang.
>
> **Formato:** explicativo + DDL concreto. Cada decisão rastreia o achado que a motiva (`§` referenciam `08`/`09`/`10` e `02-tabelas/*`).
>
> **Origem do desenho:** painel de 3 abordagens + 2 juízes (`raw/v2-panel.json`). Vencedor **8.5/8.5**: tabela canônica única (MINIMALISTA) + enxertos obrigatórios de CQRS (disciplina de ledger) e CICLO (hot/cold, `saida_at`).
>
> ⚠️ **Pré-requisito político:** esta é a abordagem que **mais "toca" nas tabelas do n8n** (transforma-as em views). O `CLAUDE.md` proíbe alterar tabelas do n8n → **exige sinal verde explícito do Victor e janela coordenada com o n8n.** Hoje o sync da planilha está em `DRY_RUN`/`inactive` (`09` §⚠️), o que ajuda a migrar a frio o escritor mais complexo, mas o cutover dos escritores **vivos** (register_payment, edges, PATCH do n8n) precisa de coordenação.

---

## 1. Princípios (cada um rastreia um achado)

| # | Princípio | Achado que motiva |
|---|---|---|
| **P1** | **Verdade única.** Um caso de cobrança = 1 linha. Acaba a duplicação `setembro`×`dashboard` e a classe de bug "existe num, não no outro / mirror não disparou". | `08` §1.3, `10`/P4 |
| **P2** | **Ledger intocado.** `pagamentos` continua sendo a única fonte de verdade de pagamento/reembolso/baixa; o caso carrega só uma **projeção single-write**. | `02-tabelas/pagamentos.md`, `register_payment` (tripla-escrita hoje) |
| **P3** | **Contrato congelado na borda.** n8n/edge não mudam **uma linha**: mesmos nomes de tabela/coluna, mesma chave `matricula`, mesmas URLs de RPC. | `CLAUDE.md`, `04-n8n-contract` |
| **P4** | **Dinheiro explícito em centavos.** Não converter (todos os leitores dividem por 100); corrigir o COMMENT e nomear `*_centavos`. | `02-tabelas/pagamentos.md`, `04-views.md` |
| **P5** | **Nomes limpos na base, legado na borda.** `snake_case` na tabela; a view re-aliaseia para `"forma de pagamento"`/`"disparado com sucesso"`. | `02-tabelas/clientes_cobranca_dashboard.md` |
| **P6** | **RLS sã.** 1 policy por comando, unit-scoped, helpers embrulhados em `(SELECT …)`, views `security_invoker`. | `10`/A2,A4,M5,P1 |
| **P7** | **Higiene de índice.** Recriar só os índices vivos; descartar ~548 MB mortos. | `10`/P3 |
| **P8** | **Migração reversível por fase.** Expand → backfill → dual-write → cutover → contract, com rollback a cada etapa. | banco vivo |

---

## 2. O que fica **CONGELADO** (superfície de contrato do n8n)

Estes itens **não mudam** — são o contrato que o n8n e as edges enxergam:

- Os **nomes** `clientes_cobranca_setembro` e `clientes_cobranca_dashboard` (passam a ser **views**, não tabelas).
- **Todas as colunas que o n8n escreve por PATCH**, inclusive os nomes com espaço (`"forma de pagamento"`, `"disparado com sucesso"`) — re-aliasados na view.
- A **chave única em `matricula` sozinha** (o n8n faz `PATCH ?matricula=eq.` **sem** `unit_id`; fortalecer para `(matricula,unit_id)` mudaria o single-row PATCH). Ver `§7.0` (validação obrigatória da premissa).
- As **URLs de RPC**: `sync_cobranca_v2`, `register_payment`, `mark_refund_by_correlation`, `get_phone_pending_debts`, `agent_block_customer`, `agent_pause_customer`, etc. — **assinatura idêntica**, só o **corpo** é reescrito.
- `pagamentos` e `links_pagamentos_gerados` permanecem **tabelas canônicas** (só corrigem COMMENT e índices) — são anexos do núcleo, já bem-modeladas.
- O bucket `chat-media`, as tabelas `chat_*`, auth/tenant e a telemetria WABA: **fora de escopo.**

---

## 3. A tabela canônica `public.cobranca_casos`

**A ideia.** `setembro` (lista-viva, ~50k, DELETE-físico) e `dashboard` (histórico, ~95k, `bi_atual`) são o **mesmo objeto de negócio** — um caso de inadimplência por matrícula — sob dois ângulos: *"está ativo agora?"* e *"já passou por aqui?"*. Colapsam numa só tabela onde **`saida_at IS NULL` substitui simultaneamente** a presença física em `setembro` e o `bi_atual=true` do dashboard. O trigger síncrono `mirror_disparo_fields_to_dashboard` (~18 colunas espelhadas a cada UPDATE sobre 1,8 GB) **deixa de ter o que espelhar** e é removido.

**Layout hot/cold (enxerto CICLO).** As colunas quentes (cadastro + cadência, escritas a alta frequência pelo motor) vêm primeiro; o **domínio frio de pagamento** (escrito ~1×/caso por `register_payment`) vai ao **final da tupla**, pronto para extração 1:1 em `cobranca_casos_pagamento` **se** medições de HOT-update mostrarem regressão.

```sql
-- =========================================================================
-- v2 — tabela canônica do núcleo de cobrança (EXPAND: criada vazia)
-- =========================================================================
create table public.cobranca_casos (
  -- ---- identidade / cadastro (quente) ----
  id_caso        bigint generated always as identity primary key,
  matricula      text        not null,
  unit_id        uuid        not null references public.units(id),
  name           text,
  whatsapp       text,                         -- E.164 (55+DDD+9...)
  regua          text,
  status         text        not null default 'novo',
  forma_pagamento text,                        -- era "forma de pagamento" (com espaço)
  valor_inadimplente_centavos numeric not null default 0,  -- CENTAVOS (P4)

  -- ---- presença / ciclo de vida (substitui DELETE-físico + bi_atual) ----
  saida_at       timestamptz,                  -- NULL ⟺ ativo ⟺ em "setembro" ⟺ bi_atual=true
  saida_motivo   text,                         -- 'sumiu_da_planilha' | 'pagamento_feito' | NULL
  entrou_em      timestamptz not null default now(),

  -- ---- engajamento (quente) ----
  respondeu              boolean not null default false,
  data_resposta          timestamptz,
  reengajamento_30_min   boolean not null default false,
  data_ultima_mensagem_ts timestamptz,         -- UNIFICA data_ultima_mensagem(TEXT) + _temp(timestamptz)
  data_ultimo_disparo    date,
  disparos               numeric not null default 0,
  disparos_equipe        numeric not null default 0,
  disparado_com_sucesso  boolean not null default false,  -- era "disparado com sucesso"

  -- ---- máquina de cadência (motor v2, quente) ----
  cadence_fase           text,
  cadence_dia_ciclo      int,
  cadence_slot           int,
  cadence_variante       int,
  cadence_proximo_envio_at timestamptz,
  cadence_ultimo_template  text,
  cadence_branch_state   text,
  cadence_entrou_em      timestamptz,
  regua_at_entry         text,
  slots_enviados_hoje    int,
  slots_enviados_hoje_data date,
  last_inbound_at        timestamptz,
  last_resgate_ia_at     timestamptz,           -- SEM writer hoje → candidata a DROP no CONTRACT; NÃO é o resgate_at

  -- ---- bloqueio / pausa / resgate (domínio só-setembro, morno) ----
  bloqueio_disparos      boolean not null default false,
  motivo_bloqueio        text,
  bloqueado_em           timestamptz,
  bloqueio_contexto      text,
  disparos_pausados_ate  date,                  -- TIPO CONGELADO: é date no legado, NÃO timestamptz
  pausa_motivo           text,
  pausa_data_prometida   date,
  pausa_registrada_em    timestamptz,
  resgate_link           boolean not null default false,
  resgate_at             timestamptz,           -- RESGATE-IA-3h: ESCRITO por PATCH do n8n ('Marcar Em Conversa'). ≠ resgate_link, ≠ last_resgate_ia_at

  -- ---- PROJEÇÃO de pagamento (FRIO; ledger = pagamentos; single-write) ----
  pagamento_feito        boolean not null default false,
  data_pagamento         timestamptz,
  plataforma_pagamento_utilizada text,
  link_pagamento         text,
  link_pagamento_enviado boolean not null default false,
  correlation_id         text,
  hora_link_gerado       timestamptz,
  baixa_realizada        boolean not null default false,
  baixa_realizada_at     timestamptz,
  baixa_realizada_by     text,
  reembolso_realizado    boolean not null default false,
  reembolso_realizado_at timestamptz,
  reembolso_motivo       text,
  reembolso_realizado_by text,

  -- ---- auditoria ----
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,

  -- CHAVE CONGELADA: matricula SOZINHA (PATCH do n8n por ?matricula=eq.) — §2/§7.0
  constraint cobranca_casos_matricula_key unique (matricula)
);

comment on table  public.cobranca_casos is
  'v2: caso de inadimplência canônico (1 linha/matrícula). saida_at IS NULL = ativo (lista-viva do motor); !=NULL = arquivado (histórico). Substitui clientes_cobranca_setembro+dashboard, que agora são views de compat.';
comment on column public.cobranca_casos.valor_inadimplente_centavos is
  'Valor em CENTAVOS (não reais). Leitores dividem por 100. Corrige o COMMENT mentiroso do schema legado.';
comment on column public.cobranca_casos.pagamento_feito is
  'PROJEÇÃO single-write do ledger public.pagamentos (escrita por register_payment). pagamentos é a verdade; aqui é só leitura quente do picker.';
```

> **Sobre `baixa_*`/`reembolso_*` na canônica (nuance do enxerto P2):** o **ledger é `pagamentos`** — a verdade de cada pagamento/estorno vive lá, imutável. As colunas `baixa_*`/`reembolso_*` aqui são **projeção fria single-write** (escritas **uma vez** por `register_payment`/`mark_refund_by_correlation`, que já tocam o ledger), **não** uma segunda fonte de verdade. Ficam no fim da tupla (frio) e existem só para o **read-compat** da view `dashboard` (consumidores legados as leem de lá) e para evitar um JOIN na view quente. Se a densidade quente regredir, este bloco inteiro migra para `cobranca_casos_pagamento (id_caso PK, FK)` sem mudar a borda.

---

## 4. As views de compat (`security_invoker`)

`setembro` e `dashboard` **renascem como views** sobre a canônica. O `bi_atual` deixa de ser coluna armazenada e vira a **expressão** `(saida_at IS NULL)` — consistente por construção (enxerto CICLO: `saida_at` em vez de só boolean).

```sql
-- LISTA-VIVA: o que o motor cobra agora  (= WHERE saida_at IS NULL)
create view public.clientes_cobranca_setembro
  with (security_invoker = true) as          -- P6: roda como o chamador → RLS aplica
select
  id_caso                       as id,
  matricula, name, whatsapp, regua, status, unit_id,
  valor_inadimplente_centavos   as valor_inadimplente,   -- alias devolve o nome legado
  forma_pagamento               as "forma de pagamento", -- P5: re-aliaseia o espaço
  disparado_com_sucesso         as "disparado com sucesso",
  data_ultima_mensagem_ts       as data_ultima_mensagem_temp, -- coluna viva legada
  cadence_fase, cadence_dia_ciclo, cadence_slot, cadence_variante,
  cadence_proximo_envio_at, cadence_ultimo_template, cadence_branch_state,
  cadence_entrou_em, regua_at_entry, slots_enviados_hoje, slots_enviados_hoje_data,
  bloqueio_disparos, motivo_bloqueio, bloqueado_em, bloqueio_contexto,
  disparos_pausados_ate, pausa_motivo, pausa_data_prometida, pausa_registrada_em,
  respondeu, reengajamento_30_min, data_resposta, last_inbound_at,
  resgate_at, resgate_link, last_resgate_ia_at,           -- resgate_at é o escrito pelo n8n
  disparos, disparos_equipe, data_ultimo_disparo,
  pagamento_feito, data_pagamento, plataforma_pagamento_utilizada,
  link_pagamento, link_pagamento_enviado, correlation_id, hora_link_gerado,
  created_at, updated_at, created_by, updated_by
from public.cobranca_casos
where saida_at is null;

-- HISTÓRICO/DASHBOARD: tudo, com bi_atual derivado  (sem filtro)
create view public.clientes_cobranca_dashboard
  with (security_invoker = true) as
select
  id_caso                       as id,
  matricula, name, whatsapp, regua, status, unit_id,
  valor_inadimplente_centavos   as valor_inadimplente,
  forma_pagamento               as "forma de pagamento",
  disparado_com_sucesso         as "disparado com sucesso",
  (saida_at is null)            as bi_atual,             -- expressão, não coluna
  data_ultima_mensagem_ts::text as data_ultima_mensagem,      -- PRESERVA o tipo TEXT do contrato (chat_debtor_context lê como text)
  data_ultima_mensagem_ts       as data_ultima_mensagem_temp,
  respondeu, data_resposta, reengajamento_30_min,
  data_ultimo_disparo, disparos, disparos_equipe,
  cadence_fase, cadence_dia_ciclo, cadence_slot,
  pagamento_feito, data_pagamento, plataforma_pagamento_utilizada,
  link_pagamento, link_pagamento_enviado, correlation_id, hora_link_gerado,
  baixa_realizada, baixa_realizada_at, baixa_realizada_by,
  reembolso_realizado, reembolso_realizado_at, reembolso_motivo, reembolso_realizado_by,
  created_at, updated_at, created_by, updated_by
from public.cobranca_casos;
```

**Por que `INSTEAD OF` (e por que mínimo).** Uma view de 1 tabela com colunas que são **referências simples** (mesmo renomeadas por alias) é *auto-updatable* no Postgres. Mas aqui temos três coisas que **quebram** a auto-atualização e exigem `INSTEAD OF`:
1. **Soft-delete:** o `DELETE` legado em `setembro` precisa virar `UPDATE … SET saida_at = now()` — semântica diferente.
2. **Colunas-expressão:** `bi_atual = (saida_at IS NULL)` e as duas colunas `data_ultima_mensagem*` que mapeiam para **uma** coluna física.
3. **Cobertura explícita** do conjunto de colunas que o n8n/edge realmente escrevem por PATCH (abaixo), para que **nenhuma escrita se perca em silêncio** (risco nº 1 — `§8`).

```sql
-- INSTEAD OF para o DELETE-físico legado de setembro (vira soft-delete)
create function public.tg_setembro_compat_delete() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Esta fn é SECURITY DEFINER e faz UPDATE direto na base → BYPASSA a RLS.
  -- Logo a regra legada "só admin apaga" TEM de ser reimposta aqui (senão o gating
  -- vira só o GRANT de DELETE da view). Replicar o predicado da policy de DELETE.
  if not public.has_role((select auth.uid()), 'admin') then
    raise exception 'apenas admin pode apagar (soft-delete) casos de cobrança'
      using errcode = '42501';
  end if;
  update public.cobranca_casos
     set saida_at = now(),
         saida_motivo = case when old.pagamento_feito then 'pagamento_feito'
                             else 'sumiu_da_planilha' end,
         updated_at = now()
   where id_caso = old.id;        -- RETURNING continua projetável p/ cobranca_clientes_removidos
  return old;
end $$;
-- Travar o acesso de escrita da view ao conjunto certo de roles (revoke DELETE de authenticated
-- se a intenção for admin-only; o INSTEAD OF acima é a segunda barreira).
create trigger setembro_compat_del instead of delete on public.clientes_cobranca_setembro
  for each row execute function public.tg_setembro_compat_delete();

-- INSTEAD OF UPDATE/INSERT: mapear coluna-a-coluna o conjunto PATCH conhecido
-- (data_ultima_mensagem_temp→ts, "forma de pagamento"→forma_pagamento,
--  "disparado com sucesso"→disparado_com_sucesso, respondeu, last_inbound_at,
--  cadence_branch_state, link_pagamento, status, bi_atual→saida_at, ...).
-- Corpo gerado a partir do INVENTÁRIO de colunas PATCH (raw/edge-functions.json
-- + raw/n8n-workflows.json) — ver §5 e o checklist §7.0.
```

> **Importante (lacuna de evidência):** o inventário **exato** das colunas que cada PATCH PostgREST escreve foi extraído de `raw/edge-functions.json` + `raw/n8n-workflows.json`, mas é a peça que, se incompleta, causa **perda silenciosa de escrita**. Por isso o **shadow-compare por coluna** durante o dual-write (`§7`) é a rede de segurança obrigatória — não confiar só na enumeração estática.

---

## 5. Writer-split — a decisão make-or-break

Dois fatos do Postgres determinam tudo: **`FOR UPDATE SKIP LOCKED`** e **`INSERT … ON CONFLICT (matricula)`** **não atravessam** uma view com `INSTEAD OF`. Logo, separamos os escritores:

| Escritor | Tipo | v2 |
|---|---|---|
| `sync_cobranca_v2`, `sync_cobranca_batch` | RPC (ON CONFLICT) | **corpo reescrito** → alveja `cobranca_casos`; assinatura/URL idênticas |
| `register_payment`, `mark_refund_by_correlation` | RPC (ON CONFLICT, escreve setembro+dashboard hoje) | **corpo reescrito** → escreve o ledger `pagamentos` **e** a projeção em `cobranca_casos` (single-write) |
| `picker_select_batch` | RPC (SKIP LOCKED) | **corpo reescrito** → `cobranca_casos` direto |
| `advance_cadence_state`, `agent_block_customer`, `agent_pause_customer` | RPC | **corpo reescrito** → `cobranca_casos` |
| `batch_update_disparo_outcomes`, `cron_clear_expired_pause`, `cron_unblock_expired` | RPC/cron (UPDATE simples) | **corpo reescrito** → `cobranca_casos` (UPDATE simples *sobreviveria* via INSTEAD OF, mas reescrever evita depender do mapa; `batch_update_disparo_outcomes` é hot-path) |
| `limpar_links_pagamento_expirados` ⚠️ | cron (hoje `secdef=false`, `search_path=null`) | **corpo reescrito** → `cobranca_casos` **e** tornar `security definer set search_path=public,pg_temp` — senão, sob view `security_invoker`, roda com a RLS do principal do cron e vira **no-op silencioso** |
| `sync_data_ultimo_disparo_from_message_log` | trigger fn | **reescrita** → `cobranca_casos` |
| `guard_recent_payment_setembro` + `_dashboard` | triggers | **consolidados em 1** guard sobre `cobranca_casos` que reconstrói o flag de 48h a partir de `pagamentos` (P2) |
| `mirror_disparo_fields_to_dashboard` | trigger | **removido** (não há o que espelhar) |
| `rollback_sync` | RPC | **reescrita** + corrige o bug de escopo cross-matrícula (`09` §6: filtrar por `unit_id = X AND matricula IN backup-da-unidade`) e **versiona** `cobranca_sync_backup.row_data` |
| **PATCH direto do n8n** (`?matricula=eq.` **e `?whatsapp=eq.`**) | PostgREST UPDATE (`cadence_branch_state`, `last_inbound_at`, **`resgate_at`**, `data_ultima_mensagem_temp`, `respondeu`) | cai na **view** → `INSTEAD OF` mapeia p/ base; **cobrir também os updates whatsapp-keyed** (2.828 calls) |
| **edges de gateway** (`generate-payment-link[-abacate]`, `*-webhook`) | PostgREST `.update()` em **`setembro`+`dashboard`** (`link_pagamento*`, `correlation_id`, `plataforma…`, `hora_link_gerado`, `pagamento_feito`) | caem na **view** → `INSTEAD OF` **deve cobrir essas colunas** (senão links param de ser marcados). `links_pagamentos_gerados` em si **não muda** |

> **A garantia "n8n não muda" é só na borda HTTP/RPC.** Internamente, reescrevo ~9 corpos de função. O blast-radius interno é grande: um corpo que **esqueça** de alvejar a base e caia na view falha **em runtime no caminho mais quente do motor** (SKIP LOCKED/ON CONFLICT), não em deploy. → dry-run + dual-read obrigatórios antes do cutover (`§7`).

---

## 6. Modelos transversais

### 6.1 Dinheiro (centavos) — P4
Mantém a **escala em centavos** (converter quebraria silenciosamente `chat_debtor_context` e todos os leitores que dividem por 100). Só muda o **nome** (`*_centavos`) e o **COMMENT**. As views devolvem o nome legado por alias. Mesma regra para `pagamentos.valor` (só corrigir COMMENT — `04-views.md`).

### 6.2 Tenancy / RLS — P6 (resolve A2, A4, M5, P1)
Uma **policy por comando**, unit-scoped. Embrulhar em `(SELECT …)` vira *InitPlan* (1×/query) **apenas** para chamadas de **argumento constante na query** — `(select auth.uid())` e `has_role(<uid>,'admin')` — e é isso que mata o grosso dos 90,6M seq_scan de `user_roles` (`10`/P1). **Atenção (correção):** `user_has_access_to_unit(unit_id)` é **correlacionado por linha** (depende de `unit_id`), então o `(SELECT …)` é cosmético e ele continua avaliado **per-row**; mitigar trocando por um teste de pertencimento sobre um array pré-carregado: `unit_id = any ((select public.chat_my_units()))`. As views são `security_invoker` → a RLS da base se aplica (sem o leak A4). **Preservar o papel `collections_agent`**, que hoje lê/atualiza o dashboard inteiro — removê-lo das policies mudaria o contrato de acesso em silêncio.

```sql
alter table public.cobranca_casos enable row level security;

-- predicado de leitura/escrita: unidade do usuário OU papel global (admin/collections_agent)
create policy casos_select on public.cobranca_casos for select to authenticated
using (
  unit_id = any ((select public.chat_my_units()))                       -- per-query, não per-row
  or (select public.has_role((select auth.uid()), 'admin'))
  or (select public.has_role((select auth.uid()), 'collections_agent')) -- preserva o papel atual
);
create policy casos_insert on public.cobranca_casos for insert to authenticated
with check (
  unit_id = any ((select public.chat_my_units()))
  or (select public.has_role((select auth.uid()), 'admin'))
);
create policy casos_update on public.cobranca_casos for update to authenticated
using (
  unit_id = any ((select public.chat_my_units()))
  or (select public.has_role((select auth.uid()), 'admin'))
  or (select public.has_role((select auth.uid()), 'collections_agent'))
);
create policy casos_delete on public.cobranca_casos for delete to authenticated
using ( (select public.has_role((select auth.uid()), 'admin')) );

-- nada de policy qual=true (A2): sem a "Authenticated users can read" que vazava cross-unidade.
-- GRANTs explícitos: com security_invoker=true, o invocador precisa de privilégio na BASE,
-- senão as views retornam "permission denied" mesmo com a RLS correta.
grant select, insert, update, delete on public.cobranca_casos to authenticated;
grant select, insert, update, delete on public.clientes_cobranca_setembro to authenticated;
grant select, insert, update, delete on public.clientes_cobranca_dashboard to authenticated;
-- helpers com search_path fixo (M1):
alter function public.user_has_access_to_unit(uuid) set search_path = public, pg_temp;
alter function public.has_role(uuid, app_role)      set search_path = public, pg_temp;
alter function public.chat_my_units()               set search_path = public, pg_temp;
```

### 6.3 Naming — P5
`snake_case` na base; as views re-aliaseiam `"forma de pagamento"` e `"disparado com sucesso"` (e `data_ultima_mensagem*`) para preservar o contrato PostgREST.

### 6.4 Auditoria / projeção de pagamento — P2
`pagamentos` = **ledger imutável** (intocado, só COMMENT). `register_payment` reescrito faz **uma** escrita de projeção (`pagamento_feito`/`data_pagamento`/`plataforma`) em `cobranca_casos`, em vez da tripla-escrita atual. O guard de 48h reconstrói o flag **a partir do ledger** → projeção nunca diverge da verdade. `event_log` (append-only) e os logs `*_sync_log`/`*_import_log` ficam como estão.

### 6.5 Índices — P7 (descarta ~548 MB mortos)
Recriar **só os vivos** (validados em janela longa — `§7.0`):

```sql
-- chave + lookups quentes confirmados (idx_scan alto no laudo)
create unique index cc_matricula_key   on public.cobranca_casos (matricula);
create index cc_unit_matchkey on public.cobranca_casos (unit_id, public.chat_phone_match_key(whatsapp)); -- recria idx_ccd_unit_matchkey (0013), lido pelo inbox
create index cc_picker on public.cobranca_casos (unit_id, cadence_proximo_envio_at)
  where saida_at is null and not bloqueio_disparos and not pagamento_feito;       -- picker
create index cc_unit_regua on public.cobranca_casos (unit_id, regua) where saida_at is null;
create index cc_whatsapp on public.cobranca_casos (whatsapp);
create index cc_hora_link on public.cobranca_casos (hora_link_gerado);
-- NÃO recriar: idx_dashboard_disparos_equipe (109MB), os 2 unit_id duplicados,
--   regua_idx/status_idx/data_resposta/bi_atual/correlation/created_by/updated_by (idx_scan=0).
```

---

## 7. Plano de migração expand/contract (reversível)

### 7.0 — Fase 0: pré-flight (bloqueia tudo até passar)
1. **Premissa de chave.** `select matricula, count(*) from clientes_cobranca_dashboard group by 1 having count(*)>1;` — **tem de vir vazio**. Se não vier, o modelo `matricula`-só precisa ser revisto **antes** de continuar.
2. **Inventário EXATO de colunas PATCH** (a peça que falhou com `resgate_at`). Fechar a partir do **tráfego real** (`raw/bloco-10*` pg_stat) **e** de `raw/edge-functions.json` + `raw/n8n-workflows.json`, cobrindo: (a) updates **`?matricula=eq.`** *e* **`?whatsapp=eq.`** do n8n; (b) os `.update()` das **edges de gateway** em `setembro`+`dashboard` (link/correlation/plataforma/pagamento_feito); (c) a **assimetria por tabela** (`register_payment` escreve `correlation_id` no dashboard mas não no setembro, `cadence_*` no setembro mas não no dashboard). Toda coluna fora do mapa `INSTEAD OF` = **escrita perdida** (ou 400 que arrasta as colunas-irmãs do mesmo PATCH). Decidir o destino das colunas legadas sem writer claro (`semana`, `numero_semana_1/2`, `franquia`): manter físicas inertes ou confirmar 0 writers.
3. **`idx_scan` em janela LONGA.** As estatísticas do laudo são de ~13h (`10` caveat). **Não dropar índice antes de observar semanas** — um cron mensal/sazonal (fechamento) pode usar um índice hoje "morto".
4. **Sinal verde do Victor + janela com o n8n.**

### 7.1 — EXPAND (aditivo, invisível ao n8n)
- `create table cobranca_casos` (`§3`) **vazia**, RLS (`§6.2`), índices vivos (`§6.5`).
- Criar as funções/triggers v2 **desativadas/paralelas** (não plugadas ainda).

### 7.2 — BACKFILL (idempotente, re-rodável)
- **`FULL OUTER JOIN` por `matricula`** entre `dashboard` e `setembro` — **não** "carrega de um + overlay do outro" (isso descartaria matrículas que existem **só em `setembro`**, justamente a classe de bug que o P1 mata). Validar com `EXCEPT` nas duas direções no `§7.0`, não só `count`.
- **`saida_at` deriva de PRESENÇA-EM-`setembro`**, não de `dashboard.bi_atual` (os dois divergem hoje): `saida_at := null` **sse** a matrícula está em `setembro` hoje; senão, melhor estimativa de quando saiu.
- **`saida_motivo`** das ~46k linhas já saídas: derivar de `pagamento_feito` **cruzado com o ledger `pagamentos`** (não com o flag espelhado); reaproveitar `cobranca_clientes_removidos` (só ~69 linhas — cobre só remoções recentes) onde houver `removido_em`/`motivo`; `updated_at` como estimativa só para o bulk antigo.
- **Reconciliar** `pagamento_feito`/`data_pagamento` a partir do **ledger `pagamentos`**.
- `COALESCE(status,'novo')` (o `NOT NULL default 'novo'` da canônica vs `status` nullable no legado).

### 7.3 — DUAL-WRITE + shadow-compare (a fase perigosa)
- Espelho transitório: escrita na canônica **e** nas físicas, com `pg_advisory_xact_lock` por unidade cobrindo a canônica.
- **Shadow-compare por coluna**: comparar continuamente cada PATCH aplicado nas físicas vs. na canônica. É a rede contra o risco nº 1.
- **Dual-read**: rodar `chat_debtor_context` contra as duas fontes e comparar.

### 7.4 — CUTOVER (a ORDEM importa — corpos ANTES do swap de nome)
> ⚠️ **Hazard de ordem (corrigido):** renomear tabela→view **antes** de reescrever os corpos faz o `picker_select_batch` rodar `FOR UPDATE … SKIP LOCKED` contra uma view com `INSTEAD OF` (e `sync`/`register_payment` rodarem `ON CONFLICT`) — falha em runtime no caminho mais quente do motor. Por isso os **corpos internos vêm primeiro**.

0. **Quiescer o motor:** `update system_state set value='false' where key='cadence_enabled';` (pausa picker/planejador durante o swap).
1. **Reescrever os corpos** das funções internas (`picker_select_batch`, `sync_cobranca_v2`, `sync_cobranca_batch`, `register_payment`, `advance_cadence_state`, guards, `batch_update_disparo_outcomes`, crons, `limpar_links_pagamento_expirados`, `rollback_sync`) para alvejar **`cobranca_casos`** — enquanto os nomes físicos ainda são tabelas (sem quebrar nada).
2. `alter table clientes_cobranca_setembro rename to _legacy_setembro;` (idem `dashboard`).
3. `create view …` as duas (`security_invoker`, `GRANT`s, `INSTEAD OF` **completo** do `§7.0.2`).
4. **Re-atar à base os triggers comportamentais** que somem com o swap (views não disparam trigger de linha): `set_user_tracking` (BEFORE INS/UPD → `updated_at`/`created_by`/`updated_by`; **crítico** porque `chat_debtor_*` ordenam por `updated_at` e o cron de freshness depende dele), `trg_motor_v2_bloqueio_cliente` (AFTER UPD OF `bloqueio_disparos`,`disparos_pausados_ate`), `trg_cancel_pending_links_on_payment` (AFTER UPD OF `pagamento_feito` → cancela links). **Auditar os 7 triggers nominalmente.**
5. **Remover** `mirror_disparo_fields`; **consolidar** os guards num só.
6. **Re-apontar o trigger** `cancel_links_on_regua_valor_update` — hoje é um **trigger** (não Database Webhook; o DB-webhook homônimo foi substituído em 2026-05-27) `AFTER UPDATE OF regua, valor_inadimplente ON clientes_cobranca_setembro` → recriar `AFTER UPDATE OF regua, valor_inadimplente_centavos ON cobranca_casos`.
7. **Realtime:** adicionar `cobranca_casos` à publicação `supabase_realtime` **E inventariar subscribers** que filtram pelo **nome** `clientes_cobranca_*` — os eventos passam a vir como `cobranca_casos`; membresia da publicação não basta se algum subscriber filtra por nome (`bloco-12`; sem evidência de subscribers nos RAW → item de verificação).
8. **Religar o motor:** `cadence_enabled='true'`.

### 7.5 — CONTRACT (só após observação longa)
- `drop` das `_legacy_*`, dos índices mortos e das colunas sem writer (`cadence_variante`, `last_resgate_ia_at`, etc.) confirmadas.
- Avaliar extração do bloco frio para `cobranca_casos_pagamento` **se** o HOT-update regrediu.

**Rollback — com fronteira de não-retorno (correção):** **antes do passo 7.4.1** (corpos ainda escrevem nas físicas) o rollback é trivial: descartar `cobranca_casos`/funções v2. **Depois** que os corpos passam a escrever **só** na canônica, `rename _legacy_* back` puro **perde** toda escrita que caiu na canônica (register_payment, PATCHes do n8n, edges). Portanto, pós-7.4.1 o rollback exige um **sync reverso `cobranca_casos → _legacy_*`** (replay), não `rename`-back. Definir 7.4.1 como o **ponto-de-não-retorno barato** e manter o reverse-sync pronto e testado até a fase CONTRACT.

---

## 8. Riscos e mitigações (do painel)

| Risco | Severidade | Mitigação |
|---|---|---|
| Coluna PATCH não mapeada no `INSTEAD OF` → **escrita perdida em silêncio** | 🔴 | shadow-compare por coluna (`§7.3`); inventário `§7.0.2` |
| Esquecer `security_invoker=true` → recria o **leak cross-tenant A4** | 🔴 | invariante de cutover; teste de RLS por unidade |
| Swap tabela→view **quebra `supabase_realtime`** silenciosamente | 🔴 | adicionar `cobranca_casos` à publicação (`§7.4.6`) |
| Corpo reescrito cai na view (SKIP LOCKED/ON CONFLICT) → **falha em runtime no caminho quente** | 🔴 | dry-run + dual-read; checklist de "alveja base, não view" |
| Database Webhook `regua/valor` não dispara em view | 🟠 | recriar como trigger na base (`§7.4.5`) |
| Premissa "`matricula` globalmente única" não provada | 🟠 | validação `§7.0.1`; registrar como premissa herdada |
| Tabela larga e quente (cadência + pagamento na mesma linha) | 🟠 | hot/cold (`§3`); extração 1:1 opcional (`§7.5`) |
| `rollback_sync` arrasta outra unidade (bug `09` §6) | 🟠 | filtrar por `unit_id AND matricula-da-unidade`; versionar `row_data` |
| Dual-write bidirecional diverge sob carga | 🟠 | advisory-lock por unidade; reconciliação no backfill, não paridade assumida |

---

## 9. Fora de escopo (não muda neste v2)
- **CHAT-CDT** (`conversations`/`messages`/`contacts`/`chat_*`) — recém-modelado, limpo.
- **Auth/tenant** (`units`/`profiles`/`user_*`) — exceto o fix de RLS `(SELECT …)` que vale para todo o banco (`10`/P1), tratável em paralelo.
- **`pagamentos`/`links_pagamentos_gerados`** — permanecem canônicas (só COMMENT + higiene de índice + fix da policy `anon` de abacate, `10`/A5).
- **Telemetria WABA, templates, motor v2 de config** (`gate_*`, `cadence_*config`) — só consomem o núcleo; filhos diretos não mudam.

## 10. Checklist antes de executar
- [ ] Sinal verde explícito do Victor + janela coordenada com o n8n.
- [ ] `§7.0.1` matrícula única → vazio.
- [ ] `§7.0.2` inventário completo das colunas PATCH.
- [ ] `§7.0.3` `idx_scan` observado em janela longa (não 13h).
- [ ] Ambiente de teste/branch Supabase para ensaiar o cutover (o sync em `DRY_RUN` ajuda a ensaiar o escritor mais complexo a frio).
- [ ] Plano de rollback escrito e testado por fase (incl. **reverse-sync pós-7.4.1**).
- [ ] `INSTEAD OF INSERT/UPDATE` **materializado** a partir do inventário `§7.0.2` (não stub).
- [ ] `rollback_sync` reescrito contra a base (`ON CONFLICT … DO UPDATE SET saida_at=null`) + `row_data` versionado + testado com `sync_log_id` pré-migração.
- [ ] `secdef`/`search_path` auditados nas ~17 escritoras; 3 triggers comportamentais re-atados (`§7.4.4`).
- [ ] Subscribers de Realtime inventariados; `chat_debtor_context`/`_names` testados sobre as views `security_invoker` em branch.

> **Nota de honestidade:** este é o **desenho-alvo + plano**, não um patch pronto. Os corpos reescritos (~**17** funções-escritoras, `§5`), o `INSTEAD OF` completo (`§4`) e a re-atação dos triggers comportamentais (`§7.4.4`) são a maior parte do trabalho de implementação e dependem do inventário de colunas PATCH (`§7.0.2`) — a próxima etapa concreta.

---

## 11. Revisão adversarial (achados incorporados)

Antes de fechar, 3 céticos independentes (lentes **compat/PATCH**, **DDL/Postgres**, **ordem/quebra**) tentaram quebrar este desenho contra os consumidores reais (`raw/edge-functions.json`, `raw/n8n-workflows.json`, `raw/functions-analysis.json`, `raw/bloco-02/04/06/09`). **Veredicto unânime:** o método (expand/contract, dual-write, shadow-compare, `security_invoker`, ledger intocado) é sólido; o desenho **não estava pronto para implementar** por lacunas de cobertura e ordem. Saída crua: `raw/v2-adversarial.json` (4 bloqueia · 11 alta · 10 média · 5 baixa). Dispositions:

### Corrigido inline neste documento
| # | Achado | Sev | Onde |
|---|---|---|---|
| 1 | **`resgate_at` omitida** (escrita por PATCH vivo do n8n; confundida com `resgate_link`/`last_resgate_ia_at`). View sem a coluna → PostgREST **400 arrasta o PATCH inteiro** (`cadence_branch_state`+`last_inbound_at`). | 🔴 bloqueia | §3, §4 (canônica + view setembro) |
| 2 | **Ordem do cutover**: rename→view antes de reescrever corpos → `picker` roda `SKIP LOCKED` contra view. | 🔴 bloqueia | §7.4 (corpos primeiro; motor quiescido) |
| 3 | Censo de escritores incompleto (faltavam `batch_update_disparo_outcomes`, `cron_clear_expired_pause`, `cron_unblock_expired`, `limpar_links_pagamento_expirados`). | 🟠 | §5 |
| 4 | `limpar_links_pagamento_expirados` `secdef=false`/`search_path=null` → no-op silencioso sob view. | 🟠 | §5 |
| 5 | 3 triggers órfãos no swap (`set_user_tracking`→`updated_at`, `trg_motor_v2_bloqueio_cliente`, `trg_cancel_pending_links_on_payment`). | 🟠 | §7.4.4 |
| 6 | `INSTEAD OF DELETE` `SECURITY DEFINER` bypassa RLS → "só admin apaga" virava só GRANT. | 🟠 | §4 (gate `has_role admin`) |
| 7 | `collections_agent` removido das policies (lê/atualiza dashboard hoje). | 🟠 | §6.2 |
| 8 | Rollback pós-cutover não revertia (rename-back perde escritas na canônica). | 🟠 | §7.4 (fronteira + reverse-sync) |
| 9 | Backfill perdia linhas só-de-`setembro`; `saida_at` de `bi_atual` (divergente). | 🟠 | §7.2 (FULL OUTER + presença) |
| 10 | Tipos congelados trocados: `disparos_pausados_ate` (date), `data_ultima_mensagem` (text). | 🟡 | §3, §4 (`::text`) |
| 11 | Claim de InitPlan errada p/ `user_has_access_to_unit(unit_id)` (correlacionado per-row). | 🟡 | §6.2 (corrigido + `chat_my_units()`) |
| 12 | Faltavam `GRANT`s na base (necessários sob `security_invoker`). | 🟡 | §6.2 |
| 13 | PATCH por `?whatsapp=eq.` e writes diretos das edges nas god-tables subestimados. | 🟡 | §5, §7.0.2 |
| 14 | `reengajamento_30_min` não projetada na view setembro. | ⚪ baixa | §4 |
| 15 | Nomenclatura: `cancel_links_on_regua_valor` é trigger (não DB-webhook), em `setembro`. | ⚪ baixa | §7.4.6 |

### A resolver na IMPLEMENTAÇÃO (não no desenho) — adicionado ao checklist
- **Materializar o `INSTEAD OF INSERT/UPDATE` real** (hoje stub) a partir do inventário `§7.0.2` — é o entregável que o desenho admite adiar; o **shadow-compare por coluna** (`§7.3`) é a rede, não substituto.
- **Reescrever `rollback_sync`** contra a base: trocar `jsonb_populate_record(null::clientes_cobranca_setembro, …)` por mapeamento explícito legado→`snake_case` + `INSERT … ON CONFLICT (matricula) DO UPDATE SET saida_at=null` (reativação, não viola UNIQUE), descartando o `id` legado; **versionar `row_data`** e testar rollback de um `sync_log_id` capturado **antes** do cutover.
- **Auditar `secdef`/`search_path` de TODAS as ~17 escritoras** (não só os 2 helpers de RLS).
- **Inventariar subscribers de Realtime** que filtram por nome de tabela.
- **Testar** `chat_debtor_context`/`chat_debtor_names` (ambas `SECURITY DEFINER`) sobre as novas views `security_invoker` num branch — confirmar scoping por unidade e privilégios do owner.
