# blacklist_global

## Identificação
- **Nome:** `public.blacklist_global`
- **Dono provável:** n8n / Motor v2 (Cobrança / "Strategic Swarm"). Não definida em migrations do CHAT-CDT (grep sem hits). Manipulada por `add_to_blacklist` / `is_blacklisted` (`functions-analysis.json`).
- **Linhas estimadas:** 114 live tuples (`bloco-01`, `n_live_tup` = `linhas_estimadas` 3.546 é estimativa do planner divergente; `n_tup_ins=114`, `n_dead_tup=0` → **114 linhas reais**).
- **Tamanho:** 1.776 kB total / 1.288 kB heap (`bloco-01`).
- **Classificação:** **Cobrança** (blacklist compartilhada entre franquias).
- **Bloat:** ~11.300 bytes/linha sobre 114 linhas — **alto por linha, mas enganoso**: a tabela tem 3 índices (377 kB) e ~1,3 MB de heap para 114 linhas. O excesso vem de heap pré-alocado/jsonb `raw_evidence`, não de tuplas mortas (`n_dead_tup=0`). A 114 linhas o tamanho absoluto é irrelevante; sem alerta operacional, mas curioso (ver Observações).

## Finalidade
Lista de bloqueio (opt-out) **global e compartilhada entre franquias** para cobrança via WhatsApp. Um número entra na blacklist por: pedido de "SAIR", bloqueio pela Meta, número inválido, ou solicitação LGPD. Antes de qualquer disparo o Motor v2 consulta `is_blacklisted(whatsapp)` para suprimir o envio. Inserção idempotente via `add_to_blacklist` (`ON CONFLICT (whatsapp) DO NOTHING`).

## Colunas
| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | bigint | NÃO | `nextval('blacklist_global_id_seq')` | sequence (PK) | PK `blacklist_global_pkey`; `add_to_blacklist` faz `RETURNING id` | confirmado |
| 2 | whatsapp | text | NÃO | — | INSERT de `add_to_blacklist` (param `p_whatsapp`) | **lido** por `is_blacklisted(whatsapp)`; índice único `blacklist_global_whatsapp_key` (idx_scan=2798 — quentíssimo) | confirmado (writer + reader literais) |
| 3 | motivo | text | NÃO | — | INSERT de `add_to_blacklist` (param `p_motivo`: SAIR/Meta/inválido/LGPD) | sem consumidor identificado (auditoria/triagem) | confirmado (write) |
| 4 | unit_origem | text | SIM | — | INSERT de `add_to_blacklist` (param `p_unit_origem` — franquia que originou) | sem consumidor identificado | confirmado (write) |
| 5 | matricula_origem | text | SIM | — | INSERT de `add_to_blacklist` (param `p_matricula_origem`) | sem consumidor identificado | confirmado (write) |
| 6 | created_at | timestamptz | NÃO | `now()` | default `now()` | sem consumidor identificado | confirmado (default) |
| 7 | raw_evidence | jsonb | SIM | — | INSERT de `add_to_blacklist` (param `p_evidence` — payload bruto da decisão) | sem consumidor identificado (forense) | confirmado (write) |

## Relacionamentos (FKs)
**Nenhuma FK** envolvendo esta tabela (`bloco-03` sem entradas). É intencionalmente desacoplada: `whatsapp` é a chave de negócio (constraint UNIQUE), `unit_origem`/`matricula_origem` são referências soft (texto) para preservar a evidência mesmo se a unidade/matrícula mudar. Coerente com blacklist append-only compartilhada.

## Índices
| índice | uso (idx_scan) | bytes | nota |
|--------|----------------|-------|------|
| blacklist_global_pkey | 2 | 98.304 | PK em `id` |
| blacklist_global_whatsapp_key | 2.798 | 180.224 | UNIQUE(whatsapp) — quentíssimo; serve `is_blacklisted` + `ON CONFLICT` |
| idx_blacklist_whatsapp | 0 | 180.224 | índice **não-único** redundante em `whatsapp` |

### Índices nunca usados (idx_scan=0)
Soma do desperdício: **180.224 bytes (~176 kB)** em `idx_blacklist_whatsapp`.

