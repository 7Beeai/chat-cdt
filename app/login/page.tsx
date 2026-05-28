import { redirect } from 'next/navigation'

import { signIn } from '@/app/login/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/server'

type SearchParams = Promise<{ error?: string; next?: string }>

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const next =
      typeof params.next === 'string' && params.next.startsWith('/') && !params.next.startsWith('//')
        ? params.next
        : '/inbox'
    redirect(next)
  }

  const error = typeof params.error === 'string' ? params.error : null
  const next = typeof params.next === 'string' ? params.next : '/inbox'

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
      <div className="chart-card rounded-2xl px-8 py-10 max-w-md w-full">
        <div className="flex flex-col gap-2 text-center mb-8">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
            7Bee.AI · CHAT-CDT
          </span>
          <h1 className="gradient-text font-extrabold text-2xl tracking-tight leading-none">
            Atendimento Humano
          </h1>
          <p className="text-sm text-muted-foreground">
            Acesso ao atendimento humano WhatsApp
          </p>
        </div>

        <form action={signIn} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
            >
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
            >
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="voce@cdt.com.br"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
            >
              Senha
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" className="mt-2 w-full">
            Entrar
          </Button>
        </form>
      </div>
    </div>
  )
}
