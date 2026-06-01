import { redirect } from 'next/navigation'
import { LayoutTemplate } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function TemplatesPage() {
  // Tela desativada temporariamente — remover este redirect para restaurar.
  redirect('/inbox')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="elegant-divider flex items-center gap-3 border-b border-border bg-card px-6 py-5">
        <LayoutTemplate className="size-5 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-base font-extrabold tracking-tight text-foreground">
            Templates
          </h1>
          <p className="text-xs text-muted-foreground">
            Aprovados via Meta Business Manager — usados no composer da thread.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="chart-card max-w-2xl rounded-2xl p-6">
          <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-accent">
            Em construção
          </span>
          <h2 className="mt-2 text-base font-semibold text-foreground">
            Tela ainda não disponível
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A v1 do CHAT-CDT consome a tabela{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              template_inventory
            </code>{' '}
            do fluxo n8n. Para a v1, a lista é exposta dentro do composer
            (botão &quot;Templates&quot; ao escrever uma mensagem na thread).
            Esta tela vai listar/inspecionar templates em uma versão futura.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Por enquanto, abra uma conversa em{' '}
            <strong className="text-foreground">Inbox</strong> e clique no
            botão <strong className="text-foreground">Templates</strong> dentro
            do composer.
          </p>
        </div>
      </div>
    </div>
  )
}
