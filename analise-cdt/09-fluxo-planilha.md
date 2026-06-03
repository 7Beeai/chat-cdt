# 09 — Fluxo da planilha: Drive → sync → `clientes_cobranca_*` (ponta a ponta)

> Como uma planilha de inadimplentes que a franquia sobe ao Google Drive vira linhas
> em `clientes_cobranca_setembro` / `clientes_cobranca_dashboard` — com backup, log,
> snapshot diário e rastro de removidos.

**Fontes** (todas em `analise-cdt/raw/`):

- `n8n-workflows.json` **[5]** — workflow `Sync Planilha Power BI v3 (Robusto)` (Drive → RPC). É o caminho do **inadimplente**.
- `n8n-workflows.json` **[4]** — workflow `Sync Adimplentes - Relacionamento (Motor v2)` (Drive → serviço externo). Caminho do **adimplente** — **não** toca este banco; documentado aqui só para separar os dois.
- `bloco-05b-funcoes-def.json` **[105]** — corpo SQL real de `sync_cobranca_v2` (lineage `confirmado`, lido linha a linha).
- `bloco-05b-funcoes-def.json` **[94]** — corpo SQL real de `rollback_sync`.
- `functions-analysis.json` **[105]/[104]/[94]** — reads/writes estruturados de `sync_cobranca_v2`, `sync_cobranca_batch`, `rollback_sync`.
- `bloco-02-colunas.json` — colunas reais das tabelas (`spreadsheet_sync_log`, `cobranca_sync_backup`, `cobranca_clientes_removidos`, `sync_snapshots`, `clientes_cobranca_setembro/_dashboard`).

> **Confiança:** `confirmado` = referência literal no JSON do workflow **ou** extraída do corpo SQL da função. `inferido` = deduzido de payload/encapsulamento/semântica não verificável neste banco (marcado **[inf]**).

---

## ⚠️ Estado atual: SIMULAÇÃO. Nada é gravado hoje.

O workflow [5] está com **`active=false`** **e** com **`DRY_RUN=true` hardcoded** no nó
`Detectar e Normalizar` (`const DRY_RUN = true`). Fonte: `n8n-workflows.json` [5] (`notes`).
Consequência: hoje o fluxo só **simula** — detecta o arquivo, normaliza, e chama a RPC com
`p_dry_run=true`, que **retorna contagens sem escrever uma única linha**. O comentário no
código indica trocar `DRY_RUN` para `false` para ir a produção.

**Tudo o que segue descreve a lógica de produção** (o que aconteceria com `DRY_RUN=false`).
Onde o texto diz "insere/deleta/atualiza", leia "**iria** inserir/deletar/atualizar". O ramo
`dry_run` da própria RPC retorna em `status='dry_run'` **antes** de qualquer escrita
(corpo SQL [105], linhas 173–182).

> **As migrations citadas na tarefa** (`spreadsheet_sync_robustness`, `sync_cobranca_v2_*`, `rollback`)
> **não estão no repositório** (busca por `**/migrations/**` e `**/*sync*.sql`: nenhum arquivo).
> A descrição abaixo é **reconstruída do corpo vivo das funções** (`bloco-05b` [105]/[94]) e do
> lineage estruturado (`functions-analysis.json`), **não** dos arquivos de migration. **[lacuna]**

---

## 1. Os dois fluxos do Drive (não confundir)

| | Workflow [5] — **Inadimplentes** | Workflow [4] — **Adimplentes** |
|---|---|---|
| Nome | `Sync Planilha Power BI v3 (Robusto)` | `Sync Adimplentes - Relacionamento (Motor v2)` |
| Gatilho | `googleDriveTrigger` × **9 pastas** (1/unidade), evento `fileCreated` | `googleDriveTrigger` × **6 pastas** (1/unidade), `fileCreated` |
| Persistência | **RPC `sync_cobranca_v2`** neste banco (Supabase) | Serviço HTTP externo `http://host.docker.internal:8100/adimplentes/sync` (Docker) — **fora deste banco** |
| Toca `clientes_cobranca_*`? | **Sim** | Não verificável aqui (black box) |

**Este documento detalha o [5].** O [4] aparece só para deixar claro que **não** passa pela RPC:
seu workflow não tem nenhum nó Supabase/Postgres, nenhuma URL `/rest/v1/` nem `/functions/v1/`
(`reads/writes/rpcs` vazios em [4]). Os campos `bi_atual=false`, `total_new`, `per_unit` etc.
citados para adimplentes são **chaves do JSON de resposta do serviço externo**, não colunas
confirmadas deste banco **[inf]**.

