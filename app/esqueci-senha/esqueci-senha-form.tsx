'use client'

import { type FormEvent, useState } from 'react'

import { solicitarRecuperacaoSenha } from '@/app/esqueci-senha/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function EsqueciSenhaForm() {
  const [email, setEmail] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviado, setEnviado] = useState<string | null>(null)

  async function pedir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setCarregando(true)

    const r = await solicitarRecuperacaoSenha(email)
    setCarregando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setEnviado(r.mensagem)
  }

  // Confirmação substitui o formulário: reapresentar o campo convida a pessoa
  // a martelar o botão e queimar a cota de email do projeto à toa.
  if (enviado) {
    return (
      <p
        role="status"
        className="rounded-md border border-border bg-muted/40 px-3 py-3 text-center text-sm text-muted-foreground"
      >
        {enviado}
      </p>
    )
  }

  return (
    <form onSubmit={pedir} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
        >
          Email
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          placeholder="voce@cdt.com.br"
        />
      </div>

      {erro ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
        >
          {erro}
        </div>
      ) : null}

      <Button type="submit" disabled={carregando} className="mt-2 w-full">
        {carregando ? 'Enviando…' : 'Enviar link de recuperação'}
      </Button>
    </form>
  )
}
