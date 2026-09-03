import { cache } from 'react'

import type { createClient } from '@/lib/supabase/server'

export type UnitVitalsRow = {
  unit_id: string
  waiting: number
  breached: number
  active: number
}

/**
 * chat_inbox_vitals() — contagens reais por unidade (RLS-scoped). Usada pelo
 * badge do sidebar (app layout) E pela inbox (inbox layout) no mesmo request:
 * cacheada por request pra não pagar a RPC duas vezes.
 */
export const getInboxVitals = cache(
  async (
    supabase: Awaited<ReturnType<typeof createClient>>,
  ): Promise<UnitVitalsRow[]> => {
    const { data, error } = await supabase.rpc('chat_inbox_vitals')
    if (error) console.error('[inbox] vitals fetch failed', error)
    return (data ?? []) as UnitVitalsRow[]
  },
)
