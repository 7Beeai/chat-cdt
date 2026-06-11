import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Garante que a conexão Realtime carrega o JWT do usuário ANTES do subscribe.
 *
 * Sem isso, um channel criado num useEffect de primeira montagem corre contra
 * o carregamento da sessão e assina com a anon key — os claims da subscription
 * são congelados no momento do subscribe (visível em realtime.subscription:
 * role=anon, sub=null), a RLS `chat_user_has_unit` avalia como anon e o WALRUS
 * nunca entrega evento nenhum. Foi exatamente o que quebrou a inbox ao vivo
 * (docs/13, item A).
 *
 * Refreshes posteriores são repassados pelo próprio supabase-js (TOKEN_REFRESHED
 * → realtime.setAuth); só a primeira corrida precisa ser fechada aqui.
 */
export async function ensureRealtimeAuth(
  supabase: SupabaseClient,
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.access_token) {
    await supabase.realtime.setAuth(session.access_token)
  }
}