---

## 2. Gatilho e parse (n8n, workflow [5])

Fonte: `n8n-workflows.json` [5] (`schedule`, `external`, `notes`).

1. **Poll do Drive.** 9 nós `googleDriveTrigger` (um por unidade), evento `fileCreated`,
   pollando nos minutos `:00/:15/:30/:45` (efetivamente a cada 15 min). Cada nó vigia a pasta
   de uma franquia. Pastas-fonte (lineage, `notes`):

   | Unidade | Folder ID Drive |
   |---|---|
   | Grupo Chagas | `1NaEaV3u4iCoFzzP_Pf5NkBaMJ_re_OIB` |
   | Tatuapé | `1dpIVFlbmzzztv4jkJhZWYU60e4kaxftX` |
   | Vitória | `1q4ozWkCqPQMg6XXGP8CXuWmr2NQmMmri` |
   | Mogi das Cruzes | `1XEKIAlYi9S6143vqtwUQOsZ9Prz3ut1N` |
   | Patrocínio | `1Z1I-5_ja9t8efRvcyV_RkHXm_b-sh_sA` |
   | Lavras | `1iKsk_Tk9xfPOOfzaQRRz3ImBMzBzpYsZ` |
   | Sapopemba | `1hrh4Jtt4ckTofT3R_BanfqsXoISKGttX` |
   | Caraguatatuba | `1xAF6PPIWB9MDCdqOQoiYBitRq3VyCs_x` |
   | Campo Limpo | `14Z2jIQKBW8qLzqyp56dUYsBhJqiFFlK4` |

   Pasta de **saída** dos arquivos já convertidos: `1gbj6dpV1YIEWdiwuuIL1yNoV2CI38vmT`.

2. **Converter XLSX → Google Sheets.** Nó `Converter XLSX`: `POST googleapis.com/drive/v3/files/{id}/copy`
   (copy do arquivo para o tipo Google Sheets). HTTP direto ao Drive — não-Supabase.

3. **Ler valores.** Nó `Ler Valores`: `GET sheets.googleapis.com/v4/.../values/A1:CZ`. Lê a matriz crua da planilha.

4. **Buscar Unidades** (nó Supabase `getAll` em `units`, `returnAll`): lê `units.id` e `units.bi_name`.
   Confiança: `confirmado` (colunas usadas literalmente em `Detectar e Normalizar`).

5. **Detectar e Normalizar** (nó Code) — o cérebro do parse:
   - Detecta a linha de cabeçalho e mapeia colunas.
   - Mapeia a **franquia** da planilha → `unit_id` via `units.bi_name` (chave limpa com `trim` + `uppercase`).
     Franquia sem match gera abort `franquia_desconhecida` + e-mail de alerta.
   - **Multi-unidade / idempotência:** um mesmo arquivo pode conter várias franquias. O código emite
     **um `rpc_payload` por unidade reconhecida** (N chamadas à RPC, **uma transação atômica por unidade**).
     O `p_file_id` é **sufixado por `unit_id`** (ou pelo rótulo do abort: `header`/`unknown`/`empty`) para
     que idempotência e log da RPC não colidam entre unidades do mesmo arquivo.
   - **Regra especial Sapopemba** (`unit_id 78d18121-fbfc-4900-a6a1-3f4933d86cbe`): ignora linhas onde
     `forma de pagamento = 'CONCESSIONARIA ENERGIA'`.
   - Normaliza cada linha para o **shape de `p_records`** (ver §3).
   - `DRY_RUN=true` hardcoded aqui (estado atual).

6. **Sync RPC (motor v3)** (nó `httpRequest`): `POST /rest/v1/rpc/sync_cobranca_v2` no Supabase.
   `retryOnFail` (3 tentativas, 3 s). **Quirk de nome:** o nó/workflow dizem "v3", mas a URL chama
   **`sync_cobranca_v2`** (v2, não v3). `errorWorkflow` configurado: `YmcZDVr5JFtYxQw6`. TZ `America/Sao_Paulo`.

7. **Limpeza + e-mail.** `Limpar Arquivo Convertido` e `Limpar Arquivo Original` fazem `DELETE` no Drive.
   Por fim, e-mail (Gmail) com o relatório da resposta da RPC.

---

## 3. O que entra na RPC (payload `p_*` / colunas de `p_records`)

