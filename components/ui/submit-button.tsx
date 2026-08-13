'use client'

import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'

/**
 * Botão de submit para <form action={serverAction}>: desabilita enquanto a
 * action roda, matando o POST duplicado do clique repetido (a causa do falso
 * "New password should be different..." no reset de senha, 2026-08-13).
 * Precisa ser client component (useFormStatus) e filho direto do <form>.
 */
export function SubmitButton({
  pendingLabel,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  )
}
