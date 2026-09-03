import { redirect } from 'next/navigation'
import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Admin gate. The role lives in public.user_roles (role = 'admin') and is
 * checked via the chat_is_admin() SECURITY DEFINER RPC — NOT by email, so
 * granting a new admin is a single user_roles row, no code change.
 *
 * Use getIsAdmin() to branch UI (e.g. show/hide a nav link); use requireAdmin()
 * at the top of every admin page AND every admin server action — hiding the
 * link is UX, the gate is security. Note the service-role client bypasses RLS
 * entirely, so server actions that touch it MUST call requireAdmin() first.
 */
export const getIsAdmin = cache(async function getIsAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('chat_is_admin')
  if (error) {
    console.error('[admin] chat_is_admin failed', error)
    return false
  }
  return data === true
})

/**
 * Throws (via redirect) unless the current session is an authenticated admin.
 * Returns the user-scoped client + user so the caller can reuse them.
 */
export async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!(await getIsAdmin(supabase))) redirect('/inbox')

  return { supabase, user }
}
