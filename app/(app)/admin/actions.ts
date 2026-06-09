'use server'

import { randomBytes } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { requireAdmin } from '@/lib/auth/admin'
import { createServiceClient } from '@/lib/supabase/service'

import type { ActionResult } from './types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function genPassword(): string {
  // 18 url-safe chars — strong enough as a one-time temp password.
  return randomBytes(14).toString('base64url')
}

/**
 * Resolve profiles.id for a freshly created/invited auth user. The
 * on_auth_user_created trigger creates the profile synchronously, so it exists
 * by the time the admin API call returns. We still guard with a retry in case
 * of replica lag, and never assume it's there.
 */
async function resolveProfileId(authId: string): Promise<string | null> {
  const svc = createServiceClient()
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await svc
      .from('profiles')
      .select('id')
      .eq('user_id', authId)
      .maybeSingle()
    if (data?.id) return data.id as string
  }
  return null
}

async function applyUnits(
  supabase: Awaited<ReturnType<typeof requireAdmin>>['supabase'],
  profileId: string,
  unitIds: string[],
): Promise<string | null> {
  // Replace the full set: clear then insert. RLS (admin-only) double-enforces.
  const { error: delErr } = await supabase
    .from('user_units')
    .delete()
    .eq('user_id', profileId)
  if (delErr) return delErr.message

  if (unitIds.length === 0) return null

  const { error: insErr } = await supabase
    .from('user_units')
    .insert(unitIds.map((unit_id) => ({ user_id: profileId, unit_id })))
  return insErr ? insErr.message : null
}

/** Create a user directly with a password (works without SMTP configured). */
export async function createUserAction(formData: FormData): Promise<ActionResult> {
  const { supabase } = await requireAdmin()

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const name = String(formData.get('name') ?? '').trim()
  const rawPassword = String(formData.get('password') ?? '')
  const unitIds = formData.getAll('unitIds').map(String).filter(Boolean)

  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: 'E-mail inválido.' }
  }

  const password = rawPassword.length >= 8 ? rawPassword : genPassword()
  const svc = createServiceClient()

  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { name } : undefined,
  })

  if (error || !created?.user) {
    return { ok: false, message: error?.message ?? 'Falha ao criar usuário.' }
  }

  const profileId = await resolveProfileId(created.user.id)
  if (!profileId) {
    return {
      ok: false,
      message:
        'Usuário criado, mas o perfil ainda não apareceu. Recarregue e vincule as unidades manualmente.',
    }
  }

  // Senha criada pelo admin é temporária → força a troca no 1º login.
  await supabase
    .from('profiles')
    .update({ ...(name ? { name } : {}), must_reset_password: true })
    .eq('id', profileId)
  const unitErr = await applyUnits(supabase, profileId, unitIds)

  revalidatePath('/admin/users')

  if (unitErr) {
    return {
      ok: false,
      message: `Usuário criado, mas falhou ao vincular unidades: ${unitErr}`,
    }
  }

  return {
    ok: true,
    message: `Usuário ${email} criado.`,
    tempPassword: rawPassword.length >= 8 ? undefined : password,
  }
}

/** Send an email invite (magic link to set a password). Requires SMTP. */
export async function inviteUserAction(formData: FormData): Promise<ActionResult> {
  const { supabase } = await requireAdmin()

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const name = String(formData.get('name') ?? '').trim()
  const unitIds = formData.getAll('unitIds').map(String).filter(Boolean)

  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: 'E-mail inválido.' }
  }

  const origin = process.env.APP_ORIGIN ?? undefined
  const svc = createServiceClient()

  const { data: invited, error } = await svc.auth.admin.inviteUserByEmail(email, {
    data: name ? { name } : undefined,
    redirectTo: origin ? `${origin}/login` : undefined,
  })

  if (error || !invited?.user) {
    return {
      ok: false,
      message:
        error?.message ??
        'Falha ao enviar convite. Verifique se o SMTP está configurado no Supabase.',
    }
  }

  // The invite already created the auth user (→ trigger → profile), so we can
  // assign units immediately.
  const profileId = await resolveProfileId(invited.user.id)
  if (profileId) {
    if (name) await supabase.from('profiles').update({ name }).eq('id', profileId)
    const unitErr = await applyUnits(supabase, profileId, unitIds)
    if (unitErr) {
      revalidatePath('/admin/users')
      return {
        ok: false,
        message: `Convite enviado, mas falhou ao vincular unidades: ${unitErr}`,
      }
    }
  }

  revalidatePath('/admin/users')
  return { ok: true, message: `Convite enviado para ${email}.` }
}