Fonte: `n8n-workflows.json` [5] (`notes`, "CAMPOS DO PAYLOAD RPC") + assinatura real em `bloco-05b` [105].

**Assinatura** (`bloco-05b` [105], linha 1):

```
sync_cobranca_v2(
  p_unit_id uuid, p_file_id text, p_file_name text, p_records jsonb,
  p_validation_errors jsonb='[]', p_skipped jsonb='{}', p_header_row int=NULL,
  p_converted_file_id text=NULL, p_abort_rule text=NULL, p_abort_reason text=NULL,
  p_sanity_min_ratio numeric=0.70, p_sanity_min_baseline int=50, p_dry_run bool=false)
```

**`p_records`** — array de registros (um por inadimplente). Colunas lidas pela RPC via
`jsonb_to_recordset` (corpo [105], linhas 67–79):

| campo em `p_records` | tipo | observação |
|---|---|---|
| `matricula` | text | **chave**. Linhas com `matricula` nula/vazia são descartadas; `distinct on (matricula)` dedup |
| `name` | text | nome do cliente |
| `whatsapp` | text | **E.164** (`55` + DDD + `9`...), normalizado no n8n |
| `valor_inadimplente` | numeric | **em centavos** (`VAM × 100` no n8n) |
| `regua` | text | régua de cobrança; `'NR'` semeia a cadência (ver §4) |
| `forma_pagamento` | text | → coluna `"forma de pagamento"` (com espaços) no banco |
| `status` | text | n8n manda `'novo'`; RPC faz `coalesce(status,'novo')` |

**Demais `p_*`** carregam metadados do parse para o log: `p_file_id`/`p_file_name`/`p_converted_file_id`
(identificação e idempotência), `p_validation_errors` + `p_skipped` (diagnóstico → `spreadsheet_sync_log`),
`p_header_row` (linha de cabeçalho detectada), `p_abort_rule`/`p_abort_reason` (abort decidido **no n8n**,
ex.: `franquia_desconhecida`), `p_dry_run`.

> **Os limiares de sanity (`p_sanity_min_ratio=0.70`, `p_sanity_min_baseline=50`) são defaults da RPC.**
> A lista de campos do payload no n8n [5] **não** envia esses dois parâmetros — logo valem os defaults. **[inf]**

---

## 4. O que a RPC faz (corpo SQL, `bloco-05b` [105])

`sync_cobranca_v2`: `SECURITY DEFINER`, `search_path 'public, pg_temp'`, `statement_timeout 180s`.
Transação atômica por unidade. `v_today = (now() AT TIME ZONE 'America/Sao_Paulo')::date`.

### 4.0 — Aborts decididos pelo n8n (linhas 31–49)
Se `p_abort_rule` veio preenchido (n8n já decidiu abortar, ex.: franquia desconhecida): grava
`spreadsheet_sync_log` com `status='aborted'` e retorna. Nenhuma tabela de cobrança é tocada.

### 4.1 — Lock + idempotência (linhas 51–65)
- `pg_advisory_xact_lock(hashtext('sync_cobranca'), hashtext(unit_id))` — serializa syncs da **mesma unidade**.
- Lê `units.name` (para o relatório).
- Lê `spreadsheet_sync_log.status` por `file_id`. Se já `'completed'` e não dry-run → retorna
  **`skipped_already_completed`** (idempotência: o mesmo arquivo/unidade não roda 2×).

### 4.2 — Materializa a planilha + GATE de sanity (linhas 67–125) — **antes de qualquer escrita**
- Cria temp table `_sheet` (`ON COMMIT DROP`) com `distinct on (matricula)` de `p_records`, descartando `matricula` vazia.
- `v_sheet_count` = linhas válidas da planilha; `v_db_count` = `count(*)` em `clientes_cobranca_setembro` da unidade.
- Decide abort de sanity:
  - **`empty_sheet`** — `v_sheet_count = 0`.
  - **`partial_export`** — `v_db_count >= 50` **E** `v_sheet_count < v_db_count × 0.70`. Protege contra
    export parcial do Power BI apagar a base por engano (mensagem: "Export parcial suspeito: X linhas vs Y na base, mínimo 70%").
- Se abortou: grava `spreadsheet_sync_log status='aborted'` + `sanity_metrics` e retorna. **Sem tocar cobrança.**

### 4.3 — Abre o log (linhas 127–136)
Se passou: `DELETE` log anterior do `file_id` e `INSERT` novo com `status='processing'`,
guardando `v_log_id` (usado em todas as escritas seguintes como chave de reversibilidade).

