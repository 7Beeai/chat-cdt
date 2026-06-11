import { NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/service'

// Códigos Graph que significam "fora da janela de 24h" mesmo quando a nossa
// customer_window_expires_at diz o contrário (estado divergente — ex.: conversa
// reaberta por SQL). 131047 = re-engagement required; 131026 = undeliverable.
const GRAPH_OUT_OF_WINDOW_CODES = new Set([131047, 131026])

export function isGraphOutOfWindow(body: unknown): boolean {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code
  return typeof code === 'number' && GRAPH_OUT_OF_WINDOW_CODES.has(code)
}

/**
 * A Meta recusou por janela fechada: realinha o estado local zerando a
 * janela da conversa (service role — não depende da RLS do operador) e
 * devolve o MESMO 409 do gate local, pra UX única no client (toast + abre
 * o picker de retomada; o router.refresh() do client trava o composer).
 */
export async function handleGraphOutOfWindow(
  conversationId: string,
  graphBody: unknown,
): Promise<NextResponse> {
  const { error } = await createServiceClient()
    .from('conversations')
    .update({ customer_window_expires_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (error) {
    console.error(
      '[messages] failed to zero customer window',
      conversationId,
      error,
    )
  }
  return NextResponse.json(
    { error: 'out_of_window', source: 'graph', details: graphBody },
    { status: 409 },
  )
}
