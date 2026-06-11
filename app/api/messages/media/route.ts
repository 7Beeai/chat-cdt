import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { graphSendMessage, graphUploadMedia } from '@/lib/meta/graph'
import { handleGraphOutOfWindow, isGraphOutOfWindow } from '@/lib/meta/window'
import { buildStoragePath, MEDIA_BUCKET } from '@/lib/storage/media'

export const runtime = 'nodejs'

/**
 * Envio de anexo pelo operador. Fluxo:
 *   1. multipart (file + conversationId + caption?) → valida tipo/tamanho
 *   2. upload pra Cloud API (/{phone}/media) → media id
 *   3. envia a mensagem por media id
 *   4. guarda cópia no bucket chat-media (mesmo path scheme do inbound) pra
 *      thread renderizar com signed URL
 *   5. insere a linha em `messages` (payload espelha o shape do webhook:
 *      payload[type] = { id, url, mime_type, caption?, filename?, storage_path })
 *
 * O envio é por ID (não por link): signed URL nossa expira e a Meta baixaria
 * num momento imprevisível.
 */

type MediaKind = 'image' | 'video' | 'audio' | 'document'

// Limites da Cloud API (image 5MB, video/audio 16MB, document 100MB — aqui
// 25MB de teto operacional pra não segurar o worker com upload gigante).
const LIMITS: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 25 * 1024 * 1024,
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_MIMES = new Set(['video/mp4', 'video/3gpp'])
const AUDIO_MIMES = new Set([
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/amr',
  'audio/ogg',
])
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
])

function kindOf(mime: string): MediaKind | null {
  if (IMAGE_MIMES.has(mime)) return 'image'
  if (VIDEO_MIMES.has(mime)) return 'video'
  if (AUDIO_MIMES.has(mime)) return 'audio'
  if (DOCUMENT_MIMES.has(mime)) return 'document'
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'bad_form' }, { status: 400 })
  }

  const file = form.get('file')
  const conversationId = form.get('conversationId')
  const captionRaw = form.get('caption')

  if (!(file instanceof File) || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const caption =
    typeof captionRaw === 'string' && captionRaw.trim().length > 0
      ? captionRaw.trim().slice(0, 1024)
      : undefined

  const mime = file.type
  const kind = kindOf(mime)
  if (!kind) {
    return NextResponse.json(
      { error: 'unsupported_type', mime },
      { status: 415 }
    )
  }
  if (file.size > LIMITS[kind]) {
    return NextResponse.json(
      { error: 'too_large', limit: LIMITS[kind] },
      { status: 413 }
    )
  }

  // Conversation lookup (passes RLS — user must own it).
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select(
      `
        id, status, routing, customer_window_expires_at,
        phone:chat_phone_numbers(phone_number_id),
        contact:contacts(wa_id)
      `
    )
    .eq('id', conversationId)
    .maybeSingle()

  if (convErr) {
    console.error('[messages/media] conversation lookup error', convErr)
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const phone = (conv as any).phone as { phone_number_id: string } | null
  const contact = (conv as any).contact as { wa_id: string } | null
  if (!phone?.phone_number_id || !contact?.wa_id) {
    console.error('[messages/media] missing phone or contact on conversation', conv.id)
    return NextResponse.json({ error: 'conversation_incomplete' }, { status: 500 })
  }

  // Mídia é mensagem free-form: só dentro da janela de 24h.
  const exp = conv.customer_window_expires_at
    ? new Date(conv.customer_window_expires_at).getTime()
    : 0
  if (!exp || exp < Date.now()) {
    return NextResponse.json({ error: 'out_of_window' }, { status: 409 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // 1) upload pra Meta → media id
  const up = await graphUploadMedia(phone.phone_number_id, {
    bytes,
    mimeType: mime,
    filename: file.name || `arquivo.${mime.split('/').pop()}`,
  })
  if (!up.ok || !up.mediaId) {
    console.error('[messages/media] graph upload error', up.status, up.body)
    return NextResponse.json(
      { error: 'graph_upload', status: up.status, details: up.body },
      { status: 502 }
    )
  }

  // 2) envia por media id
  const mediaObj: Record<string, unknown> = { id: up.mediaId }
  if (caption && kind !== 'audio') mediaObj.caption = caption
  if (kind === 'document' && file.name) mediaObj.filename = file.name

  const graphBody = {
    messaging_product: 'whatsapp',
    to: contact.wa_id,
    type: kind,
    [kind]: mediaObj,
  }
  const result = await graphSendMessage(phone.phone_number_id, graphBody)
  if (!result.ok) {
    console.error('[messages/media] graph send error', result.status, result.body)
    // Estado divergente: nossa janela diz aberta, a Meta recusou (131047/
    // 131026). Zera a janela e devolve o 409 padrão de out-of-window.
    if (isGraphOutOfWindow(result.body)) {
      return handleGraphOutOfWindow(conv.id, result.body)
    }
    return NextResponse.json(
      { error: 'graph', status: result.status, details: result.body },
      { status: 502 }
    )
  }
  const waMessageId = result.waMessageId ?? `media-${up.mediaId}`

  // 3) cópia no bucket (best-effort: a mensagem JÁ foi pro cliente; sem a
  // cópia a bolha mostra "não disponível" mas a linha precisa existir).
  const service = createServiceClient()
  let storagePath: string | null = buildStoragePath(conv.id, waMessageId, mime)
  const { error: upErr } = await service.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: true })
  if (upErr) {
    console.error('[messages/media] storage upload failed', upErr)
    storagePath = null
  }

  // 4) persiste a linha (mesmo shape de mídia do webhook inbound, pra
  // extractMediaInfo/MediaBubble renderarem sem caso especial).
  const row = {
    conversation_id: conv.id,
    wa_message_id: waMessageId,
    direction: 'out' as const,
    type: kind,
    payload: {
      [kind]: {
        id: up.mediaId,
        url: `https://graph.facebook.com/${up.mediaId}`,
        mime_type: mime,
        ...(caption && kind !== 'audio' ? { caption } : {}),
        ...(file.name ? { filename: file.name } : {}),
        ...(storagePath ? { storage_path: storagePath } : {}),
      },
    },
    sent_by: 'operator' as const,
    operator_id: user.id,
    status: 'sent' as const,
  }

  const { error: insErr } = await supabase.from('messages').insert(row)
  if (insErr) {
    console.warn('[messages/media] cookie-client insert failed, retrying with service role', insErr)
    const { error: svcErr } = await service.from('messages').insert(row)
    if (svcErr) {
      console.error('[messages/media] service-role insert also failed', svcErr)
      return NextResponse.json(
        { error: 'persist_failed', wa_message_id: waMessageId },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    wa_message_id: waMessageId,
    type: kind,
    storage_path: storagePath,
  })
}
