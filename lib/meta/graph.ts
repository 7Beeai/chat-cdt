const VERSION = process.env.META_GRAPH_VERSION ?? 'v22.0'
const TOKEN = () => process.env.META_SYSTEM_USER_TOKEN!

export type GraphSendResult = {
  ok: boolean
  status: number
  body: any
  waMessageId?: string
}

export async function graphSendMessage(
  phoneNumberId: string,
  payload: Record<string, unknown>
): Promise<GraphSendResult> {
  const r = await fetch(
    `https://graph.facebook.com/${VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  )
  const body = await r.json().catch(() => ({}))
  return {
    ok: r.ok,
    status: r.status,
    body,
    waMessageId: body?.messages?.[0]?.id,
  }
}

export async function graphListTemplates(wabaId: string) {
  const r = await fetch(
    `https://graph.facebook.com/${VERSION}/${wabaId}/message_templates?limit=200&fields=name,language,category,status,components`,
    { headers: { Authorization: `Bearer ${TOKEN()}` } }
  )
  return r.json()
}

export async function graphSubscribeApp(wabaId: string) {
  const r = await fetch(
    `https://graph.facebook.com/${VERSION}/${wabaId}/subscribed_apps`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN()}` },
    }
  )
  return r.json()
}
