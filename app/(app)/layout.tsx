import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { UnitFilterProvider, type UnitOption } from '@/components/inbox/unit-filter'
import { Toaster } from '@/components/ui/sonner'
import { getIsAdmin } from '@/lib/auth/admin'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Resolve operator profile via auth.uid() -> profiles.user_id chain.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, must_reset_password')
    .eq('user_id', user.id)
    .maybeSingle()

  // 1º login com senha temporária: força a troca antes de usar o sistema.
  // /reset-password fica FORA deste grupo (app), então não há loop.
  if (profile?.must_reset_password) {
    redirect('/reset-password')
  }

  const sidebarUser = profile
    ? {
        id: profile.id as string,
        name: (profile.name as string) ?? user.email ?? 'Operador',
      }
    : { id: user.id, name: user.email ?? 'Operador' }

  // Units the operator can access — single fetch, shared by the sidebar's
  // UnitSelect (the unit filter source of truth) via UnitFilterProvider.
  // Uses chat_my_units() (SECURITY DEFINER): the pre-existing RLS on
  // user_units compares user_id with auth.uid() but user_id points at
  // profiles.id — a direct select returns empty. See migration 0005.
  const { data: unitRows, error: unitsError } = await supabase.rpc(
    'chat_my_units',
  )
  if (unitsError) {
    console.error('[app] failed to load units', unitsError)
  }
  const units: UnitOption[] = (unitRows ?? []) as UnitOption[]

  // Admin gate for the "Usuários" nav link (role-based via chat_is_admin()).
  const isAdmin = await getIsAdmin(supabase)

  // Badge "aguardando" do sidebar (RLS-scoped às units do operador).
  // ANTES: COUNT(count:'exact') direto em conversations — sob a RLS chat_conv_all
  // isso reavalia chat_user_has_unit() por linha sobre ~23k abertas, custando
  // ~8s de média (max 179s) e BLOQUEANDO o SSR de cada navegação do operador.
  // AGORA: RPC chat_inbox_vitals() (SECURITY DEFINER, RLS-scoped, ~8ms) — a MESMA
  // fonte que a inbox já usa — somando o `waiting` de todas as units.
  // INVARIANTE: vitals.waiting filtra handoff_reason IS NOT NULL e routing<>'ai';
  // o COUNT antigo não filtrava handoff_reason. São equivalentes porque toda
  // conversa open + routing in (queued,human) + sem dono tem handoff_reason (a
  // inbox só lida com handoffs). Se surgir escalada open sem handoff_reason,
  // revisar este badge.
  const { data: vitalsRaw } = await supabase.rpc('chat_inbox_vitals')
  const waitingCount = ((vitalsRaw ?? []) as { waiting: number }[]).reduce(
    (sum, v) => sum + (Number(v.waiting) || 0),
    0,
  )

  return (
    <UnitFilterProvider units={units}>
      <AppShell
        user={sidebarUser}
        waitingCount={waitingCount ?? 0}
        isAdmin={isAdmin}
      >
        {children}
      </AppShell>
      <Toaster theme="dark" />
    </UnitFilterProvider>
  )
}