/**
 * Is there at least one OTHER active (non-banned) admin besides `excludeAuthId`?
 * Guards against locking the system out by disabling/deleting the last admin.
 */
async function otherActiveAdminExists(excludeAuthId: string): Promise<boolean> {
  const svc = createServiceClient()
  const { data: admins } = await svc
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
  const ids = (admins ?? [])
    .map((r) => r.user_id as string)
    .filter((id) => id !== excludeAuthId)
  if (ids.length === 0) return false

  // An admin only counts if their auth account isn't currently banned.
  for (const id of ids) {
    const { data } = await svc.auth.admin.getUserById(id)
    const bannedUntil = data?.user?.banned_until
    const active = !bannedUntil || new Date(bannedUntil).getTime() <= Date.now()
    if (active) return true
  }
  return false
}

/**
 * Activate / deactivate a user. Deactivation = an auth ban (GoTrue rejects
 * banned users at login — the REAL lever; profiles.is_active is cosmetic).
 * Reversible. Mirrors the state onto profiles.is_active for record-keeping.
 */
export async function setUserActiveAction(
  authId: string,
  profileId: string | null,
  active: boolean,
): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin()

  if (!active) {
    if (authId === user.id) {
      return { ok: false, message: 'Você não pode desativar a si mesmo.' }
    }
    if (!(await otherActiveAdminExists(authId))) {
      // Only blocks when the target is the last active admin.
      const svc = createServiceClient()
      const { data: roles } = await svc
        .from('user_roles')
        .select('role')
        .eq('user_id', authId)
        .eq('role', 'admin')
      if ((roles?.length ?? 0) > 0) {
        return {
          ok: false,
          message: 'Não é possível desativar o último admin ativo.',
        }
      }
    }
  }

  const svc = createServiceClient()
  const { data: updated, error } = await svc.auth.admin.updateUserById(authId, {
    // 'none' clears the ban; a long duration is effectively permanent.
    ban_duration: active ? 'none' : '87600h',
  })

  if (error) {
    return { ok: false, message: error.message }
  }

  // Verify the ban actually took (don't ship a cosmetic toggle).
  const banned = updated?.user?.banned_until
  const isBanned = Boolean(banned) && new Date(banned!).getTime() > Date.now()
  if (!active && !isBanned) {
    return { ok: false, message: 'Falha ao aplicar o banimento no auth.' }
  }

  if (profileId) {
    await supabase.from('profiles').update({ is_active: active }).eq('id', profileId)
  }

  revalidatePath('/admin/users')
  return {
    ok: true,
    message: active ? 'Usuário reativado.' : 'Usuário desativado.',
  }
}

/**
 * Permanently delete a user. CASCADE clears profiles/user_roles/user_units/
 * push subs. BUT auth.users has NO ACTION FKs (conversations, messages,
 * cobrança, pagamentos) that BLOCK deletion once the user has history — we
 * catch that and steer the admin to deactivate instead.
 */
export async function deleteUserAction(
  authId: string,
): Promise<ActionResult> {
  const { user } = await requireAdmin()

  if (authId === user.id) {
    return { ok: false, message: 'Você não pode excluir a si mesmo.' }
  }
  if (!(await otherActiveAdminExists(authId))) {
    const svc0 = createServiceClient()
    const { data: roles } = await svc0
      .from('user_roles')
      .select('role')
      .eq('user_id', authId)
      .eq('role', 'admin')
    if ((roles?.length ?? 0) > 0) {
      return { ok: false, message: 'Não é possível excluir o último admin ativo.' }
    }
  }

  const svc = createServiceClient()
  const { error } = await svc.auth.admin.deleteUser(authId)

  if (error) {
    const msg = error.message ?? ''
    // FK violation = user has history in conversations/messages/cobrança.
    if (/foreign key|violates|constraint/i.test(msg)) {
      return {
        ok: false,
        message:
          'Este usuário tem histórico (mensagens/conversas) e não pode ser excluído. Use “Desativar”.',
      }
    }
    return { ok: false, message: msg || 'Falha ao excluir usuário.' }
  }

  revalidatePath('/admin/users')
  return { ok: true, message: 'Usuário excluído.' }
}

/** Replace the set of units a user can see. */
export async function setUserUnitsAction(
  profileId: string,
  unitIds: string[],
): Promise<ActionResult> {
  const { supabase } = await requireAdmin()

  if (!profileId) return { ok: false, message: 'Perfil inválido.' }

  const unitErr = await applyUnits(supabase, profileId, unitIds)
  revalidatePath('/admin/users')

  if (unitErr) return { ok: false, message: `Falha ao salvar: ${unitErr}` }
  return { ok: true, message: 'Unidades atualizadas.' }
}
