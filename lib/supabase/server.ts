import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'

/**
 * Um client por request (React cache): layouts aninhados e a página do mesmo
 * render compartilham a instância, e os helpers cacheados (getSessionUser,
 * getIsAdmin, getIsSalesOnly, getInboxVitals) deduplicam as chamadas ao
 * Supabase — cada round-trip VPS→Supabase custa ~100-140ms de rede.
 */
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components cannot set cookies; middleware handles refresh.
          }
        },
      },
    }
  )
})