### 4.4 — Calcula contagens (linhas 138–171)
`v_created` (na planilha, ausentes em `setembro`), `v_updated` (existem, `pagamento_feito=false`, com
algum campo divergente), `v_deleted` (na base mas sumiram da planilha, `pagamento_feito=false`),
`v_paid_removed` (na base com `pagamento_feito=true`), e `v_regua_transicao` (mapa `regua_antiga->nova`).

### 4.5 — Ramo dry-run (linhas 173–182)
**Se `p_dry_run=true`** (estado atual do n8n): retorna `status='dry_run'` com as contagens **e para aqui**.
Nada abaixo executa. **É por isso que hoje nada é gravado.**

### 4.6 — FOTO PRÉ-SYNC: backup reversível (linhas 184–199)
> **Este é o "backup pré-sync" pedido na tarefa.**

`INSERT INTO cobranca_sync_backup (sync_log_id, unit_id, snapshot_date, source_table, row_data)`:
- `to_jsonb(c.*)` de **cada linha** de `clientes_cobranca_setembro` onde `unit_id = p_unit_id`
  **OU** `matricula IN (planilha)` — `source_table='clientes_cobranca_setembro'`.
- O mesmo para `clientes_cobranca_dashboard` — `source_table='clientes_cobranca_dashboard'`.
- A linha inteira vai em `row_data jsonb` → permite reconstrução exata via `rollback_sync` (§6).
- **Retenção:** `DELETE FROM cobranca_sync_backup WHERE created_at < now() - interval '14 days'`.

### 4.7 — Aplica o diff em DUAS tabelas (assimetria — o coração) (linhas 201–311)

Há **duas** tabelas espelho com papéis diferentes:

| | `clientes_cobranca_setembro` | `clientes_cobranca_dashboard` |
|---|---|---|
| Papel | **Lista viva** (quem o motor deve cobrar agora) | **Histórico acumulado** (dashboard/relatórios) |
| Em saída (sumiu/pago) | **DELETE físico** da linha | **Nunca deleta** linha; marca `bi_atual=false` |
| Em entrada (novo) | `INSERT` | `INSERT … ON CONFLICT (matricula) DO UPDATE` (`bi_atual=true`, `disparos_equipe=0`) |

Operações (todas com `confidence:"confirmado"` em `functions-analysis.json` [105]):

1. **INSERT novos** em `setembro` e em `dashboard` (linhas 201–242): linhas da planilha ausentes em `setembro`.
   `status = coalesce(s.status,'novo')`. Se `regua='NR'`, **semeia a cadência**: `cadence_fase='00'`,
   `cadence_dia_ciclo=1`, `cadence_branch_state='normal'`, `cadence_entrou_em=now()`, `regua_at_entry='NR'`,
   `slots_enviados_hoje=0` (senão, `NULL`). No `dashboard`, `bi_atual=true`.
2. **UPDATE atualizados** (linhas 244–274): para `pagamento_feito=false` e algum campo divergente
   (`whatsapp`/`regua`/`valor`/`forma de pagamento`/`unit_id`; no dashboard também `bi_atual`),
   atualiza `whatsapp, valor, regua, "forma de pagamento", unit_id, updated_at` (dashboard também `bi_atual=true`).
3. **DELETE "sumiu da planilha"** (linhas 276–290): `DELETE FROM setembro` onde `unit_id` bate,
   `pagamento_feito=false` e `matricula NOT IN (planilha)` — `RETURNING` alimenta `cobranca_clientes_removidos`
   com `motivo='sumiu_da_planilha'`.
4. **DELETE "pagamento feito"** (linhas 292–305): `DELETE FROM setembro` onde `pagamento_feito=true`
   — `RETURNING` → `cobranca_clientes_removidos` com `motivo='pagamento_feito'`.
5. **Flag no dashboard** (linhas 307–311): `UPDATE dashboard SET bi_atual=false` para matrículas que
   **não existem mais** em `setembro`. A linha permanece (histórico), apenas deixa de ser "atual".

> **Por que duas tabelas:** `setembro` é a fila de cobrança (some quem saiu, para o motor não disparar).
> `dashboard` é o livro-razão (mantém todo mundo que já passou, com `bi_atual` distinguindo ativo de histórico).

### 4.8 — Removidos (tabela `cobranca_clientes_removidos`)
> **Os "clientes removidos" pedidos na tarefa.** Trilha de auditoria de quem saiu da base.

