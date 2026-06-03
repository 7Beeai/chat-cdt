# Análise do Banco de Dados — `ubwcxktaruxqacxltovq`

> Projeto Supabase compartilhado entre **CHAT-CDT** e **n8n** (produção).
> Snapshot gerado em **2026-06-01** via MCP Supabase (somente leitura).

## 📊 Visão geral — schema `public`

| Recurso | Quantidade |
|---|---|
| **Tabelas** | 59 |
| **Views** | 11 |
| **Funções (RPCs)** | 115 *(0 procedures/aggregates — todas são funções)* |
| **Enums** | 10 |
| **Triggers** | 34 |
| **Políticas RLS** | 64 |
| **Usuários (auth.users)** | 21 |
| **Storage buckets** | 1 (`chat-media`, privado) |
| **Storage objetos** | 1.557 arquivos (~152 MB) |
| **Edge Functions** | 20 (todas `ACTIVE`) |

## 🔧 Funções / RPCs

- **115 funções**, das quais **16 com prefixo `chat_`** (nossas, do CHAT-CDT) e **99 herdadas** do ecossistema n8n/cobrança.
- **96 são `SECURITY DEFINER`** — coerente com o padrão de RLS via helpers documentado no projeto.

## 🗄️ Maiores tabelas (volume real)

| Tabela | Linhas | Tamanho | Dono |
|---|---|---|---|
| `clientes_cobranca_dashboard` | 94 mil | **1.79 GB** | n8n |
| `message_log` | 262 mil | 291 MB | n8n |
| `adimplentes_base` | 157 mil | 234 MB | n8n |
| `event_log` | 42 mil | 49 MB | n8n |
| `clientes_cobranca_setembro` | 55 mil | 41 MB | n8n |
| `message_inbound` | 27 mil | 26 MB | n8n |
| `chat_webhook_events` | 17 mil | 19 MB | **CHAT-CDT** |
| `messages` | 23 mil | 16 MB | compartilhada |
| `conversations` | 4.192 | 1.7 MB | compartilhada |
| `contacts` | 4.191 | 1.2 MB | compartilhada |

> A `clientes_cobranca_dashboard` (1.8 GB) domina o storage — é a fonte de contexto de cobrança consumida via `chat_debtor_context`. Vale ficar de olho no crescimento dela.

## ⚡ Edge Functions (20)

Todas pertencem ao domínio **cobrança/pagamentos do n8n**, não ao chat:

- **Pagamentos/gateways**: `generate-payment-link`, `generate-payment-link-abacate`, `cancel-payment-links`, `process-reembolso`, `process-payouts`
- **Webhooks**: `woovi-webhook`, `stripe-webhook`, `abacate-webhook`
- **Reconciliação**: `reconcile-woovi-pull`, `reconcile-stripe-pull`, `reconcile-abacate-pull`
- **Motor v2**: `motor-v2-planejador`, `motor-v2-sortear-relacionamento`, `motor-v2-fechamento`
- **Sentinel (templates WhatsApp)**: `sentinel-generate-variation`, `sentinel-submit-template`
- **Outros**: `create-admin-users`, `agent-tools`, `list-client-debts`, `notify-orphan-email`

> ⚠️ Apenas 2 funções com `verify_jwt: true` (`process-reembolso`, `process-payouts`); as demais são abertas (esperado para webhooks, mas vale auditar `agent-tools` e `list-client-debts`).

## 🔐 Insights de segurança (Supabase advisors)

- **24×** `function_search_path_mutable` — funções sem `search_path` fixo (risco de hijack; fácil de corrigir com `SET search_path = ...`).
- **13×** `rls_disabled_in_public` + **10×** `rls_enabled_no_policy` — tabelas expostas sem RLS efetiva (`adimplentes_base`, `cliente_cadencia`, `event_log`, `payment_gateway_configs`, `blacklist_global`, etc.). **A maioria é tabela do n8n** — não mexer, mas convém saber que estão sem proteção de linha.
- **3×** `security_definer_view` — views (`ganhos_mes_atual`, `estornos_mes_atual`, `cobranca_diaria_mes_atual`) que rodam com privilégios do dono.
- **1×** `vulnerable_postgres` — versão do Postgres com patch de segurança disponível (recomenda upgrade).
- **Auth**: OTP com expiração longa + proteção contra senhas vazadas desativada.

## 💡 Insights de negócio

- Razão **262 mil mensagens enviadas (`message_log`) × 27 mil recebidas (`message_inbound`)** ≈ ~9:1 — operação fortemente *outbound* (disparos de cobrança), o que faz sentido para a régua do n8n.
- O CHAT-CDT ainda é pequeno em volume frente ao n8n: nossas tabelas (`chat_*`) somam poucos MB contra ~2.6 GB do ecossistema de cobrança — a convivência aditiva está funcionando como projetado.
- 21 usuários de auth para uma operação multi-unidade — consistente com a tela `/admin/users`.

---

*Coletado via MCP `mcp__claude_ai_Supabase__*` (read-only): `list_tables`, `execute_sql`, `list_edge_functions`, `get_advisors`.*
