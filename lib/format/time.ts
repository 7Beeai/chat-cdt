/**
 * Relative time helper in Brazilian Portuguese.
 * Avoids external date libs — uses plain math.
 */
export function relativeTime(ts: string | null): string {
  if (!ts) return ''
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return ''

  const now = Date.now()
  const diffSec = Math.floor((now - then) / 1000)

  if (diffSec < 45) return 'agora'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `há ${diffMin}m`

  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`

  // Yesterday vs N days ago: compare calendar day, not 24h windows.
  const a = new Date(now)
  const b = new Date(then)
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOf(a) - startOf(b)) / 86_400_000)

  if (diffDays === 1) return 'ontem'
  if (diffDays < 30) return `há ${diffDays}d`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `há ${diffMonths}mes`

  const diffYears = Math.floor(diffDays / 365)
  return `há ${diffYears}a`
}

/**
 * Remaining time formatter for the Meta 24h window.
 * Returns { expired: boolean, label: string }.
 */
export function windowRemaining(expiresAt: string | null): {
  expired: boolean
  label: string
} {
  if (!expiresAt) return { expired: true, label: 'sem janela' }
  const target = new Date(expiresAt).getTime()
  if (Number.isNaN(target)) return { expired: true, label: 'sem janela' }

  const diffSec = Math.floor((target - Date.now()) / 1000)
  if (diffSec <= 0) return { expired: true, label: 'fora da janela' }

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return { expired: false, label: `${diffMin}m` }

  const diffH = Math.floor(diffMin / 60)
  const remMin = diffMin % 60
  if (diffH < 24) return { expired: false, label: `${diffH}h${remMin ? ` ${remMin}m` : ''}` }

  return { expired: false, label: `${Math.floor(diffH / 24)}d` }
}

/**
 * Date label para divisores no thread: "Hoje", "Ontem", "12 de mai", ou
 * "12 de mai de 2024" (quando ano difere do atual). Usa pt-BR.
 */
const PT_MONTHS_SHORT = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
]
export function dateDividerLabel(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (diffDays === 0) return 'Hoje'
  if (diffDays === 1) return 'Ontem'
  const dayMonth = `${d.getDate()} de ${PT_MONTHS_SHORT[d.getMonth()]}`
  if (d.getFullYear() === now.getFullYear()) return dayMonth
  return `${dayMonth} de ${d.getFullYear()}`
}

/**
 * Identifica o dia-calendário em YYYY-MM-DD (key para agrupamento por data).
 */
export function dateKey(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`
  )
}

/**
 * Formats an E.164-ish wa_id (digits-only, no '+') as +55 31 9 9999-9999 (best-effort, BR-first).
 * Falls back to "+<digits>" if shape is unknown.
 */
export function formatWaId(waId: string | null | undefined): string {
  if (!waId) return ''
  const digits = waId.replace(/\D/g, '')

  // Brazil: 55 + DDD(2) + 9?(1) + 8 digits → 12 or 13 total
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4)
    const rest = digits.slice(4)
    if (rest.length === 9) {
      return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`
    }
    return `+55 ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`
  }
  return `+${digits}`
}