Alimentada pelos dois `DELETE … RETURNING` acima. Colunas (snapshot do momento da saída):
`matricula, name, whatsapp, unit_id, regua_no_momento, status_no_momento, valor_no_momento,
motivo` (`sumiu_da_planilha` | `pagamento_feito`), `dias_na_base` (`v_today − created_at`, `≥0`),
`entrou_em` (= `created_at` original), `removido_em` (`now()`), `sync_log_id`, `snapshot_date`.

### 4.9 — Snapshot diário (tabela `sync_snapshots`) (linhas 313–360)
> **Não estava nos bullets da tarefa, mas é write da RPC — incluído.**

Recalcula da `setembro` da unidade: `v_total` (count), `v_valor_total` (sum), `v_aging` (média de dias),
`v_regua_dist` (distribuição por régua). Lê o **snapshot do dia anterior** (`snapshot_date < v_today`,
mais recente) para calcular `valor_total_delta` e `total_clientes_delta`. Faz **upsert** por
`(unit_id, snapshot_date)` em `sync_snapshots`: `entradas`(=created), `saidas`(=deleted+paid_removed),
`saidas_pagamento`, `saidas_sumiu`, `atualizados`, `total_clientes`, `valor_total`, `aging_medio_dias`,
`regua_distribuicao`, `regua_transicao`, e os dois deltas. É a fonte das métricas diárias por unidade.

### 4.10 — Fecha o log + retorno (linhas 362–386)
`UPDATE spreadsheet_sync_log SET status='completed'` + contagens (`records_created/updated/deleted/paid_removed/skipped`,
`completed_at`). Retorna jsonb com `status='completed'`, `sync_log_id`, contagens, `total_clientes`,
`valor_total`, `aging_medio_dias`, `regua_distribuicao`, `regua_transicao`, deltas — é o corpo do e-mail do n8n.

---

## 5. O log: `spreadsheet_sync_log`

Fonte: `bloco-02-colunas.json` (20 colunas) + escritas em `functions-analysis.json` [105].

Uma linha por **(file_id, unidade)** — lembre que `file_id` é sufixado por `unit_id` no n8n. Estados de `status`:
`processing` → `completed` | `aborted` (`skipped_already_completed` é retorno, não persiste novo log).
Colunas-chave: `file_id`, `file_name`, `converted_file_id`, `status`, `records_in_sheet/created/updated/deleted/paid_removed/skipped`,
`validation_errors` (jsonb), `header_row_detected`, `abort_rule`/`abort_reason`, `sanity_metrics` (jsonb: sheet/db count, ratios),
`started_at`/`completed_at`. É a tabela que garante idempotência (§4.1) e auditoria de cada execução.

---

## 6. Rollback: `rollback_sync(p_sync_log_id)` (`bloco-05b` [94])

> **NÃO é chamada pelo fluxo.** Aparece **apenas como texto no corpo do e-mail** de alerta — instrução
> manual de reversão para o operador rodar à mão se um sync der errado (`n8n-workflows.json` [5] `notes`).
> Não está em `rpcs` do workflow.

Lógica (corpo [94]): resolve `unit_id`/`snapshot_date` do backup pelo `sync_log_id`; pega o advisory lock da unidade; então, para `setembro` e `dashboard`:
1. `DELETE` onde `unit_id = X` **OU** `matricula IN (backup daquele source_table)`;
2. `INSERT` reconstruindo cada linha com `jsonb_populate_record(null::tabela, row_data).*` a partir de `cobranca_sync_backup`.

Por fim, limpa os auxiliares daquele sync: `DELETE FROM cobranca_clientes_removidos WHERE sync_log_id=...`
e `DELETE FROM sync_snapshots WHERE sync_log_id=...`. Retorna contagens restauradas.

> **[inf]** O `DELETE` de restauração filtra por `unit_id = X OR matricula IN (backup)`. Como o backup também
> captura matrículas da planilha de **outras** unidades (§4.6 usa `OR matricula IN (_sheet)`), uma matrícula
> cross-unidade poderia, em teoria, arrastar linhas de outra unidade para dentro do escopo de restauração.
> Inferência a partir do SQL; não há teste/observação que confirme o cenário neste material.

---

## 7. Função irmã não usada por este fluxo

