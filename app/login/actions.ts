'use server'

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

function safeNext(next: FormDataEntryValue | null): string {
  if (typeof next !== 'string') return '/inbox'
  // Only allow internal absolute paths to prevent open-redirects.
  if (!next.startsWith('/') || next.startsWith('//')) return '/inbox'
  return next
}

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))

  if (!email || !password) {
    redirect(
      `/login?error=${encodeURIComponent('Informe email e senha.')}&next=${encodeURIComponent(next)}`,
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect(
      `/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`,
    )
  }

  redirect(next)
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
