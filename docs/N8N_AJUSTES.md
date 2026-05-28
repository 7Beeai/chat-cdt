# Ajustes no fluxo n8n para coexistir com o CHAT-CDT

> **Para quem mantém o fluxo n8n da IA de cobrança CDT.**
>
> Estamos subindo uma plataforma própria de **atendimento humano** (CHAT-CDT) para os casos em que a IA precisa repassar (recadastro de pagamento, cancelamento, suporte fora do roteiro). Essa plataforma usa o **mesmo Supabase** (`ubwcxktaruxqacxltovq`) e está assinada nas **mesmas 13 WABAs** do app n8n via segundo Meta App.
>
> Para os dois sistemas conviverem sem se atropelar, o fluxo n8n precisa de **3 ajustes SQL pequenos**. Sem eles, o pior caso é: cliente pede para cancelar, operador humano assume, IA continua respondendo por cima dizendo "olá, tudo bem?" — desastre de UX e potencial confusão jurídica.
>
> Estimativa total: **30–60 min** de trabalho no fluxo (a complexidade está em localizar os nós certos, os SQLs são triviais).

---

## Visão geral

A coordenação CHAT-CDT ↔ n8n acontece via 1 coluna nova na tabela `conversations`:

```
conversations.routing  enum ('ai' | 'queued' | 'human')
```

| Valor | Significado | Quem escreve |
|---|---|---|
| `ai` (default) | IA está conduzindo a conversa | n8n + CHAT-CDT (devolução) |
| `queued` | IA decidiu repassar para humano, aguardando operador pegar | **n8n** (no momento do handoff) |
| `human` | Operador assumiu | CHAT-CDT (botão "Assumir") |

**Regra de ouro do n8n**: antes de enviar qualquer mensagem da IA via Graph API, conferir se `routing = 'ai'`. Se não for, **abortar o envio**.

E, complementarmente, quando a IA decide repassar, **escrever** `routing = 'queued'` para sinalizar pra plataforma do operador.

---

## Esquema das tabelas relevantes (não alterar — só ler/escrever)

```sql
-- Contato (uma linha por wa_id por unidade)
contacts (id, unit_id, wa_id, name, profile jsonb, created_at, ...)
  UNIQUE (unit_id, wa_id)

-- Conversa aberta (uma por contato enquanto status='open')
conversations (
  id, unit_id, contact_id, phone_number_id,
  status,   -- 'open' | 'snoozed' | 'closed'
  routing,  -- 'ai' | 'queued' | 'human'    <-- esse é o sinal
  handoff_reason,  -- 'payment_re_register' | 'cancel' | 'other_support'
  priority,
  assigned_operator_id,
  last_inbound_at,
  customer_window_expires_at,
  opened_at,
  closed_at
)

-- Mensagens da plataforma (paralela à message_log que continua sendo do n8n)
messages (
  id, conversation_id, wa_message_id, direction, type,
  payload jsonb, sent_by, status, operator_id, created_at
)
```

**O CHAT-CDT já cria contact e conversation automaticamente** no primeiro inbound do cliente (via webhook próprio assinado na mesma WABA). Ou seja: para o n8n, na maioria dos casos, `contact` e `conversation` já existirão quando você for fazer os UPDATE/INSERT abaixo.

---

## Ajuste 1 — Gravar uma cópia do outbound da IA em `messages`

### Por quê
Sem isso, quando o operador humano assume a conversa, ele **não vê** o que a IA falou antes do handoff. Contexto perdido = ele vai começar do zero e o cliente vai se irritar.

### Onde no fluxo
Imediatamente **depois** do nó "Send Message" / "HTTP Request" que chama `graph.facebook.com/.../messages` com sucesso (status 200 e `messages[0].id` no response).

### SQL (rodar via nó Postgres do n8n, mesma conexão Supabase que vocês já usam)

```sql
insert into messages (
  conversation_id, wa_message_id, direction, type,
  payload, sent_by, status, created_at
)
select
  c.id,
  $1,                  -- wa_message_id retornado pela Graph (messages[0].id)
  'out',
  $2,                  -- tipo: 'text' | 'template' | 'image' | etc.
  $3::jsonb,           -- corpo enviado para a Graph (o objeto inteiro)
  'ai',
  'sent',
  now()
from conversations c
join contacts ct on ct.id = c.contact_id
where ct.unit_id = $4    -- unit_id do contexto da unidade
  and ct.wa_id   = $5    -- wa_id do destinatário
  and c.status   = 'open'
on conflict (wa_message_id) do nothing;
```

