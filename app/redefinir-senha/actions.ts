'use server'

import {
  MSG_LINK_INVALIDO,
  MSG_SESSAO_RECUPERACAO_EXPIRADA,
  validarSenhaNova,
} from '@/lib/auth/password-recovery'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Grava a senha nova de quem chegou pelo link do email.
 *
 * A autorização é o token_hash do email: o verifyOtp só é chamado AQUI, no
 * submit — nunca no GET da página. É o que torna o fluxo imune ao scanner de
 * link do provedor de email (o GET dele não consome o token de uso único), e
 * é também por isso que a senha é validada ANTES do verifyOtp: senha fraca
 * não pode queimar o token.
 *
 * O fallback pra sessão cobre o resubmit: se o verifyOtp da primeira
 * tentativa passou mas o updateUser falhou, o token já era — mas a sessão
 * criada por ele ainda vale e a segunda tentativa entra por ela.
 */
export async function redefinirSenha(
  novaSenha: string,
  tokenHash?: string,
): Promise<{ ok: true; destino: string } | { ok: false; erro: string }> {
  const problema = validarSenhaNova(novaSenha)
  if (problema) return { ok: false, erro: problema }

  const supabase = await createClient()

  if (tokenHash) {
    const { error: erroToken } = await supabase.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash,
    })
    if (erroToken) {
      // Token recusado mas há sessão de recuperação? É o resubmit — segue.
      const {
        data: { user: usuarioExistente },
      } = await supabase.auth.getUser()
      if (!usuarioExistente) return { ok: false, erro: MSG_LINK_INVALIDO }
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, erro: MSG_SESSAO_RECUPERACAO_EXPIRADA }

  const { error } = await supabase.auth.updateUser({ password: novaSenha })
  // 'same_password' = uma submissão anterior já gravou esta senha (POST
  // duplicado). O estado final está certo: seguir como sucesso — mesma lição
  // do /reset-password (caso Vagner, 2026-08-13).
  const alreadyApplied =
    error &&
    (error.code === 'same_password' ||
      /different from the old password/i.test(error.message))
  if (error && !alreadyApplied) {
    return { ok: false, erro: error.message }
  }

  // Quem chegou aqui provou ser dono do email — que é exatamente o que a
  // senha temporária do 1º login cobrava. Limpa a flag com o SERVICE client
  // (a sessão pode ter sido rotacionada pela troca) para o layout não mandar
  // a pessoa pro /reset-password logo depois de já ter definido a senha.
  const svc = createServiceClient()
  const { error: clearErr } = await svc
    .from('profiles')
    .update({ must_reset_password: false })
    .eq('user_id', user.id)
  if (clearErr) {
    console.error('[redefinir-senha] falha ao limpar must_reset_password', clearErr)
    return {
      ok: false,
      erro: 'Senha alterada, mas houve um erro ao finalizar. Tente entrar normalmente com a senha nova.',
    }
  }

  // O destino real de quem é "somente vendas" é resolvido pelos layouts.
  return { ok: true, destino: '/inbox' }
}
