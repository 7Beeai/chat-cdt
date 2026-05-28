# Scripts de seed / setup

Esta pasta tem 3 arquivos, com propósitos diferentes:

| Arquivo | O que faz | Pode ser removido? |
|---|---|---|
| `operator_setup.sql` | Cria `profiles` + `user_units` para `ian@7bee.ai` em todas as units | Sim, mas é grant **real** de acesso. Remoção opcional comentada em `dev_cleanup.sql`. |
| `dev_seed.sql` | Cria 1 WABA fake + phone + contact + conversation + 3 mensagens em Ibirité | **Totalmente removível** via `dev_cleanup.sql` |
| `dev_cleanup.sql` | Apaga tudo do `dev_seed.sql` | — |

## Convenção de identificação

Todo dado de seed dev usa **um destes dois marcadores**:
- `__SEED__` como prefixo em colunas de texto (`waba_id`, `phone_number_id`, `wa_id`, `wa_message_id`)
- `{"seed": true}` em colunas jsonb (`contacts.profile`, `messages.payload`)

Isso garante que `dev_cleanup.sql` consegue identificar e apagar tudo sem tocar em uma única linha real.

## Como rodar

Via Supabase Studio SQL Editor, ou via MCP `apply_migration` (mas como NÃO é migration estrutural, prefira **`execute_sql`** para não inflar o histórico de migrations).

Ordem:
1. `operator_setup.sql` — uma vez (ou quando criar novos operadores).
2. `dev_seed.sql` — quando quiser ver a UI com dados.
3. `dev_cleanup.sql` — antes de ir para produção real, ou sempre que quiser resetar o seed.

## Adicionando mais seed depois

Mantenha a convenção `__SEED__` + `seed: true`. Atualize o cleanup se criar novos tipos de rows.
