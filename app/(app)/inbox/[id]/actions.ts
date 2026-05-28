'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

type ActionResult = { error?: string }

/**
 * Operator claims a queued conversation:
 *   routing -> 'human', assigned_operator_id -> auth.uid().
 * RLS gates whether the caller may touch this conversation.
 */
export async function assignToMe(conversationId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { error } = await supabase
    .from('conversations')
    .update({
      routing: 'human',
      assigned_operator_id: user.id,
    })
    .eq('id', conversationId)

  if (error) {
    console.error('[assignToMe] update failed', error)
    return { error: error.message }
  }

  revalidatePath(`/inbox/${conversationId}`)
  revalidatePath('/inbox')
  return {}
}

/**
 * Operator hands the conversation back to the AI:
 *   routing -> 'ai', assigned_operator_id -> null.
 * n8n's per-send gate (docs/04) will see this and resume responding.
 */
export async function returnToAI(conversationId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { error } = await supabase
    .from('conversations')
    .update({
      routing: 'ai',
      assigned_operator_id: null,
    })
    .eq('id', conversationId)

  if (error) {
    console.error('[returnToAI] update failed', error)
    return { error: error.message }
  }

  revalidatePath(`/inbox/${conversationId}`)
  revalidatePath('/inbox')
  return {}
}

/**
 * Closes the conversation. Redirects back to the inbox list on success.
 * Note: redirect() throws — the function never returns a value on the
 * happy path. Errors still flow through the return type.
 */
export async function closeConversation(
  conversationId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { error } = await supabase
    .from('conversations')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  if (error) {
    console.error('[closeConversation] update failed', error)
    return { error: error.message }
  }

  revalidatePath('/inbox')
  redirect('/inbox')
}
