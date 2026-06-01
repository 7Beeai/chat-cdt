'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  Check,
  Copy,
  KeyRound,
  Mail,
  MoreVertical,
  Plus,
  Power,
  Search,
  Shield,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  createUserAction,
  deleteUserAction,
  inviteUserAction,
  setUserActiveAction,
  setUserUnitsAction,
} from '@/app/(app)/admin/actions'
import type { ActionResult } from '@/app/(app)/admin/types'
import type { AdminUserRow } from '@/app/(app)/admin/users/page'
import type { UnitOption } from '@/components/inbox/unit-filter'
import { unitShortName } from '@/components/inbox/unit-filter'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { relativeTime } from '@/lib/format/time'
import { cn } from '@/lib/utils'
import { unitColor } from '@/lib/unit-colors'

type CreateMode = 'password' | 'invite'

/** A user is disabled when their auth account is currently banned. */
function isDisabled(u: AdminUserRow): boolean {
  if (u.banned_until) return new Date(u.banned_until).getTime() > Date.now()
  return u.is_active === false
}

export function UsersManager({
  users,
  units,
}: {
  users: AdminUserRow[]
  units: UnitOption[]
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null)
  const [query, setQuery] = useState('')
  const [pending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name ?? '').toLowerCase().includes(q),
    )
  }, [users, query])

  function toggleActive(u: AdminUserRow) {
    const next = isDisabled(u)
    startTransition(async () => {
      const res = await setUserActiveAction(u.auth_id, u.profile_id, next)
      res.ok ? toast.success(res.message) : toast.error(res.message)
    })
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-accent" />
            <h1 className="text-[17px] font-bold tracking-[-0.02em] text-foreground">
              Usuários
            </h1>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Crie ou convide operadores e defina quais unidades cada um enxerga.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="lg">
          <Plus className="size-4" />
          Novo usuário
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {/* Dashboard */}
        <StatsBar users={users} />
        <UnitCoverage users={users} units={units} />

        {/* Search */}
        <div className="relative mb-3 mt-6 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="h-9 pl-8"
          />
        </div>

        {/* List */}
        <div className="flex flex-col gap-1.5">
          {filtered.map((u) => (
            <UserRow
              key={u.auth_id}
              user={u}
              units={units}
              busy={pending}
              onEdit={() => setEditing(u)}
              onToggleActive={() => toggleActive(u)}
              onDelete={() => setDeleting(u)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="py-16 text-center text-[13px] text-muted-foreground">
              {query
                ? 'Nenhum usuário corresponde à busca.'
                : 'Nenhum usuário encontrado.'}
            </div>
          )}
        </div>
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        units={units}
      />
      <EditUnitsDialog
        user={editing}
        units={units}
        onClose={() => setEditing(null)}
      />
      <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard — summary stat cards
// ---------------------------------------------------------------------------
function StatsBar({ users }: { users: AdminUserRow[] }) {
  const total = users.length
  const admins = users.filter((u) => u.is_admin).length
  const inactive = users.filter((u) => isDisabled(u)).length
  const active = total - inactive
  const orphan = users.filter((u) => u.unit_ids.length === 0 && !u.is_admin).length

  const cards = [
    { label: 'Usuários', value: total, icon: Users, tone: 'text-foreground' },
    { label: 'Admins', value: admins, icon: Shield, tone: 'text-accent' },
    { label: 'Ativos', value: active, icon: Power, tone: 'text-foreground' },
    {
      label: 'Sem unidade',
      value: orphan,
      icon: TriangleAlert,
      tone: orphan > 0 ? 'text-amber-400' : 'text-muted-foreground',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon
        return (
          <div
            key={c.label}
            className="rounded-[12px] border border-border bg-card px-3.5 py-3"
          >
            <div className="flex items-center gap-1.5">
              <Icon className={cn('size-3.5', c.tone)} />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {c.label}
              </span>
            </div>
            <div className={cn('mt-1 text-[26px] font-bold tabular-nums tracking-[-0.02em]', c.tone)}>
              {c.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard — per-unit operator coverage
// ---------------------------------------------------------------------------
function UnitCoverage({
  users,
  units,
}: {
  users: AdminUserRow[]
  units: UnitOption[]
}) {
  // Operator coverage = non-admin users linked to a unit. Admins all see every
  // unit, so counting them per-unit would be identical noise on every card.
  const counts = useMemo(() => {
    const operators = new Map<string, number>()
    const admins = new Map<string, number>()
    for (const u of users) {
      for (const id of u.unit_ids) {
        const bucket = u.is_admin ? admins : operators
        bucket.set(id, (bucket.get(id) ?? 0) + 1)
      }
    }
    return { operators, admins }
  }, [users])

  return (
    <div className="mt-3">
      <span className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Cobertura por unidade · operadores
      </span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {units.map((u) => {
          const c = unitColor(u.id)
          const ops = counts.operators.get(u.id) ?? 0
          const adm = counts.admins.get(u.id) ?? 0
          const uncovered = ops === 0
          return (
            <div
              key={u.id}
              className={cn(
                'flex items-center gap-2 rounded-[10px] border bg-card px-3 py-2',
                uncovered ? 'border-amber-500/30' : 'border-border',
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.solid }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-foreground">
                  {unitShortName(u)}
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {adm > 0 && <span className="text-accent">{adm} adm · </span>}
                  {uncovered ? (
                    <span className="text-amber-400">sem operador</span>
                  ) : (
                    `${ops} operador${ops > 1 ? 'es' : ''}`
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single row in the roster
// ---------------------------------------------------------------------------
function UserRow({
  user,
  units,
  busy,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  user: AdminUserRow
  units: UnitOption[]
  busy: boolean
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  const label = user.name?.trim() || user.email
  const initial = label.trim().charAt(0).toUpperCase() || '?'
  const disabled = isDisabled(user)
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const visible = user.unit_ids
    .map((id) => unitMap.get(id))
    .filter((u): u is UnitOption => Boolean(u))
  const lastLogin = user.last_sign_in_at
    ? relativeTime(user.last_sign_in_at)
    : 'nunca'

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[11px] border bg-card px-3.5 py-3 transition-colors',
        disabled ? 'border-border/60 opacity-60' : 'border-border',
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/12 text-sm font-bold text-accent">
        {initial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-foreground">
            {label}
          </span>
          {user.is_admin && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-accent">
              <Shield className="size-2.5" />
              Admin
            </span>
          )}
          {disabled && (
            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-destructive">
              Inativo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className="truncate">{user.email}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="shrink-0 whitespace-nowrap">
            último acesso {lastLogin}
          </span>
        </div>
        {/* Unit chips */}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {visible.length === 0 ? (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              Sem unidades — não vê nada
            </span>
          ) : (
            visible.map((u) => {
              const c = unitColor(u.id)
              return (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: c.bg,
                    color: c.fg,
                    border: `1px solid ${c.border}`,
                  }}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: c.solid }}
                  />
                  {unitShortName(u)}
                </span>
              )
            })
          )}
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={onEdit}>
        Editar unidades
      </Button>
      <RowActions
        disabled={disabled}
        busy={busy}
        onToggleActive={onToggleActive}
        onDelete={onDelete}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-row actions popover (deactivate / delete)
// ---------------------------------------------------------------------------
function RowActions({
  disabled,
  busy,
  onToggleActive,
  onDelete,
}: {
  disabled: boolean
  busy: boolean
  onToggleActive: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="size-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-48 overflow-hidden rounded-[10px] border border-border bg-card p-1 shadow-[0_14px_36px_rgba(0,0,0,0.55)]"
        >
          <MenuItem
            icon={<Power className="size-3.5" />}
            label={disabled ? 'Reativar' : 'Desativar'}
            disabled={busy}
            onClick={() => {
              setOpen(false)
              onToggleActive()
            }}
          />
          <div className="my-1 h-px bg-border" aria-hidden />
          <MenuItem
            icon={<Trash2 className="size-3.5" />}
            label="Excluir"
            destructive
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  destructive,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px] font-medium transition-colors disabled:opacity-50',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-secondary',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Reusable unit multi-select (toggle chips)
// ---------------------------------------------------------------------------
function UnitPicker({
  units,
  selected,
  onChange,
}: {
  units: UnitOption[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Unidades visíveis
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onChange(new Set(units.map((u) => u.id)))}
            className="font-mono text-[9px] uppercase tracking-[0.1em] text-accent hover:underline"
          >
            Todas
          </button>
          <span className="text-muted-foreground/40">·</span>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground hover:underline"
          >
            Limpar
          </button>
        </div>
      </div>
      <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto rounded-[10px] border border-border bg-secondary/40 p-2">
        {units.map((u) => {
          const active = selected.has(u.id)
          const c = unitColor(u.id)
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px] font-medium transition-colors',
                active
                  ? 'text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
              style={
                active
                  ? { backgroundColor: c.bg, borderColor: c.border, color: c.fg }
                  : undefined
              }
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: active ? c.solid : 'hsl(0 0% 40%)' }}
              />
              {unitShortName(u)}
              {active && <Check className="size-3" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create / invite dialog
// ---------------------------------------------------------------------------
function CreateUserDialog({
  open,
  onOpenChange,
  units,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  units: UnitOption[]
}) {
  const [mode, setMode] = useState<CreateMode>('password')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setName('')
    setEmail('')
    setPassword('')
    setSelected(new Set())
    setTempPassword(null)
  }

  function handle(result: Promise<ActionResult>) {
    startTransition(async () => {
      const res = await result
      if (res.ok) {
        toast.success(res.message)
        if (res.tempPassword) {
          setTempPassword(res.tempPassword)
        } else {
          reset()
          onOpenChange(false)
        }
      } else {
        toast.error(res.message)
      }
    })
  }

  function submit() {
    const fd = new FormData()
    fd.set('email', email)
    fd.set('name', name)
    if (mode === 'password') fd.set('password', password)
    selected.forEach((id) => fd.append('unitIds', id))
    handle(mode === 'password' ? createUserAction(fd) : inviteUserAction(fd))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4 text-accent" />
            Novo usuário
          </DialogTitle>
          <DialogDescription>
            Crie um acesso e escolha as unidades que ele poderá visualizar.
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <TempPasswordPanel
            email={email}
            password={tempPassword}
            onDone={() => {
              reset()
              onOpenChange(false)
            }}
          />
        ) : (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-secondary p-1">
              <ModeTab
                active={mode === 'password'}
                onClick={() => setMode('password')}
                icon={<KeyRound className="size-3.5" />}
                label="Criar com senha"
              />
              <ModeTab
                active={mode === 'invite'}
                onClick={() => setMode('invite')}
                icon={<Mail className="size-3.5" />}
                label="Convite por e-mail"
              />
            </div>

            <Field label="Nome">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do operador"
              />
            </Field>

            <Field label="E-mail">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operador@exemplo.com"
              />
            </Field>

            {mode === 'password' && (
              <Field label="Senha (opcional)">
                <Input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Deixe vazio para gerar automaticamente"
                />
              </Field>
            )}

            <UnitPicker units={units} selected={selected} onChange={setSelected} />

            {mode === 'invite' && (
              <p className="rounded-[8px] bg-secondary/60 px-2.5 py-2 text-[11px] text-muted-foreground">
                O convite depende de SMTP configurado no Supabase. Se não chegar,
                use “Criar com senha”.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending || !email}>
                {pending
                  ? 'Processando…'
                  : mode === 'password'
                    ? 'Criar usuário'
                    : 'Enviar convite'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TempPasswordPanel({
  email,
  password,
  onDone,
}: {
  email: string
  password: string
  onDone: () => void
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      toast.success('Senha copiada.')
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[10px] border border-accent/30 bg-accent/8 p-3">
        <p className="text-[12.5px] text-foreground">
          Usuário <span className="font-semibold">{email}</span> criado. Esta
          senha aparece <span className="font-semibold">apenas agora</span> —
          copie e entregue à pessoa.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded-[7px] bg-background px-2.5 py-1.5 font-mono text-[13px] text-accent">
            {password}
          </code>
          <Button variant="outline" size="icon-sm" onClick={copy}>
            <Copy className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={onDone}>Concluir</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit-units dialog
// ---------------------------------------------------------------------------
function EditUnitsDialog({
  user,
  units,
  onClose,
}: {
  user: AdminUserRow | null
  units: UnitOption[]
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (user && seededFor !== user.auth_id) {
    setSeededFor(user.auth_id)
    setSelected(new Set(user.unit_ids))
  }

  function save() {
    if (!user?.profile_id) {
      toast.error('Este usuário ainda não tem perfil. Peça que ele faça login uma vez.')
      return
    }
    const profileId = user.profile_id
    startTransition(async () => {
      const res = await setUserUnitsAction(profileId, [...selected])
      if (res.ok) {
        toast.success(res.message)
        onClose()
      } else {
        toast.error(res.message)
      }
    })
  }

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unidades de {user?.name?.trim() || user?.email}</DialogTitle>
          <DialogDescription>
            {user?.is_admin
              ? 'Este usuário é admin. As unidades abaixo controlam o que ele vê no inbox.'
              : 'Marque as unidades que este usuário pode visualizar.'}
          </DialogDescription>
        </DialogHeader>

        <UnitPicker units={units} selected={selected} onChange={setSelected} />

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------
function DeleteUserDialog({
  user,
  onClose,
}: {
  user: AdminUserRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()

  function confirm() {
    if (!user) return
    const authId = user.auth_id
    startTransition(async () => {
      const res = await deleteUserAction(authId)
      if (res.ok) {
        toast.success(res.message)
        onClose()
      } else {
        toast.error(res.message)
      }
    })
  }

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-4" />
            Excluir usuário
          </DialogTitle>
          <DialogDescription>
            Excluir permanentemente{' '}
            <span className="font-semibold text-foreground">
              {user?.name?.trim() || user?.email}
            </span>
            ? Esta ação não pode ser desfeita e remove o acesso, o perfil e os
            vínculos de unidade.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-[8px] bg-secondary/60 px-2.5 py-2 text-[11px] text-muted-foreground">
          Usuários com histórico (mensagens ou conversas) não podem ser
          excluídos — nesse caso, prefira <span className="font-semibold">Desativar</span>.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? 'Excluindo…' : 'Excluir definitivamente'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 text-[12px] font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
