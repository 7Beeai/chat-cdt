import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { UnitFilterProvider, type UnitOption } from '@/components/inbox/unit-filter'
import { Toaster } from '@/components/ui/sonner'
import { getIsAdmin } from '@/lib/auth/admin'
import { getIsSalesOnly } from '@/lib/auth/sales'
import { getSessionUser } from '@/lib/auth/session'
import { getInboxVitals } from '@/lib/inbox/vitals'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const user = await getSessionUser()

  if (!user) {
    redirect('/login')
  }

  // Tudo abaixo depende só do user: dispara em PARALELO (antes eram 5 awaits
  // em série, ~140ms de rede cada — VPS Iowa ↔ Supabase São Paulo). O vitals
  // entra no mesmo lote (RPC ~10ms) e é cacheado por request pro inbox layout.
  const [{ data: profile }, unitsRes, isAdmin, salesOnly, vitalsRaw] =
    await Promise.all([
      // Resolve operator profile via auth.uid() -> profiles.user_id chain.
      supabase
        .from('profiles')
        .select('id, name, must_reset_password')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase.rpc('chat_my_units'),
      getIsAdmin(supabase),
      getIsSalesOnly(supabase),
      getInboxVitals(supabase),
    ])

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
  const { data: unitRows, error: unitsError } = unitsRes
  if (unitsError) {
    console.error('[app] failed to load units', unitsError)
  }
  const units: UnitOption[] = (unitRows ?? []) as UnitOption[]

  // isAdmin: gate do link "Usuários" (chat_is_admin()). salesOnly: gate
  // "somente vendas" (migration 0027) — sidebar só mostra Vendas; Inbox/
  // Relatórios redirecionam nos próprios layouts.

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
  // Somente-vendas não vê a Inbox — nem o badge.
  let waitingCount = 0
  if (!salesOnly) {
    waitingCount = vitalsRaw.reduce(
      (sum, v) => sum + (Number(v.waiting) || 0),
      0,
    )
  }

  return (
    <UnitFilterProvider units={units}>
      <AppShell
        user={sidebarUser}
        waitingCount={waitingCount}
        isAdmin={isAdmin}
        salesOnly={salesOnly}
      >
        {children}
      </AppShell>
      <Toaster theme="dark" />
    </UnitFilterProvider>
  )
}
