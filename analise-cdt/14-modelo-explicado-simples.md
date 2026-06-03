# 14 — O modelo novo explicado em português de gente

> Este é o **documento 13 traduzido pra linguagem humana**. Mesma coisa, sem palavra técnica. Se você entender este aqui, entendeu o 13 inteiro.

---

## A ideia em 1 minuto: imagine um arquivo de fichas

Pensa numa escola (cada **unidade** é uma escola/franquia). No fundo da sala tem um **armário de fichas**. A regra é simples:

- **Cada aluno tem UMA ficha.** Uma só. Sempre a mesma.
- Na **capa da ficha** ficam **etiquetas coladas** dizendo a situação de **agora**: "está devendo", "está em dia", "bloqueado".
- **Dentro da ficha** tem um **caderninho** onde você anota **tudo que acontece**, com a data, e **nunca apaga**.

E tem gavetas separadas pra outras coisas: os **interessados** que ainda não viraram alunos, os **números de WhatsApp** da escola, os **modelos de mensagem**, o **dinheiro** que entrou.

**A regra de ouro (a que conserta o seu problema):** a situação do aluno é uma **etiqueta na ficha**, e não "**em qual gaveta a pasta está**".

Hoje a bagunça é exatamente essa: pra saber se alguém pagou, o sistema olha "em qual gaveta a pasta está guardada" — e às vezes a **mesma pasta está em duas gavetas ao mesmo tempo**. Por isso ele cobra gente que já pagou, e ninguém tem clareza. No modelo novo: **uma ficha só, etiqueta clara, um caderninho com tudo**.

---

## As 3 coisas que a gente guarda (e os nomes técnicos)

No documento 13 aparecem palavras como "entidade", "evento", "estado". São só **três tipos de coisa**:

| Nome técnico | Em português de gente | Exemplo |
|---|---|---|
| **Entidade** | uma **ficha** — uma coisa que existe e tem nome próprio | o aluno, a escola, o interessado |
| **Evento** | um **acontecimento** — algo que aconteceu, anotado no caderninho com data (nunca apaga) | um pagamento, uma mensagem enviada |
| **Estado** | uma **etiqueta** — a situação de agora, colada na ficha (muda quando a situação muda) | "devendo", "em dia", "bloqueado" |

Pronto. **Ficha, acontecimento, etiqueta.** Todo o documento 13 é isso.

---

## As FICHAS (as coisas que existem)

### As pessoas
- **Aluno** — a ficha principal. Uma por pessoa, sempre ligada a uma escola. É a sua "tabela única de clientes".
- **Interessado** — alguém que demonstrou interesse mas **ainda não é aluno** (não tem matrícula). Quando fecha a venda, ele **vira** um aluno.
- **Telefone da pessoa** — o WhatsApp de quem fala com a gente. Existe **mesmo antes** de virar aluno (um número desconhecido pode mandar mensagem). É a "identidade" de quem está do outro lado.

### A escola e a equipe
- **Escola (unidade)** — a franquia. Tudo pendura nela.
- **Funcionário** — quem atende, cobra, vende.
- **Quem trabalha em qual escola** — a ligação entre funcionário e escola (um funcionário pode cuidar de mais de uma).
- **Cargo** — chefe (admin), cobrador, vendedor.

### O WhatsApp da escola
- **Conta de WhatsApp** — a conta oficial da escola no WhatsApp.
- **Número/linha** — cada número que a escola usa pra mandar mensagem (tem limite de quantas por dia).
- **Modelo de mensagem** — os textos prontos, **aprovados pelo WhatsApp**, que a escola pode disparar.

### O dinheiro
- **Maquininha (config de pagamento)** — a configuração da maquininha/gateway de **cada escola** (guardada em cofre, não exposta).

---

## Os ACONTECIMENTOS (o caderninho — nunca apaga)

- **Pagamento** — cada vez que alguém paga, cola um recibo no caderninho. Um aluno tem **vários** ao longo do tempo. **Esta é a verdade do dinheiro** — não é uma etiqueta solta na capa.
- **Link de pagamento** — o link de pix/cartão que a gente manda. Tem vida própria: foi gerado → enviado → pago → ou venceu → ou foi cancelado.
- **Disparo** — cada mensagem que o robô manda na sequência de cobrança.
- **Mensagem** — cada mensagem de uma conversa de atendimento.
- **Saída da cobrança** — a anotação de **quando e por quê** o aluno saiu da cobrança (pagou? sumiu da lista?).
- **Pagamento órfão** — um pagamento que **chegou mas não sabemos de quem** ainda. Fica anotado pra investigar — **o dinheiro nunca se perde**.
- **Diário do aluno (a linha do tempo)** ⭐ — o caderninho-mestre. Anota **tudo** que acontece com cada aluno, em ordem: entrou, atrasou, recebeu link, pagou, foi pra um humano. **É isto que te dá a clareza que falta hoje.**

---

## As ETIQUETAS (a situação de agora)

Cada etiqueta tem um conjunto fixo de situações possíveis. As principais:

