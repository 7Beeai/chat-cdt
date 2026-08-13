import { createClient } from '@/lib/supabase/server'

/**
 * Gate "somente vendas". O role vive em public.user_roles (role =
 * 'sales_agent', user_id = auth.users.id) e é checado via a RPC SECURITY
 * DEFINER chat_is_sales_only() — que já embute "e NÃO é admin", então um
 * admin que ganhar o role por engano nunca se tranca fora (migration 0027).
 *
 * Uso: layouts de área proibida (Inbox, Relatórios) redirecionam para
 * /vendas; a sidebar esconde os links. Isto é trava de INTERFACE — o RLS
 * continua por unidade, então o dado de cobrança da própria unidade segue
 * legível via API com o JWT do usuário. Erro na RPC degrada para acesso
 * completo (fail-open) de propósito: uma RPC quebrada não pode trancar a
 * operação inteira de cobrança.
 */
export async function getIsSalesOnly(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('chat_is_sales_only')
  if (error) {
    console.error('[sales] chat_is_sales_only failed', error)
    return false
  }
  return data === true
}