**FLAG FORTE — duplicata redundante drop-safe:** `idx_blacklist_whatsapp` (não-único) cobre exatamente a mesma coluna `whatsapp` que já é indexada pelo `blacklist_global_whatsapp_key` (UNIQUE, idx_scan=2798). O índice único atende todas as consultas por `whatsapp`; o duplicado não-único **nunca** é escolhido (idx_scan=0). Ao contrário do `event_log`, aqui o veredito **não depende da janela**: dois índices sobre a mesma coluna, um deles UNIQUE e quente, tornam o não-único puro overhead de escrita. Candidato seguro a `DROP INDEX idx_blacklist_whatsapp`.

## Triggers
**Nenhum trigger** nesta tabela (`bloco-06` sem entradas). Inserção controlada exclusivamente pela RPC `add_to_blacklist`; sem auditoria automática (não escreve em `event_log`).

## RLS / Policies
- `rls_on = true`, `rls_forced = false`, **`n_policies = 0`** (`bloco-01` / `bloco-09` vazio).
- Efeito: **default-deny**. Só `service_role`/`SECURITY DEFINER` alcançam.
- **Footgun latente (inferido):** `is_blacklisted` é **`security_definer = false`** (`functions-analysis.json`) e lê uma tabela `rls_on=true`+0 policies. Sob `service_role` (edge/motor) funciona normalmente. **Se** algum dia for chamada via PostgREST como `authenticated`/`anon`, a RLS default-deny faria a função retornar **0 linhas → `false` (não-blacklisted) silenciosamente**, liberando disparo para número bloqueado. Não há evidência no corpus de que isso ocorra (caller é o motor via service_role), mas é um risco de configuração. Confiança: inferido/condicional — role do chamador desconhecida no corpus.
- **Contradição doc↔banco:** `docs/analise-banco.md` lista `blacklist_global` entre "tabelas expostas sem RLS efetiva". Invertido: `rls_on=true`+0 policies é travado (default-deny), não exposto.

## Quem escreve / Quem lê
**Escrita:** `add_to_blacklist` (secdef=true) — único writer. INSERT(`whatsapp`, `motivo`, `unit_origem`, `matricula_origem`, `raw_evidence`) `ON CONFLICT (whatsapp) DO NOTHING RETURNING id`; retorna jsonb com flag `inserted`. `confidence: confirmado`.

**Leitura:** `is_blacklisted(whatsapp)` (SQL STABLE, secdef=false) — gate de supressão de envio. `confidence: confirmado`.

**Evidência de tráfego (`pg_stat`, bloco-10a/10b):** a RPC `add_to_blacklist` aparece com **2.798 calls / 2.798 rows / 754 ms total** via PostgREST na janela ~13h. Isso bate exatamente com `idx_scan=2798` do `blacklist_global_whatsapp_key`. Note o contraste: **2.798 chamadas, mas só 114 inserts reais** (`n_tup_ins=114`) — a esmagadora maioria das chamadas é re-tentativa idempotente que cai no `ON CONFLICT DO NOTHING` (número já bloqueado). Tabela **muito ativa em leitura/checagem**, baixa em escrita líquida.

## Observações
- **`sem_consumidor` = 5** (regra estrita: só `whatsapp` tem reader programático — `is_blacklisted`; `id` via PK/RETURNING). `motivo`, `unit_origem`, `matricula_origem`, `created_at`, `raw_evidence` não são lidos por código mapeado, servem auditoria/forense. **Não é tabela morta** — é gate crítico de compliance consultado milhares de vezes.
- Sem colunas com espaço no nome.
- **Bloat por linha curioso:** 1,3 MB de heap para 114 linhas (~11 kB/linha) é muito para 7 colunas. Provável causa: `raw_evidence` jsonb com payloads grandes e/ou heap nunca compactado. Irrelevante em valor absoluto a 114 linhas, mas vale um `VACUUM (FULL/ANALYZE)` se o número crescer ou se `raw_evidence` guardar blobs grandes.
- **Redundância de índice** já sinalizada (drop `idx_blacklist_whatsapp`).
- Ausência de auditoria: ao contrário de `fila_humana`, esta tabela **não** tem trigger para `event_log`. Inclusão/remoção de número da blacklist (decisão sensível LGPD) não gera trilha automática em `event_log` — só o `raw_evidence` inline. Possível lacuna de auditoria.
