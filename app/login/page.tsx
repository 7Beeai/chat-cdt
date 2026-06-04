import Image from 'next/image'
import { redirect } from 'next/navigation'

import { signIn } from '@/app/login/actions'
import { Button } from '@/components/ui/button'
import { HexagonPattern } from '@/components/ui/hexagon-pattern'
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
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden [mask-image:radial-gradient(ellipse_70%_60%_at_50%_45%,black,transparent_75%)]"
      >
        <HexagonPattern
          radius={36}
          className="stroke-[hsl(83_79%_60%/0.12)] fill-none"
        />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-12">
        <Image
          src="/7bee-logo.png"
          alt="7Bee.AI — Intelligent Sales"
          width={2447}
          height={1132}
          priority
          className="mb-8 h-auto w-[180px] drop-shadow-[0_0_25px_hsl(36_100%_55%/0.25)]"
        />

        <div className="chart-card rounded-2xl px-8 py-10 max-w-md w-full">
        <div className="flex flex-col gap-2 text-center mb-8">
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
    </>
  )
}