### Mapeamento dos parâmetros

| `$` | Vem de | Tipo |
|---|---|---|
| `$1` | response da Graph: `body.messages[0].id` | text |
| `$2` | o `type` do envio: `text`, `template`, etc. | text |
| `$3` | o body que você enviou pra Graph (JSON inteiro) | jsonb |
| `$4` | unit_id da unidade (você já tem isso no contexto do fluxo) | uuid |
| `$5` | wa_id do cliente (E.164 sem `+`) | text |

### Comportamento esperado
- Se a `conversation` ainda não existe (cliente nunca mandou inbound), o INSERT não afeta nada (zero rows). Não é erro.
- Se rodar 2x com mesmo `wa_message_id`, idempotente (`on conflict do nothing`).

### Como testar
Após próximo envio da IA, conferir via SQL Editor do Supabase:
```sql
select created_at, sent_by, payload->>'body' as text, status
  from messages
 where direction = 'out' and sent_by = 'ai'
 order by created_at desc limit 5;
```
Deve aparecer a mensagem que a IA acabou de mandar.

---

## Ajuste 2 — Marcar `routing='queued'` quando a IA decide repassar

### Por quê
Esse é o sinal que faz a inbox do CHAT-CDT acender e dispara push notification pro operador.

### Onde no fluxo
No nó onde a IA classifica que **não consegue resolver** o caso e decide chamar humano. Geralmente isso é o ponto onde o fluxo dela hoje fala "vou transferir você" ou silenciosamente para de responder.

### SQL

```sql
update conversations
   set routing        = 'queued',
       handoff_reason = $1::chat_handoff_reason,
       priority       = coalesce($2, 0)
 where contact_id = (
   select id from contacts where unit_id = $3 and wa_id = $4
 )
   and status = 'open';
```

### Mapeamento

| `$` | Vem de | Tipo | Valores aceitos |
|---|---|---|---|
| `$1` | classificação da IA | text → enum | **só estes 3**: `payment_re_register`, `cancel`, `other_support` |
| `$2` | prioridade opcional | int | inteiro, default 0 |
| `$3` | unit_id da unidade | uuid | — |
| `$4` | wa_id do cliente | text | — |

### Enum (importante)

`handoff_reason` aceita apenas:
- `payment_re_register` — recadastro de forma de pagamento após quitação
- `cancel` — cancelamento de assinatura
- `other_support` — qualquer outro caso fora do roteiro

Se a IA tentar gravar outro valor, dá erro `invalid input value for enum chat_handoff_reason`.

### Efeito colateral automático
Há um trigger no banco que dispara push notification pros operadores assim que essa UPDATE roda — não precisa fazer mais nada do lado do n8n.

### Como testar
```sql
select id, routing, handoff_reason, opened_at
  from conversations
 where contact_id = (select id from contacts where wa_id = '<wa_id_de_teste>')
 order by opened_at desc limit 1;
```
Após o UPDATE, `routing` deve estar `'queued'` e `handoff_reason` preenchido.

---

## Ajuste 3 — Gate `routing='ai'` antes de cada envio (CRÍTICO)

### Por quê
**Esse é o ajuste que evita o pior cenário**: enquanto o operador está conduzindo (`routing='human'`) ou aguardando alguém pegar (`routing='queued'`), a IA não pode responder.

Sem esse gate: cliente pede pra cancelar → operador assume → IA continua mandando "olá, percebi que você está em atraso" por cima.

### Onde no fluxo
**No início absoluto** do fluxo de envio da IA — antes de qualquer chamada Graph, antes de qualquer prompt LLM, antes de qualquer template render.

Se vocês têm uma cadência batch (envio em massa programado), o gate roda **dentro do loop**, uma vez por cliente, no momento exato antes do POST pra Graph.

### SQL (versão boolean — mais simples de usar em condicional do n8n)

```sql
select exists (
  select 1
    from conversations c
    join contacts ct on ct.id = c.contact_id
   where ct.unit_id = $1
     and ct.wa_id   = $2
     and c.status   = 'open'
     and c.routing  = 'ai'
) as ai_may_send;
```

### Lógica no n8n
```
if ai_may_send == true   → prossegue para enviar
if ai_may_send == false  → ABORTA o envio (log opcional, não é erro)
```

### Edge cases