`sync_cobranca_batch` (`functions-analysis.json` [104]) escreve nas **mesmas** tabelas espelho
(`setembro` + `dashboard`, upsert/update/delete/pagos, mesma semântica de cadência F0/`bi_atual`),
mas **lê lotes via parâmetro jsonb** (`p_new_records` etc.), **não** tem backup/log/snapshot/sanity, e
**não é chamada pelo workflow [5]**. Quem a invoca não foi determinado nesta passagem. **[lacuna]**

---

## 8. Diagrama do caminho de produção (inadimplentes)

```
Power BI export (XLSX)  →  Google Drive (9 pastas, 1/unidade)
        │  googleDriveTrigger fileCreated  (poll :00/:15/:30/:45)
        ▼
[n8n] Converter XLSX→Sheets (Drive copy)  →  Ler Valores A1:CZ (Sheets API)
        │
        ├─ Buscar Unidades (Supabase getAll units: id, bi_name)
        ▼
[n8n] Detectar e Normalizar (Code)
        • header detect • franquia→unit_id via bi_name • regra SPB
        • monta p_records {matricula,name,whatsapp(E.164),valor*100,regua,forma_pagamento,status='novo'}
        • 1 payload por unidade • p_file_id sufixado por unit_id • DRY_RUN=true (HOJE)
        ▼
[n8n] POST /rest/v1/rpc/sync_cobranca_v2   (retry 3×)
        ▼
┌──────────────────── sync_cobranca_v2 (atômica/unidade) ───────────────────┐
│ lock → idempotência (log 'completed'? skip)                                │
│ _sheet (temp) → SANITY GATE: empty_sheet | partial_export(<70%, base≥50)   │
│ [dry_run? → retorna, FIM, nada escrito]                                    │
│ log 'processing'                                                           │
│ BACKUP → cobranca_sync_backup (foto setembro+dashboard, retém 14d)         │
│ INSERT novos  → setembro + dashboard (NR semeia cadência; dash bi_atual=t) │
│ UPDATE difs   → setembro + dashboard                                       │
│ DELETE sumiu/pago → setembro  ──RETURNING──► cobranca_clientes_removidos   │
│ dashboard: bi_atual=false p/ quem saiu (linha permanece)                   │
│ sync_snapshots ← upsert diário (totais, deltas vs ontem, réguas)          │
│ log 'completed' + contagens                                               │
└────────────────────────────────────────────────────────────────────────┘
        ▼
[n8n] Limpar arquivos (Drive DELETE) → e-mail relatório (Gmail)
        (e-mail cita rollback_sync(sync_log_id) como instrução MANUAL)
```

---

## 9. Lacunas e inferências

1. **[lacuna]** **Migrations ausentes do repo.** `spreadsheet_sync_robustness`, `sync_cobranca_v2_*`, `rollback`
   não existem como arquivo (`**/migrations/**`, `**/*sync*.sql` → nada). A descrição vem do **corpo vivo das
   funções** (`bloco-05b`) e de `functions-analysis.json`, não dos arquivos de migration nomeados na tarefa.
2. **[estado]** **Tudo é simulação hoje.** `active=false` + `DRY_RUN=true`. Nenhuma escrita ocorre no estado atual.
3. **[inf]** **Shape/transformações do n8n** (`valor = VAM×100` centavos, whatsapp E.164 `55`+DDD+`9`, `status='novo'`,
   header detect, limpeza `trim`/`uppercase` de `bi_name`) vêm das `notes` de [5] — não do corpo da função; o JSON
   não traz o código JS literal do nó `Detectar e Normalizar`.
4. **[inf]** **Defaults de sanity** (0.70 / 50) valem porque o payload do n8n não envia `p_sanity_min_ratio`/`p_sanity_min_baseline`.
5. **[inf]** **Workflow [4] (adimplentes)** persiste em serviço externo `:8100`; `bi_atual=false`, `per_unit`, `total_removed`
   etc. são chaves da resposta do serviço, **não** confirmadas como colunas deste banco.
6. **[inf]** **`rollback_sync` escopo cross-unidade** — possível arraste de outra unidade pelo `OR matricula IN (backup)` (§6).
7. **[lacuna]** **Chamador de `sync_cobranca_batch`** não identificado nesta análise (não é o workflow [5]).
8. **[discrepância confirmada]** Nome "v3" no workflow/nó vs RPC real `sync_cobranca_v2` na URL.
9. **[lacuna]** Não há, neste material, evidência de **gatilho/cron** que chame `rollback_sync` automaticamente —
   coerente com ser instrução manual no e-mail.
```
