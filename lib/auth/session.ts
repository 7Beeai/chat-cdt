import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Usuário da sessão, resolvido UMA vez por request. O middleware já validou o
 * cookie; app layout, inbox layout e página repetiam auth.getUser() (3 round-
 * trips de ~140ms cada). Cacheado por request via React cache.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})
