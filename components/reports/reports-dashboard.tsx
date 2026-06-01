'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Clock3,
  Inbox,
  Lightbulb,
  MessageSquare,
  TrendingUp,
  Users,
} from 'lucide-react'

import { HANDOFF_LABEL, type HandoffReason } from '@/app/(app)/inbox/list-data'
import { CLOSE_OUTCOME_LABEL, type CloseOutcome } from '@/app/(app)/inbox/outcomes'
import { useUnitFilter, unitShortName } from '@/components/inbox/unit-filter'
import { createClient } from '@/lib/supabase/client'
import { unitColor } from '@/lib/unit-colors'
import { cn } from '@/lib/utils'

import {
  AreaChart,
  BarList,
  Delta,
  EmptyState,
  Funnel,
  LIME,
  Panel,
  Ring,
  Stat,
  fmtDuration,
  fmtInt,
} from './primitives'

// ---------------------------------------------------------------------------
// Types mirroring the RPC JSON (migration 0012)
// ---------------------------------------------------------------------------
type Overview = {
  kpis: {
    conversations: number
    handoffs: number
    handoff_rate: number
    deflection_rate: number
    messages: number
    backlog_now: number
  }
  prev: { conversations: number; handoffs: number }
  msg_split: { customer: number; ai: number; operator: number }
  by_reason: { reason: HandoffReason; n: number }[]
  by_unit: {
    unit_id: string
    name: string
    convs: number
    handoffs: number
    rate: number
  }[]
  hour_of_day: { hour: number; n: number }[]
  daily: { day: string; convs: number; handoffs: number }[]
}

type Attendance = {
  funnel: { queued: number; assigned: number; closed: number }
  sla: {
    time_to_assign_sec: { avg: number; p50: number; p90: number; n: number }
    handle_time_sec: { avg: number; p50: number; n: number }
  }
  outcomes: { outcome: CloseOutcome; n: number }[]
  operators: {
    operator_id: string
    name: string | null
    closed: number
    resolved: number
    resolution_rate: number
    avg_handle_sec: number
  }[]
}

type Period = 'today' | '7d' | '30d'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
]

const REASON_COLOR: Record<HandoffReason, string> = {
  cancel: '#f87171',
  payment_re_register: '#38bdf8',
  other_support: '#fbbf24',
}

function rangeOf(period: Period): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  if (period === 'today') from.setHours(0, 0, 0, 0)
  else if (period === '7d') from.setDate(from.getDate() - 7)
  else from.setDate(from.getDate() - 30)
  return { from: from.toISOString(), to: to.toISOString() }
}

function deltaPct(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null
  return ((cur - prev) / prev) * 100
}

// ---------------------------------------------------------------------------