| Cenário | `ai_may_send` |
|---|---|
| Conversa não existe ainda (cliente novo, nunca mandou inbound) | `false` — IA não envia (na v1 evitamos disparo proativo cego) |
| Conversa existe, `routing='ai'` | `true` — envia normal |
| Operador assumiu, `routing='human'` | `false` — bloqueia |
| Cliente respondeu e foi pra fila, `routing='queued'` | `false` — bloqueia |
| Operador encerrou, `status='closed'` | `false` — bloqueia |

> Sobre o primeiro caso (cliente novo): se a IA hoje faz **disparo proativo** sem inbound prévio, precisamos discutir um endpoint `/api/handoff` ou política diferente. Não é cobertura da v1.

### Como testar
1. Pega um wa_id real de uma conversa aberta.
2. Roda manualmente:
   ```sql
   update conversations set routing='human'
    where contact_id = (select id from contacts where wa_id='<wa_id>');
   ```
3. Provoca a cadência da IA pra esse cliente.
4. Esperado: IA **não envia** (o gate retornou false).
5. Reverte:
   ```sql
   update conversations set routing='ai'
    where contact_id = (select id from contacts where wa_id='<wa_id>');
   ```

---

## Devolução do operador para a IA (não precisa mexer no n8n)

O CHAT-CDT tem botão "Devolver para IA" que roda:
```sql
update conversations
   set routing             = 'ai',
       assigned_operator_id = null
 where id = $1;
```

A IA, na próxima passada da cadência, vê `routing='ai'` (Ajuste 3 retorna true) e volta a responder normalmente. **Nenhuma alteração necessária no fluxo n8n para isso funcionar.**

---

## Resumo prático em uma tabela

| Quando o fluxo n8n faz isso | Adicionar isto |
|---|---|
| **Antes** de cada envio Graph | Ajuste 3 — gate `routing='ai'`, se false aborta |
| **Depois** de cada envio Graph com sucesso | Ajuste 1 — INSERT na tabela `messages` |
| **Quando** a IA decide handoff | Ajuste 2 — UPDATE `routing='queued'`, handoff_reason |

---

## O que **NÃO** mudar (territórios do n8n preservados)

- `message_log` — continua sendo escrito do jeito que era (auditoria, pricing, status Graph).
- `message_inbound` — continua. n8n recebe seu próprio webhook do Meta App original.
- `clientes_cobranca_*` — intocada. Cadência interna (`cadence_branch_state`, `bloqueio_disparos`) é do n8n.
- `disparadores_whatsapp` — intocada. Embora o CHAT-CDT leia daí pra obter `phone_number_id`.
- Tokens, webhooks, e Meta App original do n8n permanecem. CHAT-CDT é app **paralelo** assinado nas mesmas WABAs.

---

## FAQ rápido

**P: O webhook do CHAT-CDT vai disputar com o do n8n?**
R: Não. Cada Meta App tem seu próprio callback URL. A mesma WABA está assinada nos dois apps simultaneamente — Meta envia cada evento em paralelo para ambos os callbacks. Cada um processa o próprio.

**P: E se o webhook do CHAT-CDT cair? A IA continua funcionando?**
R: Sim. O fluxo n8n é independente. Quando o CHAT-CDT voltar, processa o backlog (Meta retenta por 7 dias).

**P: Posso testar os 3 ajustes em ambiente de homologação primeiro?**
R: O banco Supabase é o mesmo de produção (não há clone de homolog). A forma segura de testar é usar **uma única conversa-piloto** (um wa_id que vocês controlam) e fazer os UPDATEs/INSERTs nessa conversa só, observando o comportamento.

**P: O que acontece com conversations que já existem hoje?**
R: Todas começam com `routing='ai'` (default da coluna). Funciona normalmente. Quando a IA fizer handoff (Ajuste 2), aí a conversa vira `queued`.

**P: Existe um histórico de mensagens da IA antes do Ajuste 1 ser aplicado?**
R: Não. Tudo o que a IA mandou antes desse ajuste estará só em `message_log` (sem ligação à conversation_id). Para o operador, vai parecer que a conversa começou do zero. Aceitável, não bloqueante.

---

## Quem decidiu o quê (referência cruzada)

- Arquitetura geral, decisões D1–D9: `docs/02-architecture.md`
- Schema completo do banco: `docs/03-database.md`
- Versão técnica original deste documento: `docs/04-n8n-contract.md`
- Status do projeto: `docs/08-status.md`

---

## Contato

Dúvidas sobre o schema ou comportamento esperado: Victor (`victor@7bee.ai`).
