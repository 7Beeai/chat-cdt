import Image from 'next/image'
import { redirect } from 'next/navigation'

import { signOut } from '@/app/login/actions'
import { setNewPassword } from '@/app/reset-password/actions'
import { Button } from '@/components/ui/button'
import { HexagonPattern } from '@/components/ui/hexagon-pattern'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/server'

type SearchParams = Promise<{ error?: string }>

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const error = typeof params.error === 'string' ? params.error : null

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
              Defina sua senha
            </h1>
            <p className="text-sm text-muted-foreground">
              Sua senha atual é temporária. Crie uma senha nova, só sua, para
              continuar.
            </p>
          </div>

          <form action={setNewPassword} className="flex flex-col gap-5">
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
                htmlFor="password"
                className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
              >
                Nova senha
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="mínimo 8 caracteres"
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
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="repita a senha"
              />
            </div>

            <Button type="submit" className="mt-2 w-full">
              Salvar e entrar
            </Button>
          </form>

          <form action={signOut} className="mt-4 text-center">
            <button
              type="submit"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Sair
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
