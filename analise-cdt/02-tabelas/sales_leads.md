# sales_leads

## Identificação

- **Nome:** `public.sales_leads`
- **Dono provável:** **App (domínio de vendas — feature planejada)**. Usa o sistema de auth do app (`has_role`/`app_role` com papel `sales_agent`), não o sistema do n8n. NÃO é do n8n/cobrança nem backup. Ausente das migrations de `infra/supabase/migrations/` (grep vazio) e ausente de `docs/` como tabela própria — só o papel `sales_agent` aparece em `docs/03-database.md` (enum `app_role`).
- **Linhas estimadas:** **0** (`n_live_tup=0`, `n_tup_ins=0`; bloco-01). Nunca recebeu uma linha.
- **Tamanho:** 64 kB total / heap 8192 bytes. Fonte: bloco-01.
- **Classificação:** **Morta/Backup** (valor de enum menos-errado). **Ressalva importante:** NÃO é remanescente morto — é **feature planejada-mas-não-usada**: totalmente provisionada (PK, 3 índices, trigger de `updated_at`, RLS com 4 policies, `cdt_code` default `'ibirite001'`), apenas nunca exercitada. "Vazia/futuro" descreve melhor que "morta".
- **Alerta de bloat:** nenhum (0 linhas).

## Finalidade

Tabela de CRM de leads de vendas: captura prospects (nome, email, whatsapp), trilha de funil (`status`, `origem`, `valor_potencial`) e marcos temporais (`data_clique`, `data_interacao`, `data_fechamento`). Multi-unidade por `cdt_code` (default `'ibirite001'`). Destinada a ser lida/escrita por usuários com papel `admin` ou `sales_agent`. Hoje está provisionada mas inativa — nenhum writer ou reader identificado em qualquer fonte de consumo.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default do banco | **sem consumidor identificado** | **confirmado** (default no bloco-02) |
| 2 | cdt_code | text | NO | `'ibirite001'::text` | default do banco / app | **sem consumidor identificado** (índice `idx_sales_leads_cdt_code` idx_scan=0) | **confirmado** default; consumidor inferido (ausente) |
| 3 | name | text | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** (sem leitor/escritor) |
| 4 | email | text | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** |
| 5 | whatsapp | text | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** (nome genérico, sem prova) |
| 6 | status | text | YES | — | app (futuro) | **sem consumidor identificado** (índice `idx_sales_leads_status` idx_scan=0) | **inferido** (nome genérico) |
| 7 | origem | text | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** |
| 8 | valor_potencial | numeric(10) | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** |
| 9 | data_interacao | timestamptz | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** |
| 10 | data_clique | timestamptz | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** |
| 11 | data_fechamento | timestamptz | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** |
| 12 | observacoes | text | YES | — | app (futuro) | **sem consumidor identificado** | **inferido** |
| 13 | created_at | timestamptz | NO | `now()` | default do banco | **sem consumidor identificado** | **confirmado** default |
| 14 | updated_at | timestamptz | NO | `now()` | default + trigger `update_sales_leads_updated_at` (BEFORE UPDATE) | **sem consumidor identificado** (trigger mantém, ninguém lê) | **confirmado** (trigger no bloco-06) |

Sem gaps de ordinal (pos 1–14 contíguos) → nenhuma coluna droppada.

## Relacionamentos (FKs)

Nenhuma (bloco-03 vazio). `cdt_code` é texto livre com default — não há FK para `units`/unidade; vínculo multi-unidade é por convenção de string, não referencial.

## Índices

| índice | tipo | idx_scan | bytes | def |
|--------|------|----------|-------|-----|
| sales_leads_pkey | UNIQUE/PRIMARY | 0 | 16384 | `... btree (id)` |
| idx_sales_leads_cdt_code | btree | 0 | 16384 | `... btree (cdt_code)` |
| idx_sales_leads_status | btree | 0 | 16384 | `... btree (status)` |

### Índices nunca usados (idx_scan=0)

Os **3** índices têm `idx_scan=0` — esperado numa tabela de 0 linhas (nunca consultada). Desperdício somado: **3 × 16384 = 49152 bytes ≈ 48 kB** (essencialmente todo o tamanho da tabela). Não é desperdício "real" enquanto a feature não entra em uso; vira desperdício se a tabela for abandonada.

## Triggers

- `update_sales_leads_updated_at` — BEFORE UPDATE, FOR EACH ROW, executa `update_updated_at_column()` (mantém `updated_at`). Padrão app/Supabase. Fonte: bloco-06. Nunca disparou (0 updates).

## RLS / Policies

- **RLS:** ON (`rls_on=true`, `n_policies=4`).
- Policies (bloco-09):
  1. `Only admins and sales agents can read sales_leads` — SELECT, role `public`, `qual = has_role(...,'admin') OR has_role(...,'sales_agent')`. **Única policy substantiva.**
  2. `Bloquear inserção para usuários anônimos - leads` — INSERT, role `anon`, `with_check=false`.
  3. `Bloquear atualização para usuários anônimos - leads` — UPDATE, role `anon`, `qual=false`.
  4. `Bloquear exclusão para usuários anônimos - leads` — DELETE, role `anon`, `qual=false`.
- **Redundância:** as 3 policies anti-`anon` (qual/with_check = `false`) são **redundantes com o default-deny do RLS**. Como não existe nenhuma policy *permissiva* para `anon` em INSERT/UPDATE/DELETE, o RLS já nega tudo por padrão; policies que avaliam `false` não adicionam proteção. Inofensivas, mas ruído (defensive overkill). Observe ainda que **não há policy de INSERT/UPDATE/DELETE para usuários autenticados** — hoje nem admin/sales_agent conseguem escrever via RLS (só SELECT está liberado). Se a feature for ativada, faltará policy de escrita autenticada.

## Quem escreve / Quem lê

- **Escreve:** ninguém. `n_tup_ins=0`. Nenhum writer em functions-analysis, edge-functions ou n8n-workflows.
- **Lê:** ninguém. `seq_scan=0`, `idx_scan=0`. Sem hits em pg_stat_statements (bloco-10a/b).

## Observações

- **Feature planejada, não morta:** o provisionamento completo (PK uuid, defaults, trigger, RLS por papel `sales_agent`, índices em `cdt_code`/`status`) indica intenção de produto de CRM de vendas que ainda não foi ligada ao app. Classificada como Morta/Backup por falta de enum melhor, mas o rótulo correto é "futuro/inativa".
- **Domínio app, não n8n:** usa `has_role`/`app_role`/`sales_agent` — o stack de auth do CHAT-CDT/app, não o do n8n. Logo é tabela do ecossistema do app, não da cobrança.
- **Gap de policy de escrita:** RLS só libera SELECT para admin/sales_agent; sem policy permissiva de INSERT/UPDATE/DELETE para autenticados, a tabela é read-only via RLS. Provável bug latente da feature inacabada.
- **Policies anti-anon redundantes:** 3 policies `false` sobrepostas ao default-deny — limpeza cosmética possível.
- **Ausente de `docs/`** como tabela (só o papel `sales_agent` é citado). Lacuna de documentação de feature futura.
