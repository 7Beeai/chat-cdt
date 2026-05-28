# 4. Contrato com o n8n

O CHAT-CDT coexiste com o fluxo n8n no mesmo banco Supabase. Para o atendimento humano funcionar **sem perder contexto e sem competir** com a IA, o fluxo n8n precisa de **3 ajustes SQL** pequenos.

> O usuário (Victor) confirmou explicitamente que aceita 2-3 ajustes SQL no n8n. Esta é a versão definitiva.

## Os 3 ajustes

### Ajuste 1 — Gravar uma cópia do outbound da IA em `messages`

Onde: **depois do nó que envia mensagem via Graph API** no fluxo n8n.

Por quê: sem isso, o operador não vê o que a IA falou antes do handoff. Contexto perdido = pior UX.

SQL:
```sql
insert into messages (
  conversation_id, wa_message_id, direction, type,
  payload, sent_by, status, created_at
)
select
  c.id,
  :wamid,          -- id retornado pelo Graph
  'out',
  :type,           -- 'text' | 'template' | etc.
  :payload::jsonb, -- corpo enviado para a Graph
  'ai',
  'sent',
  now()
from conversations c
join contacts ct on ct.id = c.contact_id
where ct.wa_id = :wa_id
  and c.status = 'open'
on conflict (wa_message_id) do nothing;
```

Notas:
- A conversation já existe (criada pelo webhook do CHAT-CDT no primeiro inbound do cliente).
- Se por algum motivo não existir ainda (cliente foi disparado primeiro pela IA, sem inbound prévio), a inserção fica sem efeito. **Esse caso edge precisa ser tratado separadamente** — ver "Casos a observar" no fim.

### Ajuste 2 — Marcar handoff em `conversations.routing`

Onde: no momento em que a IA decide pedir humano.

Por quê: é o sinal que o CHAT-CDT consome para alimentar a inbox + disparar push.

SQL:
```sql
update conversations
   set routing        = 'queued',
       handoff_reason = :reason::chat_handoff_reason,  -- 'payment_re_register' | 'cancel' | 'other_support'
       priority       = :priority                       -- inteiro, opcional (default 0)
 where contact_id = (select id from contacts where unit_id = :unit_id and wa_id = :wa_id)
   and status = 'open';
```

Notas:
- Trigger `trg_chat_notify_handoff` dispara automaticamente push fanout via pg_net.
- Reason values são enum estrito: `payment_re_register`, `cancel`, `other_support`.

### Ajuste 3 — Ler `conversations.routing` antes de cada envio

Onde: no início do fluxo de envio do n8n (antes de chamar a Graph).

Por quê: enquanto o operador está conduzindo (`routing='human'`) ou a conversa está na fila (`routing='queued'`), a IA não pode responder. Sem essa checagem, há sobreposição de envios.

SQL (versão que retorna boolean):
```sql
select exists (
  select 1
    from conversations c
    join contacts ct on ct.id = c.contact_id
   where ct.unit_id = :unit_id
     and ct.wa_id   = :wa_id
     and c.status   = 'open'
     and c.routing  = 'ai'
) as ai_may_send;
```

Se `ai_may_send = false`, abortar o envio.

## Fluxo de devolução pra IA (do lado CHAT-CDT)

Quando o operador clica "Devolver para IA":
```sql
update conversations
   set routing             = 'ai',
       assigned_operator_id = null
 where id = :conversation_id;
```

n8n, na próxima rodada de cadência, vai ler `routing='ai'` (Ajuste 3) e voltar a responder normalmente.

## O que NÃO mudou no n8n

- `message_log` continua sendo escrito do jeito que era (auditoria do n8n + pricing + status do Graph).
- `message_inbound` continua sendo escrito (n8n recebe seu próprio webhook).
- `clientes_cobranca_*` intocada. Cadência interna (`cadence_branch_state`, `bloqueio_disparos`, etc.) é do n8n e não duplicamos.
- Tokens, webhooks, e Meta App original do n8n permanecem como estão. CHAT-CDT é app **paralelo** assinado nas mesmas WABAs.

## Casos a observar

### A. Cliente que nunca mandou inbound recebe handoff
Edge case: a IA pode tentar marcar `routing='queued'` sem haver `conversation.id` (porque webhook nunca rodou para esse contato).

**Mitigação na v1**: o n8n só pode pedir handoff DEPOIS de uma resposta do cliente. Se isso for restritivo, criar endpoint `/api/handoff` que aceita `{ unit_id, wa_id, reason }`, cria contact + conversation se faltar, e seta routing.

### B. Webhook do CHAT-CDT falha mas o do n8n funciona
Eventos do Meta retentam por 7 dias. Se o CHAT-CDT ficou fora do ar, ao voltar processa o backlog. Banco fica consistente.

### C. Race: n8n e CHAT-CDT recebem o mesmo inbound ao mesmo tempo
Resolvido por `UNIQUE INDEX uniq_open_conv_per_contact ON conversations (contact_id) WHERE status = 'open'`. Webhook do CHAT-CDT trata `23505` (unique_violation) com re-SELECT.

### D. Cliente sai da base e volta
`contacts` é keyed por `(unit_id, wa_id)`, sobrevive ao churn de `clientes_cobranca_*`. Quando voltar, JOIN volta a casar.

## Resumo prático

| Quem | Quando | Faz |
|---|---|---|
| **n8n** | Após enviar mensagem da IA | `INSERT INTO messages ... sent_by='ai'` |
| **n8n** | Ao decidir handoff | `UPDATE conversations SET routing='queued', handoff_reason=...` |
| **n8n** | Antes de cada envio | `SELECT exists(...) WHERE routing='ai'` — gate |
| **CHAT-CDT** | Operador devolve | `UPDATE conversations SET routing='ai', assigned_operator_id=null` |
| **CHAT-CDT** | Inbound novo | `INSERT INTO messages ... sent_by='customer'` |
| **CHAT-CDT** | Operador envia | `INSERT INTO messages ... sent_by='operator'` + chama Graph |
