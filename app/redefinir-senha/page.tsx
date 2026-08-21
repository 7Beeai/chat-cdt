import Image from 'next/image'
import { redirect } from 'next/navigation'

import { RedefinirSenhaForm } from '@/app/redefinir-senha/redefinir-senha-form'
import { HexagonPattern } from '@/components/ui/hexagon-pattern'
import { ROTA_ESQUECI_SENHA } from '@/lib/auth/password-recovery'
import { createClient } from '@/lib/supabase/server'

type SearchParams = Promise<{ token_hash?: string }>

/**
 * Quem chega pelo email traz ?token_hash= e AINDA NÃO tem sessão — ela nasce
 * no submit (verifyOtp dentro da action). O GET desta página não consome
 * nada: scanner de email que siga o link só carrega um formulário.
 */
export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { token_hash: tokenHash } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Sem token e sem sessão não há como provar quem é. Mandar pro /login seria
  // um beco sem saída (a senha é justamente a esquecida): volta pra tela que
  // sabe emitir outro link.
  if (!tokenHash && !user) redirect(`${ROTA_ESQUECI_SENHA}?erro=sessao`)

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
              {user?.email ? (
                <>
                  Escolha uma senha nova para a conta{' '}
                  <strong>{user.email}</strong>.
                </>
              ) : (
                <>Escolha uma senha nova para a sua conta.</>
              )}
            </p>
          </div>

          <RedefinirSenhaForm tokenHash={tokenHash} />

          <p className="mt-6 text-center text-xs text-muted-foreground">
            A senha nova vale para o CHAT-CDT e para o Dashboard.
          </p>
        </div>
      </div>
    </>
  )
}