export function ReportsDashboard() {
  const { selectedUnitId, selectedUnit } = useUnitFilter()
  const [period, setPeriod] = useState<Period>('7d')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [attendance, setAttendance] = useState<Attendance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const { from, to } = rangeOf(period)
    const supabase = createClient()
    const args = { p_from: from, p_to: to, p_unit: selectedUnitId }
    Promise.all([
      supabase.rpc('chat_report_overview', args),
      supabase.rpc('chat_report_attendance', args),
    ])
      .then(([ov, at]) => {
        if (cancelled) return
        if (ov.error) throw ov.error
        if (at.error) throw at.error
        setOverview(ov.data as Overview)
        setAttendance(at.data as Attendance)
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Falha ao carregar relatórios.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, selectedUnitId])

  const insights = useMemo(
    () => (overview ? buildInsights(overview) : []),
    [overview],
  )

  const scopeLabel = selectedUnit
    ? unitShortName(selectedUnit)
    : 'Todas as unidades'

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-accent" />
            <h1 className="text-[17px] font-bold tracking-[-0.02em] text-foreground">
              Relatórios
            </h1>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Operação de atendimento · {scopeLabel}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-secondary/50 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              aria-pressed={period === p.value}
              className={cn(
                'rounded-full px-3 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] transition-colors',
                period === p.value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {error ? (
          <div className="rounded-[12px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
            {error}
          </div>
        ) : loading || !overview || !attendance ? (
          <DashboardSkeleton />
        ) : (
          <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
            <KpiRow overview={overview} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <DeflectionPanel overview={overview} />
              <DemandPanel overview={overview} />
            </div>

            {insights.length > 0 && <InsightsPanel insights={insights} />}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ReasonPanel overview={overview} />
              <UnitPanel overview={overview} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <FunnelPanel attendance={attendance} />
              <OutcomePanel attendance={attendance} />
            </div>

            <OperatorsPanel attendance={attendance} />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------
function KpiRow({ overview }: { overview: Overview }) {
  const k = overview.kpis
  const convDelta = deltaPct(k.conversations, overview.prev.conversations)
  const handoffDelta = deltaPct(k.handoffs, overview.prev.handoffs)

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat
        label="Conversas"
        value={fmtInt(k.conversations)}
        icon={<MessageSquare className="size-3.5" />}
        delta={{ pct: convDelta }}
        hint="vs. período anterior"
      />
      <Stat
        label="Resolvidas sem atendente"
        value={k.deflection_rate.toLocaleString('pt-BR')}
        unit="%"
        tone="accent"
        big
        icon={<Bot className="size-3.5" />}
        hint="IA conduziu sozinha"
      />
      <Stat
        label="Handoffs"
        value={fmtInt(k.handoffs)}
        icon={<Users className="size-3.5" />}
        delta={{ pct: handoffDelta, positiveIsGood: false }}
        hint={`${k.handoff_rate}% das conversas`}
      />
      <Stat
        label="Aguardando agora"
        value={fmtInt(k.backlog_now)}
        tone={k.backlog_now > 0 ? 'warn' : 'default'}
        icon={<Inbox className="size-3.5" />}
        hint="na fila, sem atendente"
      />
      <Stat
        label="Mensagens"
        value={fmtInt(k.messages)}
        icon={<MessageSquare className="size-3.5" />}
        hint="no período"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deflection ring + message split
// ---------------------------------------------------------------------------
function DeflectionPanel({ overview }: { overview: Overview }) {
  const k = overview.kpis
  const split = overview.msg_split
  const total = split.customer + split.ai + split.operator || 1
  const segs = [
    { label: 'Cliente', n: split.customer, color: 'hsl(240 6% 60%)' },
    { label: 'IA', n: split.ai, color: LIME },
    { label: 'Operador', n: split.operator, color: '#38bdf8' },
  ]

  return (
    <Panel
      title="Autonomia da IA"
      subtitle="Quanto a IA resolve antes de chamar um humano"
    >
      <div className="flex flex-col items-center gap-4">
        <Ring
          pct={k.deflection_rate}
          centerTop={`${k.deflection_rate.toLocaleString('pt-BR')}%`}
          centerBottom="sem atendente"
        />
        <div className="w-full">
          <div className="mb-1.5 flex h-2 w-full overflow-hidden rounded-full">
            {segs.map((s) => (
              <div
                key={s.label}
                style={{
                  width: `${(s.n / total) * 100}%`,
                  backgroundColor: s.color,
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {segs.map((s) => (
              <span
                key={s.label}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.label}
                <span className="font-mono font-bold text-foreground">
                  {fmtInt(s.n)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Demand-by-hour curve
// ---------------------------------------------------------------------------
function DemandPanel({ overview }: { overview: Overview }) {
  const hours = overview.hour_of_day
  const data = hours.map((h) => h.n)
  const hasData = data.some((v) => v > 0)

  return (
    <Panel
      className="lg:col-span-2"
      title="Demanda por hora do dia"
      subtitle="Mensagens recebidas · horário de Brasília"
    >
      {hasData ? (
        <AreaChart
          data={data}
          height={170}
          xLabels={[
            { at: 0, text: '0h' },
            { at: 6, text: '6h' },
            { at: 12, text: '12h' },
            { at: 18, text: '18h' },
            { at: 23, text: '23h' },
          ]}
          peakLabel={(idx, v) => `${idx}h · ${fmtInt(v)}`}
        />
      ) : (
        <EmptyState>Sem mensagens no período.</EmptyState>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Handoffs by reason
// ---------------------------------------------------------------------------
function ReasonPanel({ overview }: { overview: Overview }) {
  const total = overview.by_reason.reduce((s, r) => s + r.n, 0)
  const rows = overview.by_reason.map((r) => ({
    key: r.reason,
    label: HANDOFF_LABEL[r.reason] ?? r.reason,
    value: r.n,
    color: REASON_COLOR[r.reason],
    sub: total ? `${Math.round((r.n / total) * 100)}%` : undefined,
  }))

  return (
    <Panel title="Handoffs por motivo" subtitle="Por que a IA chamou um humano">
      {rows.length > 0 ? (
        <BarList rows={rows} />
      ) : (
        <EmptyState>Nenhum handoff no período.</EmptyState>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Handoff RATE by unit (the outlier surfacer)
// ---------------------------------------------------------------------------
function UnitPanel({ overview }: { overview: Overview }) {
  const units = overview.by_unit.filter((u) => u.convs > 0)
  const rates = units.map((u) => u.rate)
  const median = rates.length
    ? [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)]
    : 0

  const rows = [...units]
    .sort((a, b) => b.rate - a.rate)
    .map((u) => ({
      key: u.unit_id,
      label: u.name,
      value: u.rate,
      valueText: `${u.rate.toLocaleString('pt-BR')}%`,
      sub: `${u.handoffs}/${u.convs}`,
      color: unitColor(u.unit_id).solid,
      highlight: u.convs >= 20 && median > 0 && u.rate >= median * 2.5,
    }))

  return (
    <Panel
      title="Taxa de handoff por unidade"
      subtitle="% das conversas que escalaram para humano"
    >
      {rows.length > 0 ? (
        <BarList rows={rows} />
      ) : (
        <EmptyState>Sem dados de unidade no período.</EmptyState>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Attendance funnel + SLA
// ---------------------------------------------------------------------------
function FunnelPanel({ attendance }: { attendance: Attendance }) {
  const f = attendance.funnel
  const tta = attendance.sla.time_to_assign_sec
  const handle = attendance.sla.handle_time_sec
  const any = f.queued > 0

  return (
    <Panel
      className="lg:col-span-2"
      title="Funil de atendimento"
      subtitle="Da fila ao encerramento"
    >
      {any ? (
        <div className="flex flex-col gap-4">
          <Funnel
            stages={[
              { label: 'Na fila', value: f.queued, color: '#fbbf24' },
              { label: 'Assumidos', value: f.assigned, color: '#38bdf8' },
              { label: 'Encerrados', value: f.closed, color: LIME },
            ]}
          />
          <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
            <MiniStat
              label="Tempo até assumir"
              value={tta.n > 0 ? fmtDuration(tta.avg) : '—'}
              hint={tta.n > 0 ? `mediana ${fmtDuration(tta.p50)}` : 'aguardando dados'}
            />
            <MiniStat
              label="Tempo de atendimento"
              value={handle.n > 0 ? fmtDuration(handle.avg) : '—'}
              hint={handle.n > 0 ? `mediana ${fmtDuration(handle.p50)}` : 'aguardando dados'}
            />
            <MiniStat
              label="Encerrados"
              value={fmtInt(f.closed)}
              hint={`de ${fmtInt(f.queued)} na fila`}
            />
          </div>
        </div>
      ) : (
        <EmptyState>Nenhum handoff no período.</EmptyState>
      )}
    </Panel>
  )
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-[18px] font-bold tabular-nums text-foreground">
        {value}
      </div>
      {hint && <div className="text-[10.5px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------
function OutcomePanel({ attendance }: { attendance: Attendance }) {
  const total = attendance.outcomes.reduce((s, o) => s + o.n, 0)
  const rows = attendance.outcomes.map((o) => ({
    key: o.outcome,
    label: CLOSE_OUTCOME_LABEL[o.outcome] ?? o.outcome,
    value: o.n,
    color: o.outcome === 'resolvido' ? LIME : '#fbbf24',
    sub: total ? `${Math.round((o.n / total) * 100)}%` : undefined,
  }))

  return (
    <Panel title="Desfechos" subtitle="Resultado dos atendimentos encerrados">
      {rows.length > 0 ? (
        <BarList rows={rows} />
      ) : (
        <EmptyState>
          Popula conforme a equipe encerra atendimentos com desfecho.
        </EmptyState>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Operators leaderboard
// ---------------------------------------------------------------------------
function OperatorsPanel({ attendance }: { attendance: Attendance }) {
  const ops = attendance.operators
  return (
    <Panel title="Operadores" subtitle="Produtividade e qualidade por atendente">
      {ops.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="pb-2 font-semibold">Operador</th>
                <th className="pb-2 text-right font-semibold">Encerrados</th>
                <th className="pb-2 text-right font-semibold">Resolução</th>
                <th className="pb-2 text-right font-semibold">Tempo médio</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => (
                <tr key={o.operator_id} className="border-b border-border/50">
                  <td className="py-2 font-medium text-foreground">
                    {o.name ?? 'Operador'}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {fmtInt(o.closed)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-accent">
                    {o.resolution_rate}%
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {fmtDuration(o.avg_handle_sec)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          Ainda não há atendimentos encerrados. Conforme a equipe atende, o
          ranking de produtividade aparece aqui.
        </EmptyState>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Insights (auto-generated narrative)
// ---------------------------------------------------------------------------
type Insight = { tone: 'good' | 'warn' | 'info'; text: string }

function buildInsights(ov: Overview): Insight[] {
  const out: Insight[] = []
  const k = ov.kpis

  if (k.conversations >= 20) {
    out.push({
      tone: 'good',
      text: `A IA conduziu ${k.deflection_rate.toLocaleString('pt-BR')}% das ${fmtInt(k.conversations)} conversas sem precisar de atendente — só ${fmtInt(k.handoffs)} viraram handoff.`,
    })
  }

  // Unit outlier (gated on min n)
  const units = ov.by_unit.filter((u) => u.convs >= 20)
  if (units.length >= 2) {
    const rates = units.map((u) => u.rate).sort((a, b) => a - b)
    const median = rates[Math.floor(rates.length / 2)] || 0
    const top = [...units].sort((a, b) => b.rate - a.rate)[0]
    if (median > 0 && top.rate >= median * 2.5) {
      out.push({
        tone: 'warn',
        text: `${top.name} escala ${top.rate.toLocaleString('pt-BR')}% das conversas para humano — ${(top.rate / median).toFixed(1)}× a mediana. Vale investigar o que a IA não resolve lá.`,
      })
    }
  }

  // Top reason
  const total = ov.by_reason.reduce((s, r) => s + r.n, 0)
  if (total >= 10) {
    const top = ov.by_reason[0]
    out.push({
      tone: 'info',
      text: `${HANDOFF_LABEL[top.reason] ?? top.reason} é o motivo nº 1 de handoff (${Math.round((top.n / total) * 100)}% dos casos).`,
    })
  }

  // Peak hour
  const peak = ov.hour_of_day.reduce(
    (b, h) => (h.n > b.n ? h : b),
    ov.hour_of_day[0] ?? { hour: 0, n: 0 },
  )
  if (peak && peak.n > 0) {
    out.push({
      tone: 'info',
      text: `Pico de demanda às ${peak.hour}h — dimensione a equipe para o início da tarde.`,
    })
  }

  // Backlog alert
  if (k.backlog_now > 0) {
    out.push({
      tone: 'warn',
      text: `${fmtInt(k.backlog_now)} ${k.backlog_now === 1 ? 'conversa aguarda' : 'conversas aguardam'} atendimento agora, sem operador atribuído.`,
    })
  }

  return out
}

function InsightsPanel({ insights }: { insights: Insight[] }) {
  const toneCls: Record<Insight['tone'], string> = {
    good: 'border-accent/30 bg-accent/[0.06]',
    warn: 'border-amber-500/30 bg-amber-500/[0.06]',
    info: 'border-border bg-card/60',
  }
  const dotCls: Record<Insight['tone'], string> = {
    good: 'bg-accent',
    warn: 'bg-amber-400',
    info: 'bg-sky-400',
  }
  return (
    <Panel
      title="Insights"
      subtitle="Leituras automáticas do período"
      right={<Lightbulb className="size-4 text-accent" />}
    >
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {insights.map((ins, i) => (
          <div
            key={i}
            className={cn(
              'flex items-start gap-2.5 rounded-[11px] border px-3.5 py-3',
              toneCls[ins.tone],
            )}
          >
            <span
              className={cn('mt-1.5 size-2 shrink-0 rounded-full', dotCls[ins.tone])}
            />
            <p className="text-[12.5px] leading-snug text-foreground">
              {ins.text}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1200px] animate-pulse flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-[14px] border border-border bg-card/40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-64 rounded-[16px] border border-border bg-card/40" />
        <div className="h-64 rounded-[16px] border border-border bg-card/40 lg:col-span-2" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-52 rounded-[16px] border border-border bg-card/40" />
        <div className="h-52 rounded-[16px] border border-border bg-card/40" />
      </div>
    </div>
  )
}
