import { redirect } from 'next/navigation'

import { PushSetup } from '@/components/push-setup'
import { Sidebar } from '@/components/sidebar'
import { Toaster } from '@/components/ui/sonner'
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
    .select('id, name')
    .eq('user_id', user.id)
    .maybeSingle()

  const sidebarUser = profile
    ? { id: profile.id as string, name: (profile.name as string) ?? user.email ?? 'Operador' }
    : { id: user.id, name: user.email ?? 'Operador' }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar user={sidebarUser} />
      <main className="flex h-screen flex-1 flex-col overflow-hidden">
        <PushSetup />
        {children}
      </main>
      <Toaster theme="dark" />
    </div>
  )
}
