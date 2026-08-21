'use server'

import { headers } from 'next/headers'

import {
  decidirLimite,
  emailPareceValido,
  type JanelaLimite,
  JANELA_LIMITE_MS,
  LIMITE_POR_EMAIL,
  LIMITE_POR_IP,
  MSG_EMAIL_INVALIDO,
  MSG_MUITAS_TENTATIVAS,
  MSG_RECUPERACAO_ENVIADA,
  normalizarEmail,
  ROTA_REDEFINIR_SENHA,
} from '@/lib/auth/password-recovery'
import { createClient } from '@/lib/supabase/server'

/**
 * Contador de pedidos em memória do processo. Serve porque produção é UM
 * processo pm2 (`chat-cdt`, fork mode): o contador enxerga todos os pedidos.
 * Se um dia virar cluster, o limite passa a ser POR INSTÂNCIA — degrada, não
 * quebra, e a hora de trocar por tabela no Postgres é essa. Restart do pm2
 * zera os contadores; o teto do próprio Supabase continua valendo por baixo.
 */
const janelas = new Map<string, JanelaLimite>()

function consumirCota(chave: string, limite: number, agoraMs: number): boolean {
  // Poda o que já expirou para o Map não crescer sem fim.
  for (const [k, janela] of janelas) {
    if (agoraMs - janela.inicioMs >= JANELA_LIMITE_MS) janelas.delete(k)
  }
  const decisao = decidirLimite(janelas.get(chave), agoraMs, limite)
  janelas.set(chave, decisao.janela)
  return decisao.permitido
}

/** IP de quem pediu, atrás do nginx (que seta X-Forwarded-For e X-Real-IP). */
async function ipDoPedido(): Promise<string> {
  const h = await headers()
  const encaminhado = h.get('x-forwarded-for')
  if (encaminhado) return encaminhado.split(',')[0]?.trim() || 'desconhecido'
  return h.get('x-real-ip') ?? 'desconhecido'
}

/**
 * Base absoluta do link que vai no email — sai do próprio pedido, de propósito.
 * Um APP_ORIGIN esquecido em localhost mandaria email com link morto e calado
 * (o Supabase recusa redirectTo fora da allowlist e cai no site_url, que é o
 * dashboard). Host forjado não vira link malicioso pelo mesmo motivo: só passa
 * o que casa com a allowlist do projeto (https://chat.cdt.7bee.ai/**).
 */
async function baseUrlPublica(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  const protocolo = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https')
  return `${protocolo}://${host}`
}

/**
 * Dispara o email de recuperação.
 *
 * Responde SEMPRE a mesma coisa, exista o email ou não — a tela não pode
 * virar um verificador de "quem tem conta aqui". Falha do Supabase é logada
 * no servidor e engolida na resposta pelo mesmo motivo.
 *
 * Roda no servidor (e não no browser) porque é aqui que o limite de pedidos
 * tem efeito: pelo client, o pedido iria direto ao Supabase sem este freio.
 */
export async function solicitarRecuperacaoSenha(
  emailBruto: string,
): Promise<{ ok: true; mensagem: string } | { ok: false; erro: string }> {
  const email = normalizarEmail(emailBruto)
  if (!emailPareceValido(email)) return { ok: false, erro: MSG_EMAIL_INVALIDO }

  const agora = Date.now()
  const ip = await ipDoPedido()
  // Dois freios: por IP segura o script que varre lista de emails; por email
  // segura o pedido repetido no mesmo endereço.
  if (!consumirCota(`ip:${ip}`, LIMITE_POR_IP, agora)) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS }
  }
  if (!consumirCota(`email:${email}`, LIMITE_POR_EMAIL, agora)) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS }
  }

  // O template de recovery do projeto monta o link como
  // `{{ .RedirectTo }}?token_hash={{ .TokenHash }}` — este redirectTo é a
  // própria tela de senha nova. Precisa casar com a allowlist do Auth.
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await baseUrlPublica()}${ROTA_REDEFINIR_SENHA}`,
  })
  if (error) {
    console.error('[esqueci-senha] resetPasswordForEmail falhou:', error.message)
  }

  return { ok: true, mensagem: MSG_RECUPERACAO_ENVIADA }
}