- **Trilho do aluno:** `está em cobrança` **ou** `está em dia (relacionamento)` **ou** `nenhum`. **Nunca os dois ao mesmo tempo.**
- **Caso de cobrança:** `começando` → `pausado` → `pagou` → `terminou sem pagar`.
- **Link de pagamento:** `aguardando` → `pago` / `venceu` / `cancelado`.
- **Conversa de atendimento:** quem está respondendo? `o robô (IA)` → `na fila` → `um humano`.
- **Bandeja do humano:** `aberto` → `alguém pegou` → `resolvido`.
- **Lista do não-perturbe:** está na lista ou não.

---

## As REGRAS DA CASA (o que o sistema sempre garante)

Estas são as regras de negócio, em português. O sistema novo **obriga** que sejam cumpridas:

**Sobre cobrança e pagamento**
1. **Quem paga sai da cobrança e NÃO pode ser cobrado de novo.** (É exatamente o seu problema de hoje — aqui ele fica impossível.)
2. **Cada vez que o aluno atrasa, abre um caso de cobrança NOVO** — não remexe o caso velho. Assim a história fica limpa.
3. **O plano de cobrança (a "régua") vem da planilha.** O robô só **pausa e retoma**; nunca inventa um plano.
4. **Se mudar o valor ou o plano, os links de pagamento antigos são cancelados** (pra ninguém pagar valor errado).
5. **Passou 21 dias sem pagar → o caso vai pra bandeja do humano.**
6. **Bloqueou o cliente → para de mandar mensagem na hora** e abre um caso pro humano olhar.

**Sobre quem está em dia (relacionamento)**
7. **Uma pessoa ou está devendo, ou está em dia — nunca as duas coisas.**
8. **Pra quem está em dia, só manda mensagem a cada 7 dias** (não enche o saco).
9. **Quem pediu pra não receber, não recebe mais.**

**Sobre mensagens e WhatsApp**
10. **A lista do "não-perturbe" vale pra TODAS as escolas** e é consultada **antes de toda mensagem**.
11. **Depois que o cliente te manda mensagem, você tem 24h pra responder à vontade** (é a regra do WhatsApp; o sistema controla esse prazo sozinho).
12. **O robô não fala enquanto um humano está cuidando** da conversa — e vice-versa. Sem atropelo.
13. **Cada número de WhatsApp tem um limite diário** e o sistema espalha os envios pra não estourar.

**Sobre dinheiro e privacidade**
14. **Todo dinheiro é guardado em centavos** (número inteiro), pra nunca dar erro de arredondamento.
15. **Cada escola tem sua própria maquininha**, e a senha dela fica **trancada num cofre** — nunca exposta.
16. **Toda vez que alguém entra na lista do não-perturbe, fica registrado** (privacidade / LGPD).
17. **Cada escola só enxerga os próprios alunos.** (Hoje isso está furado — qualquer um vê tudo. No novo, fica trancado de verdade.)

---

## O que muda do jeito antigo pro novo (lado a lado)

| | **Hoje (bagunçado)** | **No modelo novo (organizado)** |
|---|---|---|
| Onde está a situação do aluno | em **qual gaveta a pasta está** (e às vezes em duas!) | numa **etiqueta na ficha** |
| Quando alguém paga | **arranca a pasta** de uma gaveta e mexe um papel na outra (dá pra dar errado) | **cola um recibo** no caderninho e muda a etiqueta — num lugar só |
| A história do aluno | **impossível de contar** (a pasta foi apagada/recriada e está espalhada) | **o diário conta tudo**, em ordem |
| Cobrar quem já pagou | **acontece** | **impossível por construção** |
| Saber o que está rolando | **ninguém tem clareza** | **lê a etiqueta** (situação) **ou o diário** (história) |

---

## As 5 perguntas que eu preciso que você responda

Antes de eu desenhar a parte técnica, preciso de 5 decisões suas (no documento 13 elas estão como "D1 a D5" — aqui em português):

1. **O "telefone da pessoa" deve ser uma ficha separada do "aluno"?** *Eu acho que sim* — assim um número desconhecido ou um interessado já existe antes de virar aluno. Você continua com sua ficha única de alunos; o telefone é só uma camadinha por baixo.
2. **Hoje existem DOIS jeitos de calcular a sequência de cobrança rodando ao mesmo tempo. Qual é o certo/atual?** No novo a gente fica com **um** só.
3. **A "bandeja do humano" (cobrança) e a "conversa com humano" (atendimento) são a mesma coisa ou separadas?** As duas são "um humano precisa cuidar deste cliente".
4. **Quando um interessado vira aluno: cria uma ficha de aluno nova e liga as duas, ou a ficha do interessado "vira" a do aluno?** *Eu acho* criar nova e ligar (guarda o histórico da venda).
5. **No piloto (a primeira escola), a gente já mexe com dinheiro de verdade** (pagamentos/repasses) **ou começa só com aluno + cobrança + atendimento** e o dinheiro entra depois?

Pode responder simples, tipo *"concordo com tudo"* ou *"no item 3, separadas"*. Com isso eu escrevo a parte técnica (o passo a passo pro programador montar no Supabase novo).

---

> **Resumindo de tudo:** uma ficha por pessoa, etiquetas claras na capa, um caderninho com tudo que acontece, e gavetas separadas pra interessados, dinheiro e WhatsApp. A situação do cliente passa a ser **uma coisa que você lê**, não **um lugar onde a pasta está escondida**. É isso que vai te dar controle e acabar com a cobrança de quem já pagou.
