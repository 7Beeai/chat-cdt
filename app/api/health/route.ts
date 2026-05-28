// Health endpoint para deploy script e load balancer.
// Não consulta banco, não toca cookie, não autentica — só prova que o
// processo Node respondendo HTTP. Devolve 200 + uptime em ms.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const startedAt = Date.now()

export async function GET() {
  return NextResponse.json(
    { ok: true, uptime_ms: Date.now() - startedAt },
    { status: 200 }
  )
}
