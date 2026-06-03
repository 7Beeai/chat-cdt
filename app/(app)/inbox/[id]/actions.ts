'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type { CloseOutcome } from '@/app/(app)/inbox/outcomes'

type ActionResult = { error?: string }

/**
 * Operator claims a QUEUED conversation. Atomic claim: only succeeds while
 * assigned_operator_id IS NULL, so two operators racing the same conversation
 * can't both win — the loser gets a friendly "já assumida". The transition
 * trigger stamps assigned_at and logs the 'assigned' event.
 */
export async function assignToMe(conversationId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { data, error } = await supabase
    .from('conversations')
    .update({ routing: 'human', assigned_operator_id: user.id })
    .eq('id', conversationId)
    .is('assigned_operator_id', null) // claim only if still unassigned
    .select('id')

  if (error) {
    console.error('[assignToMe] update failed', error)
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    // Someone claimed it first (or it's no longer unassigned).
    return { error: 'Já assumida por outro operador.' }
  }

  revalidatePath(`/inbox/${conversationId}`)
  revalidatePath('/inbox')
  return {}
}

/**
 * Take over a conversation already assigned to someone else (shift handover /
 * supervisor). Unconditional reassignment — the trigger logs a 'reassigned'
 * event with the actor, so the change is auditable.
 */
export async function takeOverConversation(
  conversationId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { error } = await supabase
    .from('conversations')
    .update({ routing: 'human', assigned_operator_id: user.id })
    .eq('id', conversationId)

  if (error) {
    console.error('[takeOverConversation] update failed', error)
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
  outcome: CloseOutcome,
  note?: string,
  paymentMethod?: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }
  if (!outcome) return { error: 'Informe o desfecho do atendimento.' }

  // Single UPDATE carries status + outcome + author; the AFTER trigger reads
  // NEW.* and writes the 'closed' event with the outcome baked in. The payment
  // method only sticks for resolved closes (the dialog only asks for it on a
  // payment_re_register + resolvido close); otherwise it's nulled.
  const { error } = await supabase
    .from('conversations')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user.id,
      close_outcome: outcome,
      close_note: note?.trim() || null,
      close_payment_method:
        outcome === 'resolvido' ? paymentMethod?.trim() || null : null,
    })
    .eq('id', conversationId)

  if (error) {
    console.error('[closeConversation] update failed', error)
    return { error: error.message }
  }

  revalidatePath('/inbox')
  redirect('/inbox')
}

/**
 * Bulk variants for the list's selection bar. Single UPDATE with `.in(...)`;
 * no redirect (the operator stays in the list). Realtime propagates the
 * status/assignment change back into the workspace.
 */
export async function bulkAssignToMe(ids: string[]): Promise<ActionResult> {
  if (ids.length === 0) return {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { error } = await supabase
    .from('conversations')
    .update({ routing: 'human', assigned_operator_id: user.id })
    .in('id', ids)

  if (error) {
    console.error('[bulkAssignToMe] update failed', error)
    return { error: error.message }
  }
  revalidatePath('/inbox')
  return {}
}

export async function bulkClose(
  ids: string[],
  outcome: CloseOutcome,
): Promise<ActionResult> {
  if (ids.length === 0) return {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }
  if (!outcome) return { error: 'Informe o desfecho do atendimento.' }

  const { error } = await supabase
    .from('conversations')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user.id,
      close_outcome: outcome,
    })
    .in('id', ids)

  if (error) {
    console.error('[bulkClose] update failed', error)
    return { error: error.message }
  }
  revalidatePath('/inbox')
  return {}
}
