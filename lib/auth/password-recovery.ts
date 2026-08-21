/**
 * "Esqueci minha senha" — constantes e regras puras (sem imports server-only).
 *
 * Fluxo transplantado da gestão WAYTOP (repo waytop-gestao, commit e00de98),
 * que apanhou em produção até chegar neste desenho:
 *   1. /esqueci-senha    pede o email e dispara resetPasswordForEmail
 *   2. /redefinir-senha  recebe ?token_hash= do email e grava a senha nova
 *
 * O template de recovery do projeto Supabase monta o link como
 * `{{ .RedirectTo }}?token_hash={{ .TokenHash }}` — direto pra nossa tela,
 * NUNCA pro /auth/v1/verify. O token só é consumido no SUBMIT do formulário
 * (verifyOtp dentro da action): o scanner de link do provedor de email (Google
 * Workspace etc.) segue o GET e não queima o token de uso único — foi
 * exatamente isso que derrubou o primeiro teste real na WAYTOP. Sem PKCE
 * também não há vínculo com o navegador: pedir no celular e abrir no desktop
 * funciona.
 */

export const ROTA_ESQUECI_SENHA = '/esqueci-senha'
export const ROTA_REDEFINIR_SENHA = '/redefinir-senha'

/**
 * Resposta ÚNICA do pedido de recuperação — some se o email existe ou não.
 * Trocar por algo condicional transforma a tela num oráculo de "quem tem
 * conta no CHAT-CDT". A checagem de existência nunca chega ao browser.
 */
export const MSG_RECUPERACAO_ENVIADA =
  'Se este email tiver cadastro, enviamos um link para redefinir a senha. Confira também a caixa de spam.'

export const MSG_MUITAS_TENTATIVAS =
  'Muitos pedidos seguidos. Espere alguns minutos antes de tentar de novo.'

export const MSG_EMAIL_INVALIDO = 'Digite um email válido.'

/** Token do email inválido, já usado ou expirado — recusado pelo verifyOtp. */
export const MSG_LINK_INVALIDO =
  'O link expirou ou já foi usado. Peça um novo link de recuperação.'

export const MSG_SESSAO_RECUPERACAO_EXPIRADA =
  'Sua sessão de recuperação expirou. Peça um novo link para redefinir a senha.'

/** Códigos de ?erro= aceitos por /esqueci-senha (nada da URL vira texto na tela). */
export const ERROS_RECUPERACAO = {
  sessao: MSG_SESSAO_RECUPERACAO_EXPIRADA,
} as const

export function mensagemDeErro(codigo: string | undefined): string | null {
  if (!codigo) return null
  return ERROS_RECUPERACAO[codigo as keyof typeof ERROS_RECUPERACAO] ?? null
}

// ============================================================================
// Limite de pedidos (anti-abuso)
// ============================================================================

/**
 * O teto real é do Supabase: o email sai pelo SMTP do projeto, com cota por
 * hora compartilhada pelo projeto INTEIRO (dashboard incluso). Sem freio aqui,
 * um script esgota a cota e derruba a recuperação de senha de todo mundo.
 */
export const JANELA_LIMITE_MS = 60 * 60 * 1000

/** Pedidos por email por hora. */
export const LIMITE_POR_EMAIL = 3

/** Pedidos por IP por hora — segura script que varre uma lista de emails. */
export const LIMITE_POR_IP = 10

export interface JanelaLimite {
  /** Início da janela corrente, em epoch ms. */
  inicioMs: number
  /** Pedidos já gastos nesta janela. */
  usos: number
}

export interface DecisaoLimite {
  permitido: boolean
  /** Janela a persistir. Pedido negado volta inalterada (negar não consome cota). */
  janela: JanelaLimite
}

/**
 * Janela fixa: a primeira tentativa abre a janela, as seguintes gastam cota
 * até o teto, e a janela inteira expira de uma vez. Função pura — o relógio
 * entra por parâmetro.
 */
export function decidirLimite(
  janela: JanelaLimite | undefined,
  agoraMs: number,
  limite: number,
  janelaMs: number = JANELA_LIMITE_MS,
): DecisaoLimite {
  const expirada = !janela || agoraMs - janela.inicioMs >= janelaMs
  if (expirada) {
    return { permitido: true, janela: { inicioMs: agoraMs, usos: 1 } }
  }
  if (janela.usos < limite) {
    return {
      permitido: true,
      janela: { inicioMs: janela.inicioMs, usos: janela.usos + 1 },
    }
  }
  return { permitido: false, janela }
}

// ============================================================================
// Email e senha
// ============================================================================

/** Chave do limite e do Supabase: sem espaços e caixa-baixa, senão "A@x" e "a@x" viram cotas separadas. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Filtro de formato, não de existência: serve só para não gastar cota (nem
 * chamada ao Supabase) com string que obviamente não é email.
 */
export function emailPareceValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const SENHA_MIN = 8

/** Mesma regra do /reset-password (1º login): mínimo 8 caracteres. */
export function validarSenhaNova(senha: string): string | null {
  if (senha.length < SENHA_MIN) {
    return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`
  }
  return null
}
