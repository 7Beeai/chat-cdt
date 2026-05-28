import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET /api/cron/templates/sync
 *
 * NO-OP stub for v1.
 *
 * Per `docs/03-database.md`, WhatsApp templates live in the n8n-managed table
 * `template_inventory` (waba_id text, status, components, is_active_in_cadence).
 * CHAT-CDT consumes that table read-only — there is nothing to sync from the
 * Graph API on our side for v1.
 *
 * If/when we move to owning template sync ourselves, the real implementation
 * would look like:
 *
 * ```ts
 * // const supabase = createServiceClient()
 * // const { data: wabas } = await supabase.from('wabas').select('id, waba_id')
 * // for (const w of wabas ?? []) {
 * //   const res = await graphListTemplates(w.waba_id)
 * //   // upsert into template_inventory (or a chat_-prefixed mirror table)
 * // }
 * ```
 */
export async function GET(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({
    ok: true,
    note: 'templates are served from n8n template_inventory (read-only); sync is a no-op in v1',
  })
}
