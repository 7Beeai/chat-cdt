# Análise da fila other_support — 2026-06-12

Análise feita por agente lendo ~80 conversas em profundidade + 100 triagens de
trigger, via SQL read-only no Supabase. Objetivo: entender os motivos reais de
handoff pra decidir se aperta o critério da Isa.

## Panorama (últimos 30 dias)

- other_support total: 2.585 conversas (1.079 abertas + 1.506 fechadas)
- Fila aguardando humano (open+queued): **973**
- Idade: 21% <1d, 59% 1–3d, 20% 3–7d; mais antiga enfileirada há 11 dias
- Spike: 2026-06-02 (366/dia), coincide com motor V2 multi-unidade; antes era 5–47/dia
- Por unidade: Cabo Frio 21%, Ibirité 18%, Porto Alegre 16%, Pouso Alegre 16%...
- **Fechamentos: 79% `cliente_nao_respondeu` (timeout), só 2% `resolvido`.**
  A fila não está sendo absorvida — clientes desistem esperando.

## Taxonomia dos motivos reais (amostra)

| Tema | % fila | Precisa humano? | Motivo correto? |
|---|---|---|---|
| A. Comprovante de pagamento enviado (img/doc) | ~15% | Parcial | Não — deveria ser payment_re_register |
| B. Link de pagamento não abre/inválido | ~13% | Às vezes | Sim |
| C. App: senha/login/e-mail trocado | ~13% | Sim | Sim |
| D. Cancelamento virando other_support | ~9% | Não (tel. da unidade) | **Não — viola a regra do prompt** |
| E. Não recebeu cartão físico | ~7% | Sim (rastreio) | Parcial |
| F. Dúvida informativa sobre dependentes | ~8% | Não (info está no prompt) | Não |
| G. Autoresposta WhatsApp Business / nº errado | ~8% | Não | Não — lixo de fila |
| H. Problema real clínica/exame | ~4% | Sim | Sim |
| I. Pedido explícito de humano sem motivo | ~6% | Às vezes | Ambíguo |
| J. Outros (reclamações, relatórios, PIX errado) | ~17% | Maioria sim | Maioria sim |

## Bugs de comportamento encontrados (prompt × prática)

1. **isa_ transfere cancelamento** apesar da regra absoluta "cancelar → telefone,
   nunca handoff" no próprio prompt (ex.: Cátia/Cabo Frio). ~9% da fila.
2. **isa_ transfere dúvida informativa de dependentes** que o prompt responde
   (regras: cônjuge, filhos até 21, R$10) — handoff era só pra INCLUSÃO.
3. **Autoresposta de WhatsApp Business** ("agradece seu contato... deixe sua
   mensagem") tratada como mensagem real → handoff. Problema de pré-processamento,
   não de prompt.
4. **Botão "Quero falar com a equipe"** → transfere direto sem perguntar motivo
   (prompt manda perguntar primeiro).
5. **Loop de mensagens duplicadas** no rafa_: 5 mensagens idênticas de "pausa até
   dia X" em sequência (Regiane/Pouso Alegre) — bug de runtime, não de prompt.
6. **rafa_ com comprovante**: cliente paga e manda foto → vira other_support;
   deveria ser payment_re_register (webhook já confirma o pagamento).

## Recomendações priorizadas

P0 (prompt, dias):
- R1: exemplo explícito anti-handoff de cancelamento na isa_ (~-9% fila)
- R2: separar "dúvida sobre dependentes" (responde) de "incluir" (handoff)
- R3: botão "falar com equipe" → perguntar motivo antes de transferir
- R4: auxílio funeral informativo → responder, não transferir

P1 (lógica, semanas):
- R5: rafa_: link já gerado + cliente manda img/doc = comprovante → reason payment_re_register
- R6: oferecer PIX copia-e-cola (brcode) quando o link não abre
- R7: filtro pré-LLM de autoresponder de WhatsApp Business (descartar silencioso)
- R8: botão "PODE MANDAR" sem intenção real — verificar contexto

P2 (estratégico):
- R9: requalificação automática da fila parada >4h (mensagem com opções)
- R10: SLA + triagem por unidade (79% de abandono é problema operacional)
- R11: FAQ de 1º nível pra senha/login antes de transferir

**Estimativa: R1+R2+R3+R7 reduzem a entrada de other_support em 30–40% sem
perder casos legítimos.** Os ~50–60% que precisam de humano de verdade
continuam — o gargalo restante é capacidade operacional (973 abertas, 2% de
resolução real).
