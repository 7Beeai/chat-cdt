'use server'

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Define a nova senha do usuário logado e limpa a flag must_reset_password.
 * Usado no 1º login (senha inicial temporária) — e também serve como troca de
 * senha self-service para qualquer usuário logado.
 */
export async function setNewPassword(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (password.length < 8) {
    redirect(
      `/reset-password?error=${encodeURIComponent('A senha precisa ter pelo menos 8 caracteres.')}`,
    )
  }
  if (password !== confirm) {
    redirect(
      `/reset-password?error=${encodeURIComponent('As senhas não conferem.')}`,
    )
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message)}`)
  }

  // Limpa a flag com o SERVICE client (não depende da sessão, que pode ter sido
  // rotacionada pela troca de senha acima) e CHECA o erro. Se não limpar, o
  // usuário cairia em loop no layout — então só seguimos pro inbox se limpou.
  const svc = createServiceClient()
  const { error: clearErr } = await svc
    .from('profiles')
    .update({ must_reset_password: false })
    .eq('user_id', user.id)
  if (clearErr) {
    console.error('[reset-password] falha ao limpar must_reset_password', clearErr)
    redirect(
      `/reset-password?error=${encodeURIComponent('Senha alterada, mas houve um erro ao finalizar. Recarregue a página e tente entrar.')}`,
    )
  }

  redirect('/inbox')
}
