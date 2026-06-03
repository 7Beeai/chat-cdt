# Análise do banco CDT (`ubwcxktaruxqacxltovq`) — índice

Mapeamento **coluna a coluna**, read-only, de tudo que a operação CDT usa neste banco (CHAT-CDT + n8n/cobrança, produção compartilhada). Snapshot: **2026-06-02** (America/Sao_Paulo). `pg_stat_statements` reflete uma janela de **~13h** (reset 2026-06-01 14:11Z) — ver caveat nos docs.

## Como ler
1. Comece por **`00-resumo.md`** (panorama, domínios, janela do snapshot, top achados).
2. **`11-plano-reorg.md`** = o plano fundamentado (acoplamento, peso morto, segurança por severidade, ordem de reorg). Não desenha a v2.
3. Aprofunde por tabela em **`02-tabelas/<tabela>.md`** (59 arquivos, deep dive coluna a coluna).

## Estrutura
| Arquivo | Conteúdo |
|---|---|
| `00-resumo.md` | Contagens, domínios, mapa de alto nível, data/janela do snapshot, falhas de extração. |
| `01-inventario.md` | Inventário completo: tabelas, views, funções, triggers, enums, índices, edge functions, extensões, crons. |
| `02-tabelas/` | **59 MDs**, um por tabela: identificação, finalidade, colunas (origem/consumidores/confiança), FKs, índices, triggers, RLS, quem escreve/lê, observações. |
| `03-funcoes.md` | 115 funções: secdef, search_path, tabelas/colunas tocadas, finalidade. |
| `04-views.md` | 11 views: definição, tabelas-fonte, métrica (as 3 `*_mes_atual` são o dashboard financeiro). |
| `05-triggers.md` | 27 triggers + os Database Webhooks (`cancel_links…` → edge). |
| `06-edge-functions.md` | 20 edge functions: gatilho, auth, tabelas/rpcs/colunas, secrets, segurança. |
| `07-n8n.md` | 6 workflows n8n: gatilho, agenda, tabelas/rpcs/edge, integração n8n↔chat. |
| `08-dependencias.md` | Grafo de dependência + matriz quem-lê/quem-escreve das 59 tabelas + classificação. |
| `09-fluxo-planilha.md` | Pipeline Drive → `sync_cobranca_v2` → `clientes_cobranca_*` destrinchado. |
| `10-seguranca.md` | Achados de segurança e performance por severidade (Alta/Média/Baixa), com evidência. |
| `11-plano-reorg.md` | **Plano de reorganização** fundamentado nos achados (sem desenhar v2). |
| `12-design-v2.md` | **Desenho do schema v2** do núcleo de cobrança: tabela canônica `cobranca_casos` + views de compat (`setembro`/`dashboard`), writer-split, modelos transversais (dinheiro/RLS/naming), e plano de migração expand/contract — explicativo + DDL. |
| `13-modelo-entidades-v3.md` | **Modelo de entidades greenfield** (projeto novo, piloto 1 unidade): entidades/eventos/estados de todo o ciclo (vendas→relacionamento→cobrança→atendimento + pagamentos + WhatsApp/templates + orquestração), ERD, enums das máquinas de estado, 106 regras de negócio, MUST-FIX herdados e decisões em aberto. Destilado de toda a análise. |
| `14-modelo-explicado-simples.md` | **O documento 13 em linguagem natural** — o modelo novo explicado com a analogia do "arquivo de fichas", sem jargão técnico. Para entender as entidades/eventos/regras sem precisar ler o ERD. |
| `discovery-cdt.sql` | Script read-only reproduzível da extração (todos os blocos). |
| `raw/` | Saídas cruas (bloco-01..14 + edge/n8n/functions/views-analysis) — trilha de auditoria. |

## Metodologia (resumo)
- **Read-only** via MCP Supabase + leitura dos 6 workflows n8n (`fluxosn8n/`) e do código das 20 edge functions.
- **Confiança** por coluna: `confirmado` (referência inequívoca `tabela.coluna`), `inferido` (com evidência) ou `sem consumidor identificado` (nunca "morta").
- **Pontos cegos declarados**: a app Next.js (`app/`+`lib/`) é invisível às 5 fontes de backend; matriz de GRANTs não extraída; janela de stats ~13h. Ver `08` §nota e `10` §honestidade.

## Números-chave
59 tabelas · 11 views · 115 funções (96 SECDEF) · 27 triggers · 10 enums · **64** policies (em `public`; a 65ª é de `storage.objects`) · 229 índices · 20 edge functions · 6 workflows n8n · **10** cron jobs ativos (jobid 2 ausente) · 1 bucket (`chat-media`, 1.563 objetos / 153 MB).
