import { createClient } from '@supabase/supabase-js'

// Service-role client. Bypasses RLS. Use only in server-side code that has
// already validated tenant ownership (webhook, cron, internal endpoints).
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
