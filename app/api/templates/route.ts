import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Server-side proxy for `template_inventory`.
 *
 * Why an endpoint instead of querying directly from the browser:
 * `template_inventory` is owned by n8n and has an existing RLS policy
 * (`user_can_read_unit_code`) that depends on entries in `user_unit_permissions`.
 * CHAT-CDT operators may not be in that table (we use `user_units` for our
 * access model — see docs/03-database.md). Going through this endpoint with
 * the service-role client keeps us decoupled from the n8n permission scheme
 * without altering any policy on n8n's table.
 *
 * Access control here: only authenticated CHAT-CDT users with access to the
 * waba's unit can read the templates for that waba.
 */

const querySchema = z.object({
  waba_id: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ waba_id: url.searchParams.get('waba_id') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 })
  }
  const wabaIdText = parsed.data.waba_id

  // Cookie client passes RLS — confirms user has access to this waba.
  const { data: waba, error: wErr } = await supabase
    .from('wabas')
    .select('id, unit_id')
    .eq('waba_id', wabaIdText)
    .maybeSingle()
  if (wErr) {
    console.error('[api/templates] waba lookup error', wErr)
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!waba) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Service-role fetch from n8n's table — bypasses their RLS but only after
  // we confirmed the operator has access to the waba via our own policy.
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('template_inventory')
    .select('template_name, language, category, status, body_text, components, is_active_in_cadence')
    .eq('waba_id', wabaIdText)
    .eq('status', 'APPROVED')
    .order('template_name', { ascending: true })

  if (error) {
    console.error('[api/templates] template_inventory query error', error)
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  return NextResponse.json({ templates: data ?? [] })
}
