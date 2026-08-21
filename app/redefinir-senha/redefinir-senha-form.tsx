'use client'

import { type FormEvent, useState } from 'react'

import { redefinirSenha } from '@/app/redefinir-senha/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SENHA_MIN, validarSenhaNova } from '@/lib/auth/password-recovery'

export function RedefinirSenhaForm({ tokenHash }: { tokenHash?: string }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)

    // Mesma regra do servidor, só que sem ida e volta. Quem manda é o servidor.
    const problema = validarSenhaNova(senha)
    if (problema) {
      setErro(problema)
      return
    }
    if (senha !== confirmacao) {
      setErro('As senhas não conferem.')
      return
    }

    setCarregando(true)
    const r = await redefinirSenha(senha, tokenHash)
    if (!r.ok) {
      setErro(r.erro)
      setCarregando(false)
      return
    }
    // Recarrega de verdade: a sessão mudou de senha e os cookies vieram novos.
    window.location.href = r.destino
  }

  return (
    <form onSubmit={salvar} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
        >
          Nova senha
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={SENHA_MIN}
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
          placeholder={`mínimo ${SENHA_MIN} caracteres`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirm"
          className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
        >
          Confirmar nova senha
        </label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={SENHA_MIN}
          value={confirmacao}
          onChange={(evento) => setConfirmacao(evento.target.value)}
          placeholder="repita a senha"
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
        {carregando ? 'Salvando…' : 'Salvar e entrar'}
      </Button>
    </form>
  )
}
