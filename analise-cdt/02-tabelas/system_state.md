# system_state

## Identificação
- **Nome:** `public.system_state`
- **Dono provável:** n8n / cobrança — **Motor v2** (kill switches / flags globais; ausente das migrations do CHAT-CDT).
- **Linhas estimadas:** **desconhecida (nunca analisada)** — `linhas_estimadas=-1`, `last_analyze=null`, `n_live_tup=0`. Logicamente poucas linhas chave-valor (`cadence_enabled`, `motor_v2_gate_override_color`, `motor_v2_reguas_override`, …). `n_tup_upd=1` na janela (um flip de flag).
- **Tamanho:** 32 kB total, heap 8 kB.
- **Classificação:** **Cobrança** (config global / kill switches do motor).
- **Bloat:** 1 dead tuple; trivial.
- **RLS:** OFF.

## Finalidade
**Kill switches e flags globais** do motor de cobrança (comentário bloco-01). Tabela chave-valor (`key` → `value` jsonb). Sessão 3 cria `cadence_enabled` (T15). Operável por SQL direto: `UPDATE system_state SET value='false'::jsonb WHERE key='cadence_enabled'`. Também guarda overrides do gate (`motor_v2_gate_override_color`, `motor_v2_reguas_override`) lidos por `motor_v2_recalc_gate`.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | key | text | NO | — | operador (SQL direto) / seed | `motor_v2_recalc_gate` (select por key), edges planejador/sortear/fechamento (select `key,value`); PK `system_state_pkey` (idx_scan 4860) | confirmado (functions-analysis + edge) |
| 2 | value | jsonb | NO | — | operador (SQL direto) — ex.: `'false'::jsonb` | `motor_v2_recalc_gate` (lê override de cor e cap de réguas); 3 edges motor-v2 (lê flags/kill switch) | confirmado (functions-analysis + edge) |
| 3 | updated_at | timestamptz | NO | `now()` | default / SQL direto | **sem consumidor identificado** (não lido) | inferido |
| 4 | updated_by | text | YES | — | SQL direto / operador (quem mexeu) | **sem consumidor identificado** (audit humano) | inferido |
| 5 | notes | text | YES | — | SQL direto / operador (anotação) | **sem consumidor identificado** | inferido |

## Relacionamentos (FKs)
Nenhuma FK (bloco-03).

## Índices
| índice | unique | idx_scan | bytes | nota |
|--------|--------|----------|-------|------|
| `system_state_pkey` (key) | sim | **4860** | 16 kB | **muito quente** — toda edge/RPC do motor lê flags por key |

### Índices nunca usados (idx_scan=0)
Nenhum. **Desperdício = 0.** Único índice (PK) é o mais escaneado da sua lista (4860).

## Triggers
Nenhum (bloco-06). (Sem trigger de event_log — flips de flag não são auditados aqui; `updated_by`/`updated_at` servem de auditoria leve manual.)

## RLS / Policies
RLS **OFF**, 0 policies. Lida por service_role (edges/RPCs) e editável por SQL direto de operador.

## Quem escreve / Quem lê
- **Escreve:** **operador via SQL direto** (kill switch documentado no comentário) / seed. Sem writer programático no inventário (`n_tup_upd=1`, manual).
- **Lê (alto volume):** `motor_v2_recalc_gate` (`key,value` — override de cor `motor_v2_gate_override_color` e cap `motor_v2_reguas_override`); edges `motor-v2-planejador`, `motor-v2-sortear-relacionamento`, `motor-v2-fechamento` (todas selecionam `key,value` — checam `cadence_enabled` / flags antes de agir). Citação: functions-analysis.json + edge-functions.json.

## Observações
- É o **kill switch central do motor de cobrança**: as três edges de cron leem `system_state` no início → desligar `cadence_enabled` para `false` para a operação inteira. Confirmado pelo padrão de leitura nas 3 edges.
- `updated_at`/`updated_by`/`notes` são metadados de auditoria humana — sem leitor programático.
- `linhas_estimadas=-1` ⇒ desconhecida, não zero.
- Comentário (Sessão 3 / T15 cria `cadence_enabled`) é roadmap do projeto Motor v2 — não conflita com o banco.
