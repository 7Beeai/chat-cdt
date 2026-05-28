// Subset of Cloud API webhook payloads we actually use.

export type WebhookEnvelope = {
  object: 'whatsapp_business_account'
  entry: WebhookEntry[]
}

export type WebhookEntry = {
  id: string // waba_id
  changes: WebhookChange[]
}

export type WebhookChange = {
  field: string
  value: WebhookValue
}

export type WebhookValue = {
  messaging_product?: 'whatsapp'
  metadata?: {
    display_phone_number?: string
    phone_number_id: string
  }
  contacts?: Array<{
    wa_id: string
    profile?: { name?: string }
  }>
  messages?: WebhookMessage[]
  statuses?: WebhookStatus[]
}

export type WebhookMessage = {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; sha256: string; caption?: string }
  audio?: { id: string; mime_type: string; voice?: boolean }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  interactive?: any
  button?: any
  context?: { from: string; id: string }
  [k: string]: any
}

export type WebhookStatus = {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string
  errors?: any
  conversation?: any
  pricing?: any
}
