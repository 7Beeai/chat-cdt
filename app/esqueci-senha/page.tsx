import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { EsqueciSenhaForm } from '@/app/esqueci-senha/esqueci-senha-form'
import { HexagonPattern } from '@/components/ui/hexagon-pattern'
import { mensagemDeErro } from '@/lib/auth/password-recovery'
import { createClient } from '@/lib/supabase/server'

type SearchParams = Promise<{ erro?: string }>

export default async function EsqueciSenhaPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/inbox')

  // Só código conhecido vira texto — nada do que vem na URL é impresso.
  const aviso = mensagemDeErro(params.erro)

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
              Esqueci minha senha
            </h1>
            <p className="text-sm text-muted-foreground">
              Informe o email cadastrado e enviamos um link para você criar uma
              senha nova.
            </p>
          </div>

          {aviso ? (
            <div
              role="alert"
              className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
            >
              {aviso}
            </div>
          ) : null}

          <EsqueciSenhaForm />

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link
              href="/login"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Voltar para o login
            </Link>
          </p>
        </div>
      </div>
    </>
  )
}
