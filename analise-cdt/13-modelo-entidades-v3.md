# 13 — Modelo de Entidades v3 (greenfield)

> **O que é este documento.** A **planta** do projeto novo: quais **entidades**, **eventos**, **estados** e **regras** a operação CDT precisa gerenciar — destilados da análise real do banco atual (`02-tabelas/*`, `08-dependencias`, `03-funcoes`, `05-triggers`, `07-n8n`, `09-fluxo`), não da memória. Fonte estruturada: `raw/v3-entidades.json` (8 domínios, 106 regras de negócio, ~22 máquinas de estado).
>
> **Escopo.** Modelo greenfield para o **projeto novo** (piloto de 1 unidade), cobrindo todo o ciclo do cliente: **vendas → relacionamento → cobrança → atendimento**, com **pagamentos**, **WhatsApp/templates** e **orquestração**. É a planta; o DDL detalhado vem na próxima etapa.
>
> **Como ler.** Entidade = tabela com identidade própria. Evento = tabela append-only do que aconteceu. Estado = coluna. Config = catálogo. Cada decisão rastreia uma **regra (R#)** da extração.

---

## 1. Princípios (o que a análise nos ensinou)

| # | Princípio | De onde veio |
|---|---|---|
| **P1** | **Estado é dado, não lugar.** Nunca mais "está nesta tabela = está neste estado" nem DELETE-físico para representar saída. Tudo é coluna/evento explícito. | a doença central (`08`, `setembro`×`dashboard`) |
| **P2** | **Tenant = `unidade`.** Quase tudo é escopado por `unidade_id` (FK). Exceção: **blacklist é global**. | R4, R98 |
| **P3** | **Dinheiro em centavos inteiros**, em todo o financeiro. Nada de `numeric` "em reais". | R2, R30, R94 |
| **P4** | **Identidades reais com constraint.** `matricula (+unidade)` vira chave de verdade; `wa_id` E.164 é a identidade de mensageria; chaves Meta (`waba_id`, `phone_number_id`, `template_name+waba_id`) são únicas. | R1, R23, R52, R60, R72 |
| **P5** | **Eventos append-only + uma timeline universal.** Pagamento, disparo, mensagem, mudança de estado: tudo gera evento. `evento` (ex-`event_log`) é a **timeline do cliente** — a "clareza" que faltava. | R88, R89 |
| **P6** | **Mútua exclusão de trilho por construção.** A mesma pessoa não é inadimplente e adimplente ao mesmo tempo: uma coluna `trilho`, não duas tabelas que precisam de cross-join pra não colidir. | R22 |
| **P7** | **Consolidar o que está dividido.** Dois engines de cadência, dois sistemas de acesso operador↔unidade, número WhatsApp partido em duas tabelas — tudo unificado. | R61, R95, R100 |
| **P8** | **Não replicar os bugs herdados.** RLS furada, dinheiro mal-rotulado, `updated_at` congelado, índices mortos, credencial em texto puro. | R18, R19, R20, R41 |

---

## 2. Mapa de módulos

```
0. Tenant & Identidade   unidade · operador · operador_unidade · papel
1. WhatsApp (infra)       waba · phone_number · template · (saúde: snapshots)
2. Pessoa & Cliente       contato · cliente · lead · blacklist
3. Cobrança               ciclo_cobranca · disparo · saida_cobranca · fila_humana
4. Pagamentos             pagamento · link_pagamento · pagamento_orfao · gateway_config · payout
5. Atendimento (chat)     conversa · mensagem · conversa_evento · push_subscription
6. Orquestração (motor)   gate_unidade · regua_plano · slot_config · gate_config · system_flag · agente_ia
7. Auditoria              evento  (timeline universal — cross-cutting)
```

---

## 3. As ENTIDADES (uma linha = uma coisa do mundo real)

> Notação: `PK` chave primária · `FK→x` aponta pra x · `UQ` único · `‹enum›` máquina de estado (§5).

### Módulo 0 — Tenant & Identidade

**`unidade`** — o **tenant**; raiz de quase tudo (R98).
`id PK · code UQ · nome · whatsapp_phone · ativo · created_at`

**`operador`** — quem opera (fusão do `profiles`+`auth.users` de hoje, R53).
`id PK · auth_user_id UQ · nome · email · ativo`

**`operador_unidade`** — vínculo operador↔unidade (junção). **Unifica os dois sistemas divergentes de hoje** (R100) numa **única base de chave**.
`operador_id FK→operador · unidade_id FK→unidade · ativo · UQ(operador_id, unidade_id)`

**`operador_papel`** — papel global do operador.
`operador_id FK→operador · papel ‹papel› · UQ(operador_id, papel)` — *decidir se papel é único por operador* (R101).

### Módulo 1 — WhatsApp (infra de comunicação; **não é do cliente**)

**`waba`** — conta WhatsApp Business; filha da unidade (R59).
`id PK · unidade_id FK→unidade · waba_id_meta UQ · business_id · nome`

**`phone_number`** — número de envio/recebimento; filho da WABA. **Unifica `chat_phone_numbers` + `disparadores_whatsapp`** (R61).
`id PK · waba_id FK→waba · phone_number_id_graph UQ · numero_e164 UQ · ativo · limite_diario · disparos_hoje · contador_reset_at`
*Saúde/qualidade NÃO é coluna aqui (R62): vem do último snapshot (abaixo).*

**`template`** — template de mensagem Meta; compartilhado, filho da WABA (R73).
`id PK · waba_id FK→waba · unidade_id FK→unidade · template_name · categoria · status_meta ‹template_meta› · paused_by_sentinel bool · quality_score · components jsonb · parent_template_id FK→template(self) · UQ(template_name, waba_id)` (R72)
*Gate de disparo REAL = `status_meta=APPROVED AND NOT paused_by_sentinel` (R70). **Não** recriar `is_active_in_cadence` (flag morta, R71).*

### Módulo 2 — Pessoa & Cliente

> **Decisão de modelagem recomendada (resolve a "dualidade contato×cliente", R52):** separar a **identidade de WhatsApp** (estável, existe mesmo pra um número desconhecido que mandou inbound, ou um lead) do **papel de filiado** (tem matrícula). Você ainda tem a sua "tabela única de clientes" (`cliente`) pro dia a dia; `contato` é só a camada fina de identidade por baixo. Ver §8-D1.

**`contato`** — a pessoa/identidade WhatsApp. Âncora da timeline.
`id PK · unidade_id FK→unidade · wa_id_e164 · nome · cliente_id FK→cliente(nullable) · UQ(unidade_id, wa_id_e164)` (R3, R52)

**`cliente`** — o **filiado** (a sua "tabela única de clientes"). Carrega o **trilho** e o estado de relacionamento.
`id PK · unidade_id FK→unidade · matricula · nome · whatsapp_e164 · trilho ‹trilho› · saida_at · saida_motivo · relacionamento_opt_out bool · relacionamento_ultimo_at · UQ(unidade_id, matricula)` (R1, R6-correção, R22, R24, R25)
*`saida_at IS NULL` = ativo. `trilho ∈ {cobranca, relacionamento, nenhum}` — **mutuamente exclusivo por construção** (R22), acaba o cross-join por telefone.*

**`lead`** — prospecto, ainda **não** é cliente (sem matrícula); **converte** em cliente ao fechar (R28).
`id PK · unidade_id FK→unidade · nome · whatsapp · email · status ‹funil_vendas› · origem · valor_potencial_cents · data_clique · data_interacao · data_fechamento · cliente_id FK→cliente(nullable, preenchido na conversão)`

**`blacklist`** — supressão **global** de disparo, cross-unidade (R9). Chave = telefone.
`id PK · whatsapp_e164 UQ · motivo ‹blacklist_motivo› · origem_unidade_id · origem_matricula · evidencia jsonb · created_at`
*MUST-FIX: gerar `evento` de auditoria LGPD em toda inclusão (R19).*

### Módulo 3 — Cobrança

**`ciclo_cobranca`** — **um episódio de inadimplência** (= `cliente_cadencia` promovido). **Entidade, não coluna** (R5, R6): volta a dever ⇒ **novo** ciclo (`ciclo_numero+1`), nunca reativa.
`id PK · cliente_id FK→cliente · unidade_id FK→unidade · regua · ciclo_numero · dia_ciclo · status ‹ciclo› · entrou_em · finalizado_at · pago_at · UQ_parcial(cliente_id) WHERE status ativo` (R5)
*Régua vem do BI; o motor só **pausa/retoma**, nunca redefine (R8).*

**`disparo`** — **evento**: 1 linha por mensagem programada/enviada.
`id PK · ciclo_id FK→ciclo_cobranca · unidade_id · phone_number_id FK→phone_number · template_id FK→template · scheduled_for · status ‹disparo› · wa_message_id UQ_parcial · health_color_no_envio` (R90, R91)

**`saida_cobranca`** — **evento** append-only: quem saiu da cobrança e por quê (= `cobranca_clientes_removidos`).
`id PK · cliente_id FK→cliente · motivo ‹saida_motivo› · valor_no_momento_cents · regua_no_momento · removido_em`

**`fila_humana`** — **caso de exceção** que precisa de humano (dia-22, bloqueio, falha). Lifecycle próprio (R11, R12).
`id PK · cliente_id FK→cliente · ciclo_id FK→ciclo_cobranca · motivo · status ‹fila› · assigned_to FK→operador · assigned_at · resolved_at · resolved_outcome · notes`
*MUST-FIX: trigger de `updated_at` (hoje congela, R20). **Decisão §8-D3:** unificar com `conversa`/atendimento?*

### Módulo 4 — Pagamentos

**`pagamento`** — **o LEDGER** (evento, verdade financeira). 1 cliente → N pagamentos. **Nunca** é coluna do cliente.
`id PK · cliente_id FK→cliente · unidade_id · valor_cents · forma · gateway · correlation_id UQ_parcial · data_pagamento · reembolsado bool ‹reembolso› · baixa_interna bool ‹baixa›` (R7, R31, R37, R38)
*Cliente carrega só **projeção** (`pagamento_feito`, `ultimo_pagamento_at`) — verdade fica aqui.*

**`link_pagamento`** — **entidade** com ciclo próprio (1 pendente por cliente, R32).
`id PK · cliente_id FK→cliente · unidade_id · valor_cents · regua · gateway · correlation_id · status ‹link› · expires_at · UQ_parcial(unidade_id, matricula) WHERE status=pending` (R32, R34, R35)

**`pagamento_orfao`** — **evento** de reconciliação (pagamento sem matrícula resolvida; a verdade não se perde, R42).
`id PK · gateway · gateway_correlation_id · payer_phone · valor_cents · status ‹orfao› · cliente_reconciliado_id · UQ(gateway, gateway_correlation_id)`

**`gateway_config`** — **config**/cofre de credenciais por unidade (R41).
`unidade_id FK→unidade · platform · api_key (Vault/cifrado, não texto puro) · payout_enabled · is_active`

**`payout`** + **`payout_pagamento`** — repasses PIX e sua junção (1 pagamento em ≤1 payout, R33).
`payout: id PK · unidade_id · amount_cents · status ‹payout› · external_id UQ` · `payout_pagamento: payout_id FK · pagamento_id FK→pagamento UQ`

### Módulo 5 — Atendimento (chat)

**`conversa`** — **a entidade que faltava** na sua lista; o "handoff" é um evento dela (R47, R49).
`id PK · unidade_id · contato_id FK→contato · phone_number_id FK→phone_number · status ‹conversa_status› · routing ‹routing› · handoff_reason · assigned_operator_id FK→operador · last_inbound_at · customer_window_expires_at · UQ_parcial(contato_id) WHERE status=open` (R47, R48, R50)

**`mensagem`** — **evento** append-only do thread (R51, R56).
`id PK · conversa_id FK→conversa · wa_message_id UQ · direction · type · payload jsonb · sent_by ‹autor› · status ‹msg_status› · operador_id FK→operador`

**`conversa_evento`** — **evento**: transições do atendimento (incl. o **handoff**). É aqui que o handoff "mora" como fato (R49).
`id PK · conversa_id FK→conversa · tipo ‹conversa_evento_tipo› · actor_id · payload · created_at`

**`push_subscription`** — infra de notificação (Web Push por device).
`id PK · operador_id FK→operador · endpoint · p256dh · auth · UQ(operador_id, endpoint)`

### Módulo 6 — Orquestração (motor) & Módulo 7 — Auditoria

**`gate_unidade`** — estado de saúde→réguas liberadas (1:1 com unidade, R86).
`unidade_id PK FK→unidade · health_color_calc · health_color_override · health_color_efetivo · reguas_efetivas[]`

**`regua_plano`** / **`slot_config`** / **`gate_config`** — **config-as-data** da cadência. **Consolidar os DOIS engines** de hoje (R95) num só.

**`system_flag`** — kill-switches globais (R82, R87). `key PK · value jsonb`

**`agente_ia`** — prompts de IA, **com versionamento** (hoje sem histórico, R96). `id PK · nome · prompt · versao · ativo`

**`evento`** ⭐ — **a timeline universal** (= `event_log`). Append-only, imutável. É **a feature de clareza** (R88, R89): reconstrói a história de cada cliente.
`id PK · unidade_id · cliente_id FK→cliente · tipo · actor_type ‹actor› · payload jsonb · parent_event_id FK→evento(self) · correlation_id · created_at`

---

## 4. Os EVENTOS vs as ENTIDADES (resumo)

| Append-only (EVENTO) | Entidade (estado vivo + ciclo) | Config / Catálogo |
|---|---|---|
| `pagamento`, `pagamento_orfao` | `unidade`, `operador`, `cliente`, `contato`, `lead` | `gateway_config` |
| `disparo`, `saida_cobranca` | `ciclo_cobranca`, `link_pagamento`, `fila_humana` | `regua_plano`, `slot_config`, `gate_config` |
| `mensagem`, `conversa_evento` | `conversa`, `waba`, `phone_number`, `template` | `system_flag`, `agente_ia` |
| `evento` (timeline), snapshots de saúde, `template_status_evento` | `blacklist`, `payout`, `gate_unidade` | `papel` (enum) |

**Teste aplicado:** "quantos por cliente ao longo do tempo?" → vários = evento (tabela). "um valor agora?" → coluna. (pagamento/link/mensagem/disparo = **tabelas**, nunca colunas do cliente.)

---

## 5. Máquinas de estado (os `‹enum›` — o que o modelo precisa garantir)

| enum | valores | transição-chave |
|---|---|---|
| `trilho` | `cobranca` · `relacionamento` · `nenhum` | mutuamente exclusivo; pagar → sai de cobrança (R22) |
| `ciclo` | `ACTIVE` · `PAUSED_REGUA_MORTA` · `PAUSED_BLOQUEADO` · `PAGO` · `FINALIZADO` | dia>21 → FINALIZADO + fila_humana (R11); pagou → PAGO (R7) |
| `disparo` | `PROGRAMADA` · `ENVIADA` · `ENTREGUE` · `LIDA` · `PULADA` | bloqueio → futuras viram PULADA (R83) |
| `link` | `pending` · `paid` · `expired` · `cancelled` | mudou régua/valor → cancela (R10, R35); 7d → expired (R34) |
| `reembolso` / `baixa` | `false`→`true` | **independentes** entre si (R38); reembolso one-way (R37) |
| `orfao` | `pendente` · `reconciliado` · `descartado` | reconcile vincula matrícula (R42) |
| `payout` | `PENDING` · `COMPLETE` · `FAILED` | insert PENDING antes do POST (R40) |
| `routing` | `ai` · `queued` · `human` | IA→fila (handoff agent-tools); fila→humano (operador assume) (R49) |
| `conversa_status` | `open` · `snoozed` · `closed` | 1 open por contato (R47) |
| `template_meta` | `APPROVED` · `REJECTED` · `PAUSED` · `PENDING` | **+** `paused_by_sentinel` é máquina **separada** (R74) |
| `funil_vendas` | (a definir) `novo`→`em_contato`→`ganho`/`perdido` | ganho → converte em cliente (R28) |
| `fila` | `aberto` · `atribuido` · `resolvido` | dedup: só 1 aberto por cliente (R12) |
| `blacklist_motivo` | `SAIR` · `Meta` · `invalido` · `LGPD` | append-only (R9) |
| `bloqueio/pausa` | `ativo` · `bloqueado(~30d)` · `pausado_ate_data` | cron expira (R12) |

---

## 6. Regras de negócio → onde viram garantia

As 106 regras viram **3 tipos de garantia** no v3 (algumas exemplares):

**(a) Constraint no banco (o banco impede o erro):**
- `UQ(unidade_id, matricula)` em cliente; `UQ_parcial 1 ciclo ativo` (R5); `UQ_parcial 1 link pending` (R32); `UQ(gateway, correlation)` por stream (R31); 1 conversa aberta por contato (R47); FK `payout↔pagamento RESTRICT` (R33). Dinheiro `integer cents` (R3).

**(b) Lógica de domínio (função/trigger):**
- Pagar → sai da cobrança + guard 48h anti-regressão (R7); mudança régua/valor → cancela links (R10); dia-22 → fila_humana (R11); bloqueio → ciclo PAUSED + disparos PULADA + fila (R12, R83); cooldown 7d relacionamento (R24); janela 24h Meta por inbound (R48); gate saúde → réguas (R86); SANITY GATE anti-wipe no import (R13); kill-switch global (R82).

**(c) Invariante de modelo (decisão de schema):**
- Trilho mutuamente exclusivo numa coluna (R22); ciclo como entidade append-only (R6); ledger separado da projeção (R7); template identity `(name, waba_id)` (R72); um único vínculo operador↔unidade (R100); número WhatsApp unificado (R61); timeline universal `evento` (R89).

---

## 7. ERD (árvore de dependência)

```
unidade ─┬─ operador_unidade ── operador ─┬─ operador_papel
         │                                └─ (assigned_operator_id em conversa/fila)
         ├─ waba ─┬─ phone_number ──< disparo, conversa, (snapshots de saúde)
         │        └─ template ──< disparo, template_status_evento
         ├─ contato ──< conversa ──< mensagem, conversa_evento
         │     └─ cliente ─┬─ ciclo_cobranca ──< disparo, fila_humana
         │                 ├─ pagamento (ledger)   ──< payout_pagamento ── payout
         │                 ├─ link_pagamento
         │                 ├─ saida_cobranca
         │                 └─ (projeção: pagamento_feito, trilho, saida_at)
         ├─ lead ····(converte)···▶ cliente
         ├─ gate_unidade, gateway_config, regua_plano, gate_config, slot_config
         └─ evento (timeline: referencia cliente_id/unidade_id) ⭐

global (sem unidade): blacklist · system_flag · papel(enum) · agente_ia
```

---

## 8. Decisões em aberto (precisam da sua confirmação)

São as escolhas de sênior que mudam o desenho — recomendo, mas você decide:

- **D1 — `contato` separado de `cliente`?** **Recomendo sim.** Um inbound de número desconhecido ou um lead existem **antes** de ter matrícula. `contato` = identidade de mensagem (âncora da conversa e da timeline); `cliente` = papel de filiado (matrícula, cobrança, pagamento). Você mantém sua "tabela única de clientes"; `contato` é a camada fina por baixo. *Alternativa:* fundir tudo em `cliente` com `wa_id` — mais simples, mas não acomoda lead/desconhecido limpo.
- **D2 — Consolidar os DOIS engines de cadência** (R95: "Motor v2" `cadence_calendar` vs "Strategic Swarm F1" `cadence_slot_config`). **Recomendo escolher UM** no greenfield — hoje são duas codificações da mesma estratégia. Qual está mais correto/atual?
- **D3 — `fila_humana` e `conversa` se fundem?** Ambos são "um humano precisa cuidar deste cliente" (R: fila_humana nota sobreposição com `routing`). Podem ser **um só** conceito de atendimento, ou ficar separados (cobrança-exceção vs chat). Sua call.
- **D4 — `lead → cliente`:** conversão **cria** um `cliente` novo e linka (`lead.cliente_id`), ou o lead **vira** um cliente (mesma linha muda de papel)? Recomendo **criar+linkar** (preserva o histórico de vendas).
- **D5 — Escopo do piloto:** o projeto novo gerencia **dinheiro de verdade** (pagamentos/payouts) já no piloto, ou começa só com cliente+cobrança+atendimento e os gateways vêm depois? (Afeta quanto do Módulo 4 entra na primeira leva.)

---

## 9. MUST-FIX herdados (bugs a **não** replicar)

| # | O que | Regra |
|---|---|---|
| 1 | **RLS de verdade por unidade** (acabar com `qual=true` que vaza cross-unidade) | R18 |
| 2 | **Um único** vínculo operador↔unidade (hoje 2 sistemas com chaves divergentes → RLS quebrada) | R100 |
| 3 | **Dinheiro em `integer cents`** consistente; sem COMMENT "em reais" mentiroso | R30 |
| 4 | **`updated_at` com trigger** em toda entidade mutável (hoje `fila_humana` congela) | R20 |
| 5 | **Auditoria LGPD** automática na blacklist (gerar `evento`) | R19 |
| 6 | **Sem `is_active_in_cadence`** (flag morta); gate de template = `status+paused_by_sentinel` | R70, R71 |
| 7 | **Credencial de gateway cifrada** (Vault), não texto puro | R41 |
| 8 | **TTL/retenção** em logs (webhook, freshness, evento) — não crescer sem limite | R45, R97 |
| 9 | **Sem DELETE-físico** pra representar estado; `saida_at`/soft-delete + evento | R7, R46 |
| 10 | **Taxa de payout configurável** (hoje 80c hardcoded) | R39 |

---

## 10. Fora de escopo / descartado no greenfield

- **Infra de sync do n8n** (`cobranca_sync_backup`, `sync_snapshots`, `spreadsheet_sync_log`): só entram **se** o projeto novo assumir o import de planilha do `/upload`.
- **Mortas:** `todos`, `webhook_configs`, `template_master`, `agents_bak_*`, e a coluna `raw_data` de adimplentes (234 MB inúteis) — **não recriar**.
- **`faturamento_baixas`:** livro de baixas manuais com dono em outro repo — avaliar se o v3 gerencia (R46).
- **God-tables `setembro`/`dashboard`:** **deixam de existir** como tabelas; viram `cliente` + `ciclo_cobranca` + `pagamento` + `evento` + views de relatório.

> **Próxima etapa concreta:** com as decisões D1–D5 confirmadas, escrevo o **DDL completo do projeto novo** (todas as tabelas, enums, FKs, constraints, RLS e as funções de domínio que garantem as regras da §6) — pronto pra subir no Supabase novo e plugar nos fluxos n8n da unidade-piloto.
```
