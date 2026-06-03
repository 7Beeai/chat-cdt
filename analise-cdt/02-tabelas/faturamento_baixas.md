# faturamento_baixas

## Identificação
- **Nome**: `public.faturamento_baixas`
- **Dono provável**: Cobrança (ecossistema n8n/pagamentos) — feature de **conciliação de faturamento**. Ausente das migrations CHAT-CDT e do código local (grep vazio); o consumidor app vive no outro repositório.
- **Linhas estimadas**: indeterminado (`linhas_estimadas=-1` = nunca analisada). Movimento real na janela: `n_tup_ins=3`, `n_tup_del=2`, `n_live_tup=1`, `n_dead_tup=2` → tabela **viva e em uso** (baixas sendo criadas e revertidas), apenas com pouquíssimas linhas.
- **Tamanho**: 80 kB total / 8 kB heap. Sem bloat.
- **Classificação**: **Cobrança** (controle de faturamento/baixas manuais).
- **Bloat**: n/a.

## Finalidade
Registra **"baixas" de faturamento** — marcações manuais de que um item de cobrança de um cliente, em um mês de referência, foi quitado/baixado (por exemplo, pagamento fora do gateway, acordo, isenção). Cada linha amarra `cliente_key + mes_ref + tipo` (chave única) a um valor em centavos e ao **operador que deu a baixa** (`baixado_por`/`baixado_email`/`baixado_em`). É um livro-razão de exceções de faturamento, distinto dos pagamentos automáticos do gateway.

## Colunas

| # | coluna | tipo | nulo | default | origem | consumidores | confiança |
|---|--------|------|------|---------|--------|--------------|-----------|
| 1 | id | uuid | NO | `gen_random_uuid()` | default | PK (`faturamento_baixas_pkey`, idx_scan=0 — lookups vão pela unique de negócio) | inferido |
| 2 | cliente_key | text | NO | — | app (tela de baixas, outro repo) | índice unique `(cliente_key, mes_ref, tipo)` (upsert/dedup) | inferido (escrita app-side; chave da unique) |
| 3 | cliente_nome | text | NO | — | app | exibição/relatório | inferido |
| 4 | negocio | text | NO | — | app (segmento/unidade de negócio) | índice `idx_faturamento_baixas_negocio_mes` (filtro por negócio+mês) | inferido |
| 5 | mes_ref | text | NO | — | app (mês de referência, ex.: 'YYYY-MM') | índices `idx_..._mes_ref` (**idx_scan=30**, hot) e `_negocio_mes`; unique | inferido (chave de filtro mais lida) |
| 6 | tipo | text | NO | — | app (tipo da baixa) | índice unique `(cliente_key, mes_ref, tipo)` | inferido |
| 7 | valor_centavos | bigint | NO | — | app (valor baixado em centavos) | agregação de relatório (outro repo) | inferido |
| 8 | baixado_por | text | NO | — | app (nome/identificação do operador) | auditoria/exibição | inferido |
| 9 | baixado_email | text | NO | — | app (e-mail do operador que baixou) | auditoria | inferido |
| 10 | baixado_em | timestamptz | NO | `now()` | default | ordenação/auditoria | inferido |

**Colunas com espaço no nome**: nenhuma.

## Relacionamentos (FKs)
Nenhuma FK (nem como origem nem como destino — bloco-03 sem entrada). `cliente_key` é texto livre sem FK para a base de clientes (acoplamento fraco por string).

## Índices
(bloco-04)

| índice | def | unique | idx_scan | bytes | papel |
|--------|-----|--------|----------|-------|-------|
| `faturamento_baixas_pkey` | (id) | sim/PK | 0 | 16 kB | estrutural; lookups de negócio não usam `id` |
| `faturamento_baixas_cliente_key_mes_ref_tipo_key` | (cliente_key, mes_ref, tipo) | sim | 3 | 16 kB | **chave de negócio / dedup** (upsert de baixa); usado |
| `idx_faturamento_baixas_mes_ref` | (mes_ref) | não | **30** | 16 kB | **hot path** — listagem de baixas por mês (idx_tup_read=77) |
| `idx_faturamento_baixas_negocio_mes` | (negocio, mes_ref) | não | 0 | 16 kB | filtro por negócio+mês; ocioso na janela |

### Índices nunca usados (idx_scan=0)
- `faturamento_baixas_pkey` — PK estrutural (não conta como desperdício; necessária à integridade).
- `idx_faturamento_baixas_negocio_mes` — `idx_scan=0` na janela de 13h; serve filtro por negócio+mês que pode não ter sido exercido. Cobertura parcial pelo `idx_mes_ref` (segunda coluna), mas o composto `(negocio, mes_ref)` tem ordem de prefixo diferente → não é estritamente redundante. **Candidato a observação, não a drop imediato.**
- **Desperdício reclamável com segurança: 0 kB** (nada comprovadamente redundante; `idx_negocio_mes` precisa de confirmação de uso fora da janela antes de remover).

## Triggers
Nenhuma (bloco-06).

## RLS / Policies
- `rls_on=true`, `rls_forced=false`, **`n_policies=0`** (bloco-01/09).
- **Interpretação correta**: RLS ligada + zero policies = **deny-all** para `authenticated`/`anon`. Apesar disso `idx_scan=33` total → a tabela **é lida**, logo o acesso ocorre via `service_role` (app/edge do outro repo com chave de serviço). Não é "exposta": é fechada para roles normais e acessada por backend privilegiado. (Mesma forma de `payment_gateway_configs`; a generalização de `docs/analise-banco.md` de que `rls_enabled_no_policy` = "exposta" é imprecisa aqui.)

## Quem escreve / Quem lê
- **Escreve**: aplicação no **outro repositório** (tela de baixas de faturamento) via `service_role` — evidência: `n_tup_ins=3`/`n_tup_del=2` na janela, colunas de auditoria de operador (`baixado_por/email/em`), unique de upsert. Nenhuma função/edge/n8n/view local captura o writer.
- **Lê**: aplicação/relatório no outro repo — evidência: `idx_faturamento_baixas_mes_ref` com **30 scans** e 77 tuplas lidas (listagem por mês). Nenhum consumidor nas fontes programáticas locais (functions/edge/n8n/views/stat).
- **Sem consumidor identificado nas fontes deste snapshot** para o detalhe coluna-a-coluna — mas a tabela está **comprovadamente em uso** (writes + 33 idx_scan). **Não classificar como morta.**

## Observações
- **Única tabela do lote com movimento real na janela** (`n_tup_ins=3`, `n_tup_del=2`): baixas sendo criadas e revertidas (delete em vez de soft-delete — não há flag de cancelamento, a reversão apaga a linha).
- **`cliente_key` sem FK** — acoplamento por string à base de clientes; risco de baixas órfãs se a chave do cliente mudar.
- **Todas as origens/consumidores são `inferido`**: o owner real (telas/serviços) está no repositório de cobrança, fora deste workspace; os arquivos de consumidores (edge/n8n/functions/views) não cobrem o app Next.js do faturamento. A inferência se apoia em: nomes de coluna autoexplicativos, índices de uso e estatísticas de DML.
- **Estatísticas cegas**: `last_analyze`/`last_vacuum`=null, `linhas_estimadas=-1` (mas `n_live_tup=1` indica ~1 linha viva). Recomendável `ANALYZE`.
