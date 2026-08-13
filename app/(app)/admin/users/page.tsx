import { requireAdmin } from '@/lib/auth/admin'
import { UsersManager } from '@/components/admin/users-manager'
import type { UnitOption } from '@/components/inbox/unit-filter'

export const dynamic = 'force-dynamic'

export type AdminUserRow = {
  auth_id: string
  profile_id: string | null
  email: string
  name: string | null
  is_active: boolean
  is_admin: boolean
  is_sales_agent: boolean
  unit_ids: string[]
  last_sign_in_at: string | null
  created_at: string | null
  banned_until: string | null
}

export default async function AdminUsersPage() {
  // Gate: redirects non-admins. Returns the user-scoped client.
  const { supabase } = await requireAdmin()

  const [{ data: userRows, error: usersError }, { data: unitRows }] =
    await Promise.all([
      supabase.rpc('chat_admin_list_users'),
      supabase.from('units').select('id, code, name').order('name'),
    ])

  if (usersError) {
    console.error('[admin/users] failed to load users', usersError)
  }

  const users = (userRows ?? []) as AdminUserRow[]
  const units = (unitRows ?? []) as UnitOption[]

  return <UsersManager users={users} units={units} />
}
