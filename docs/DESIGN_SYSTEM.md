# Design System — Dashboard CDT / 7Bee.AI

> Guia completo para reproduzir o sistema visual deste projeto em outro app.
> Sem nada implícito — copia, cola e funciona.

---

## 0. TL;DR — princípios

1. **Dark base sólido** `#0a0a0f` com **glows radiais verdes** ambientes (não glass, não blur).
2. **Único accent**: lime `#a3e635`. Todo destaque, hover, foco, stripe — usa essa cor.
3. **Duas fontes**: **Outfit** (UI, números grandes — weight 800) e **JetBrains Mono** (códigos, números tabulares, labels uppercase).
4. **Cards minimalistas** com stripe de 2px no topo + lift de 2px no hover. Sem sombra heavy.
5. **Hierarquia por contraste**: foreground `#e8e8ed`, muted `#6b6b80`. Bordas finas (`#1e1e2e`).
6. Vermelho `#ff4757` (destructive) só para alerta/negativo; amarelo `#fbbf24` só para warning Meta.
7. Tudo respeita o **`.dark`** class no `<html>` — o projeto é dark-only (não há light mode real, ambos `:root` e `.dark` têm os mesmos valores).

---

## 1. Stack mínima necessária

| Item | Versão | Para quê |
|---|---|---|
| **Tailwind CSS** | 3.x | Utilities + tokens |
| **tailwindcss-animate** | latest | Animações shadcn |
| **shadcn/ui** | qualquer | Base de componentes (button, card, table, dialog, popover, dropdown, tabs, skeleton, calendar, sheet, tooltip, badge…) |
| **Outfit** + **JetBrains Mono** | Google Fonts | Tipografia |
| **lucide-react** | latest | Ícones (TrendingUp/Down, ShieldAlert/Check, Flag, CalendarIcon, etc.) |
| **date-fns** + `date-fns/locale/ptBR` | latest | Formatação `ptBR` |
| **recharts** | latest | Charts |

O projeto usa Vite + React + TypeScript, mas o design system funciona em qualquer stack que suporte Tailwind.

---

## 2. Setup — 4 arquivos

### 2.1 `index.html`

Ponto crítico: **classe `dark` no `<html>`**.

```html
<!DOCTYPE html>
<html lang="pt-BR" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Seu App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 2.2 `tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}", "./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        chart: {
          bg: "hsl(var(--chart-bg))",
          foreground: "hsl(var(--chart-foreground))",
          grid: "hsl(var(--chart-grid))",
          "tooltip-bg": "hsl(var(--chart-tooltip-bg))",
          "tooltip-border": "hsl(var(--chart-tooltip-border))",
        },
        // Aliases legados — opcionais
        dashboard: {
          lime: "hsl(var(--dashboard-lime))",
          gold: "hsl(var(--dashboard-gold))",
          green: "hsl(var(--dashboard-green))",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

### 2.3 `src/index.css` (completo — esse arquivo é o coração do design system)

```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 240 22% 5%;          /* #0a0a0f */
    --foreground: 240 14% 92%;         /* #e8e8ed */

    --card: 240 18% 9%;                /* #12121a */
    --card-foreground: 240 14% 92%;

    --popover: 240 18% 9%;
    --popover-foreground: 240 14% 92%;

    --primary: 83 79% 60%;             /* #a3e635 lime */
    --primary-foreground: 240 22% 5%;

    --secondary: 240 21% 13%;          /* #1a1a26 */
    --secondary-foreground: 240 14% 92%;

    --muted: 240 21% 13%;
    --muted-foreground: 240 9% 46%;    /* #6b6b80 */

    --accent: 83 79% 60%;              /* #a3e635 */
    --accent-foreground: 240 22% 5%;

    --destructive: 4 100% 65%;         /* #ff4757 */
    --destructive-foreground: 0 0% 100%;

    --border: 240 21% 15%;             /* #1e1e2e */
    --input: 240 21% 15%;
    --ring: 83 79% 60%;

    --radius: 0.875rem;                /* 14px */

    /* Tokens auxiliares (chart, legado) */
    --dashboard-lime: 83 79% 60%;
    --dashboard-gold: 83 79% 60%;
    --dashboard-green: 240 4% 65%;     /* cinza neutro */
    --chart-bg: 240 22% 5%;
    --chart-foreground: 240 14% 92%;
    --chart-grid: 240 21% 15%;
    --chart-tooltip-bg: 240 22% 5%;
    --chart-tooltip-border: 83 79% 60%;
  }

  /* Dark mode = root (app é dark-only) */
  .dark { /* duplicar todas as variáveis acima */ }

  * { @apply border-border; }

  body {
    @apply bg-background text-foreground antialiased;
    font-family: 'Outfit', system-ui, -apple-system, sans-serif;
    font-feature-settings: "ss01", "cv11";
    position: relative;
    overflow-x: hidden;
  }

  /* === Ambient gradient — glows radiais verdes (fundo do app) === */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    background:
      radial-gradient(ellipse 90% 60% at 15% 0%,
        hsl(var(--accent) / 0.18) 0%, transparent 60%),
      radial-gradient(ellipse 80% 50% at 85% 100%,
        hsl(var(--accent) / 0.14) 0%, transparent 55%),
      radial-gradient(ellipse 70% 50% at 50% 50%,
        hsl(var(--accent) / 0.08) 0%, transparent 65%);
    pointer-events: none;
    z-index: 0;
  }
  #root { position: relative; z-index: 1; }
}

/* ========== Utility classes ========== */

/* Glow localizado no header */
.header-glow { position: relative; overflow: hidden; }
.header-glow::before {
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 55% 140% at 12% 50%, hsl(var(--accent) / 0.12) 0%, transparent 65%),
    radial-gradient(ellipse 40% 120% at 88% 50%, hsl(var(--accent) / 0.06) 0%, transparent 70%);
  pointer-events: none; z-index: 0;
}

/* Linha elegante (divider) — fade nas pontas + accent glow no centro */
.elegant-divider { position: relative; border-bottom: none !important; }
.elegant-divider::after {
  content: "";
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(to right,
    transparent 0%,
    hsl(var(--border)) 15%,
    hsl(var(--accent) / 0.35) 50%,
    hsl(var(--border)) 85%,
    transparent 100%);
  pointer-events: none;
}

/* Gradient text — branco → muted */
.gradient-text {
  background: linear-gradient(135deg, hsl(var(--foreground)) 0%, hsl(var(--muted-foreground)) 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}

/* ========== KPI CARD — padrão central de cartões de métrica ========== */
@keyframes fade-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.kpi-card {
  position: relative; overflow: hidden;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  transition: border-color 0.3s, transform 0.2s;
  animation: fade-slide-up 0.5s ease both;
}
.kpi-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(to right, transparent,
    var(--kpi-accent, hsl(var(--accent))), transparent);
  opacity: 0.6; pointer-events: none;
}
.kpi-card:hover {
  border-color: color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 50%, transparent);
  transform: translateY(-2px);
}
.kpi-card.is-negative::before {
  background: linear-gradient(to right, transparent, hsl(var(--destructive)), transparent);
}
.kpi-card.is-negative:hover { border-color: hsl(var(--destructive) / 0.5); }

/* Highlight — destaque para o KPI principal (gradient radial + glow interno/externo) */
.kpi-card.is-highlight,
.chart-card.is-highlight {
  background: radial-gradient(ellipse at top right,
    color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 16%, transparent) 0%,
    hsl(var(--card)) 70%);
  border-color: color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 35%, transparent);
  box-shadow:
    inset 0 0 31px color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 17%, transparent),
    0 0 24px color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 26%, transparent);
}
.kpi-card.is-highlight::before,
.chart-card.is-highlight::before { opacity: 1; }
.kpi-card.is-highlight:hover,
.chart-card.is-highlight:hover {
  border-color: color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 78%, transparent);
  box-shadow:
    inset 0 0 36px color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 23%, transparent),
    0 0 31px color-mix(in srgb, var(--kpi-accent, hsl(var(--accent))) 36%, transparent);
}

/* ========== CHART CARD — para gráficos/cards maiores ========== */
.chart-card, .neon-card {
  position: relative; overflow: hidden;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  transition: border-color 0.2s ease;
}
.chart-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(to right, transparent,
    var(--kpi-accent, hsl(var(--accent))), transparent);
  opacity: 0.6; pointer-events: none;
}
.chart-card:hover, .neon-card:hover { border-color: hsl(var(--accent) / 0.4); }

/* ========== Animações de alerta ========== */
@keyframes live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.85); }
}
.live-dot { animation: live-pulse 2s ease-in-out infinite; }

@keyframes health-alert-pulse {
  0%, 100% {
    border-color: hsl(var(--destructive) / 0.65);
    background: hsl(var(--destructive) / 0.16);
    box-shadow:
      inset 0 0 34px hsl(var(--destructive) / 0.34),
      0 0 22px hsl(var(--destructive) / 0.28);
  }
  50% {
    border-color: hsl(var(--destructive) / 0.22);
    background: hsl(var(--destructive) / 0.04);
    box-shadow:
      inset 0 0 12px hsl(var(--destructive) / 0.07),
      0 0 6px hsl(var(--destructive) / 0.05);
  }
}
.health-alert-pulse { animation: health-alert-pulse 2.4s ease-in-out infinite; }

/* Bee bob (mascote opcional — espelhado horizontalmente, sobe e desce) */
@keyframes bee-bob {
  0%, 100% { transform: scaleX(-1) translateY(0); }
  50%      { transform: scaleX(-1) translateY(-6px) rotate(2deg); }
}
.bee-bob {
  animation: bee-bob 1.6s ease-in-out infinite;
  transform: scaleX(-1); transform-origin: center;
}

/* Recharts: limpa hover roxo padrão */
.recharts-surface { overflow: visible; }
.recharts-tooltip-cursor { fill: transparent !important; stroke: none !important; }
.recharts-cell:hover, .recharts-active-shape,
.recharts-bar:hover .recharts-rectangle,
.recharts-bar:hover .recharts-cell {
  fill-opacity: 1 !important; stroke: none !important;
}

/* Util: números monoespaçados com kerning negativo */
.font-mono-num {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
```

### 2.4 `src/main.tsx` — entry

Garanta que `import "./index.css"` é a **primeira coisa** importada antes do `<App />`.

---

## 3. Paleta de cores — referência rápida

| Token | HSL | HEX | Uso |
|---|---|---|---|
| `--background` | `240 22% 5%` | `#0a0a0f` | Fundo base do app |
| `--foreground` | `240 14% 92%` | `#e8e8ed` | Texto primário |
| `--card` | `240 18% 9%` | `#12121a` | Fundo de cards |
| `--secondary` | `240 21% 13%` | `#1a1a26` | Hover de superfície, chips |
| `--muted` | `240 21% 13%` | `#1a1a26` | Mesma da secondary |
| `--muted-foreground` | `240 9% 46%` | `#6b6b80` | Texto secundário/labels |
| `--border` | `240 21% 15%` | `#1e1e2e` | Bordas finas |
| `--accent` / `--primary` / `--ring` | `83 79% 60%` | `#a3e635` | **Único accent** — lime |
| `--destructive` | `4 100% 65%` | `#ff4757` | Negativo/erro |

### Cores semânticas hardcoded (Meta health pattern)

Estas são usadas como hex inline para tons específicos do WhatsApp Business (não vão como CSS var porque são fixas Meta):

| Cor | HEX | Uso |
|---|---|---|
| **Lime/GREEN** | `#a3e635` | Saúde OK, valor positivo |
| **Amber/YELLOW** | `#fbbf24` | Warning, atenção |
| **Red/RED** | `#f87171` | Crítico, falha |
| **Orange** | `#fb923c` | Stale/desatualizado |
| **Cyan** | `#38bdf8` | Auth (Meta authentication category) |
| **Purple** | `#a78bfa` | Service |
| **Gold** | `#fbbf24` (mesmo amber) | Mark "Agora" em chart |
| **Neutral gray** | `#6b7280` | Tom neutro de fallback |

Exemplo de mapa típico (cobre os 4 ratings Meta):

```ts
const TONE_HEX: Record<string, string> = {
  green:   "#a3e635",
  yellow:  "#fbbf24",
  red:     "#f87171",
  neutral: "#6b7280",
};
```

---

## 4. Tipografia

### Fontes

- **Outfit** (300, 400, 500, 600, 700, 800) — UI, body, números grandes (`font-extrabold` = 800)
- **JetBrains Mono** (400, 500, 600) — números tabulares, códigos, labels uppercase, IDs

### Escala recomendada

| Uso | Classes | Exemplo |
|---|---|---|
| Título da página | `gradient-text font-black text-2xl sm:text-3xl tracking-tight leading-none` | "Dashboard CDT — Cobrança AI" |
| Section title | `text-base font-semibold uppercase tracking-widest text-foreground` | "PERFORMANCE DE ENVIO" |
| Sub-section divider | `font-mono text-[11px] font-semibold uppercase tracking-[1.5px]` | "Resumo de Hoje" |
| KPI label (topo do card) | `font-mono text-[8px] font-medium uppercase text-muted-foreground` + `letter-spacing: 1.5px` | "MENSAGENS ENTREGUES" |
| KPI value | `font-sans font-extrabold leading-none tabular-nums` + `fontSize: clamp(0.7rem, 0.9vw + 0.2rem, 1.2rem)` | "14.956" |
| KPI subtitle/footer | `font-mono text-[11px] text-muted-foreground` | "base 100%" |
| Tag/chip | `font-mono text-[10px] font-medium uppercase tracking-wide` | "Tier 1K" |
| Texto comum | `text-sm text-foreground` | "Caraguatatuba - SP" |
| Texto muted | `text-xs text-muted-foreground` | "atualizado há 2min" |
| ID/código | `font-mono text-[11px] text-muted-foreground` | phone IDs |
| Clock/data | `font-mono-num text-xs sm:text-sm tracking-[0.12em] tabular-nums` | "12:34:56 • quinta..." |

**Regra de ouro**: número grande → Outfit weight 800. Número pequeno tabular/ID → JetBrains Mono. Label uppercase → JetBrains Mono.

---

## 5. Espaçamento & Layout

### Container padrão do app

```tsx
<div className="mx-auto w-full max-w-[1080px] px-4 sm:px-7 py-5 flex flex-col gap-5">
```

- **Largura máxima:** `1080px` (não `1280px`/`1440px` do shadcn default)
- **Padding horizontal:** `px-4 sm:px-7` (16px → 28px)
- **Vertical:** `py-5` (20px)
- **Gap entre seções:** `gap-5` (20px)

### Gaps internos

- Entre cards do mesmo grupo: `gap-3` (12px) — `gap-4` (16px) em layouts maiores
- Entre seções: `space-y-6` no container principal (24px)
- Entre sub-rows: `space-y-3` ou `space-y-4`

### Grids de KPI

```tsx
// 4 cards lado a lado (KPIs do topo)
<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

// 3 cards
<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">

// Cards de detalhe (mais largos)
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
```

### Border-radius

- `--radius: 0.875rem` (14px) — `rounded-lg` em Tailwind
- Variantes: `md = 12px`, `sm = 10px`
- Cards usam **`border-radius: 14px`** direto (não classe Tailwind, está no `.kpi-card`)
- Cards do tipo `chart-card` usam classe Tailwind `rounded-2xl` (16px)

---

## 6. Componentes — anatomia completa

### 6.1 KpiCard

O componente central do dashboard. **Stripe accent de 2px no topo**, **lift de 2px no hover**, **animação fade-slide-up** ao entrar.

```tsx
interface KpiCardProps {
  title: string;
  value: string | number;
  percentage?: number;
  showProgress?: boolean;
  valueColor?: string;
  valueColorHex?: string;    // hex/hsl para o value
  accentColorHex?: string;   // hex que substitui o accent do stripe + hover
  isNegative?: boolean;
  highlight?: boolean;       // gradient radial + glow forte
  progressBarColor?: string;
  subtitle?: string;
  leadingLabel?: string;
  compact?: boolean;
  valueSize?: string;
}
```

Estrutura interna (HTML real):

```tsx
<div
  className={cn(
    "kpi-card h-full flex flex-col",
    isNegative && "is-negative",
    highlight && "is-highlight",
    compact ? "px-3 py-2" : "px-4 py-3.5"
  )}
  style={accentColorHex ? { "--kpi-accent": accentColorHex } as React.CSSProperties : undefined}
>
  {/* Label — JetBrains Mono 8px uppercase */}
  <span
    className="font-mono text-[8px] font-medium uppercase text-muted-foreground block leading-tight min-h-[20px]"
    style={{ letterSpacing: "1.5px" }}
  >
    {title}
  </span>

  {/* Value — Outfit weight 800, clamp pra escalar com viewport */}
  <div className="mt-2 flex flex-col gap-1.5">
    <span
      className="font-sans font-extrabold leading-none whitespace-nowrap tabular-nums"
      style={{
        fontSize: "clamp(0.7rem, 0.9vw + 0.2rem, 1.2rem)",
        color: valueColorHex,
      }}
    >
      {value}
    </span>
    {/* progress bar, subtitle, leadingLabel ... */}
  </div>
</div>
```

**Padrões de uso:**

```tsx
// KPI normal (verde lime)
<KpiCard title="Mensagens entregues" value="14.956" accentColorHex="#a3e635" />

// Highlight (KPI principal — gradient radial + glow)
<KpiCard title="Valor cobrado hoje" value="R$ 8.116,20" highlight accentColorHex="#a3e635" />

// Negativo (stripe vermelho)
<KpiCard title="Estornos" value={5} isNegative />

// Cor custom (warning amarelo)
<KpiCard title="YELLOW" value={3} valueColorHex="#fbbf24" accentColorHex="#fbbf24" />

// Card pulsando vermelho (alerta crítico)
<div className="kpi-card health-alert-pulse" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
  …
</div>
```

### 6.2 chart-card

Container maior para gráficos/tabelas. Mesma stripe, sem o lift hover do KpiCard.

```tsx
<Card className="chart-card rounded-2xl p-4 sm:p-6">
  {/* gráfico ou tabela */}
</Card>
```

`Card` aqui é do shadcn — `chart-card` é só a classe CSS que adiciona stripe + transition.

### 6.3 SectionHeader

```tsx
interface SectionHeaderProps {
  title: string;
  count?: number;
  hint?: string;
}

export const SectionHeader = ({ title, count, hint }: SectionHeaderProps) => (
  <div className="flex items-center gap-3">
    <div className="h-5 w-1 rounded-full bg-accent" />
    <h2 className="text-base font-semibold uppercase tracking-widest text-foreground">
      {title}
    </h2>
    {count !== undefined && (
      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {count}
      </span>
    )}
    {hint && <span className="text-xs text-muted-foreground normal-case">{hint}</span>}
  </div>
);
```

Características:
- **Barra accent de 4px à esquerda** (`h-5 w-1 rounded-full bg-accent`)
- Título uppercase `tracking-widest`
- Chip de count opcional (background `secondary`)
- Hint inline (texto pequeno muted)

### 6.4 RowDivider

Sub-divisor com texto à esquerda e linha que fade ao final:

```tsx
interface RowDividerProps {
  label: string;
  color?: string;  // default: "#fff176" (amarelo claro)
}

export const RowDivider = ({ label, color = "#fff176" }: RowDividerProps) => (
  <div className="flex items-center gap-3">
    <span className="whitespace-nowrap font-mono text-[11px] font-semibold uppercase tracking-[1.5px] text-foreground">
      {label}
    </span>
    <div
      className="h-[2px] flex-1 rounded-full"
      style={{
        background: `linear-gradient(to right, ${color} 0%, ${color} 20%, transparent 95%)`,
      }}
    />
  </div>
);
```

Cores típicas: `hsl(var(--accent))` (lime padrão), `"#f87171"` (alerta vermelho), `"#fff176"` (amarelo "HOJE").

### 6.5 HealthBadge — chips com tom semântico

```tsx
type Tone = "green" | "yellow" | "red" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  green:   "bg-lime-500/15 text-lime-400 border-lime-500/30",
  yellow:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  red:     "bg-red-500/15 text-red-400 border-red-500/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

export const toneFor = (value: string | null | undefined): Tone => {
  const v = (value ?? "").toUpperCase();
  if (["GREEN", "CONNECTED", "APPROVED", "AVAILABLE", "VERIFIED"].includes(v)) return "green";
  if (["YELLOW", "PENDING", "PENDING_REVIEW", "LIMITED", "FLAGGED", "PAUSED"].includes(v)) return "yellow";
  if (["RED", "DISCONNECTED", "REJECTED", "NOT_AVAILABLE", "BLOCKED", "FAILED",
       "RESTRICTED", "DISABLED", "LIMIT_EXCEEDED"].includes(v)) return "red";
  return "neutral";
};

export const HealthBadge = ({ value, tone, className }) => {
  const resolved = tone ?? toneFor(value);
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
      TONE_CLASSES[resolved],
      className
    )}>
      {value ?? "—"}
    </span>
  );
};
```

### 6.6 Chip pattern (genérico — Tier, opt-out, tags)

```tsx
<span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
  Tier 1K
</span>
```

Variantes coloridas (red/amber/lime):

```tsx
// Red alert chip
<span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-400">
  <TrendingDown className="h-3 w-3" />
  Piorou
</span>

// Lime (positivo)
<span className="inline-flex items-center gap-1 rounded-full border border-lime-500/30 bg-lime-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-lime-400">
  <TrendingUp className="h-3 w-3" />
  Melhorou
</span>

// Amber (warning)
<span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">
  expira 25/05 18:00
</span>

// Orange (stale)
<span className="inline-flex items-center rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-400">
  Desatualizado
</span>
```

### 6.7 Header da página (brand + período + nav)

Padrão completo (ver `DashboardHeader.tsx`):

```tsx
<header className="bg-background/80 backdrop-blur-sm elegant-divider header-glow">
  <div className="relative z-10 mx-auto w-full max-w-[1080px] px-4 sm:px-7 py-5 flex flex-col gap-5">
    {/* Top row: brand + filters + user */}
    <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">

      {/* Brand */}
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2.5">
          <img src="/bee.gif" className="bee-bob h-7 w-7 select-none shrink-0" />
          <span className="text-[10px] font-semibold uppercase text-accent tracking-[0.25em]">
            7Bee.AI · Live Dashboard
          </span>
        </div>
        <h1 className="gradient-text font-black text-2xl sm:text-3xl tracking-tight leading-none m-0">
          Dashboard CDT — Cobrança AI
        </h1>
        <span className="font-mono-num text-xs sm:text-sm text-muted-foreground tracking-[0.12em] tabular-nums">
          {/* clock */}
        </span>
      </div>

      {/* Filtros (period + selector + user) */}
      <div className="flex flex-wrap items-center gap-3">
        {/* … */}
      </div>
    </div>

    {/* Navigation */}
    <nav className="flex items-center justify-end gap-1 flex-wrap">
      {/* botões: bg-accent text-accent-foreground se ativo, senão text-muted-foreground hover:bg-secondary */}
    </nav>
  </div>
</header>
```

Padrão de botão nav:

```tsx
<button className={cn(
  "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all",
  isActive
    ? "bg-accent text-accent-foreground shadow-sm"
    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
)}>
  {label}
</button>
```

---

## 7. Tabelas (shadcn `Table` + padrões)

```tsx
<Card className="chart-card rounded-2xl p-4 sm:p-6">
  <div className="overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Unidade</TableHead>
          <TableHead className="text-right text-lime-400">Aprovados</TableHead>
          <TableHead className="text-right text-amber-400">Pendentes</TableHead>
          <TableHead className="text-right text-red-400">Rejeitados</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right text-lime-400">{r.approved}</TableCell>
            <TableCell className="text-right text-amber-400">{r.pending}</TableCell>
            <TableCell className="text-right text-red-400">{r.rejected}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
</Card>
```

**Convenções:**
- Wrapping em `<div className="overflow-x-auto">` (mobile-safe)
- Cabeçalhos coloridos para indicar tom da coluna
- Valores à direita (`text-right`)
- Coluna "principal" do row em `font-medium`
- IDs e timestamps em `font-mono text-xs text-muted-foreground`

---

## 8. Recharts (gráficos)

Tooltip custom obrigatório (substituindo o default branco horroroso):

```tsx
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  return (
    <div className="bg-chart-tooltip-bg border border-chart-tooltip-border p-3 rounded-lg shadow-xl">
      <p className="font-medium text-chart-foreground">{label}</p>
      <p className="text-dashboard-teal">Disparos: {data?.disparos ?? 0}</p>
      <p className="text-dashboard-lime font-medium mt-1">
        Recebimentos: {data?.recebimentos ?? 0}
      </p>
    </div>
  );
};
```

Gradient fills para Area:

```tsx
<defs>
  <linearGradient id="disparosGradient" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%"  stopColor="hsl(var(--dashboard-green))" stopOpacity={0.3} />
    <stop offset="95%" stopColor="hsl(var(--dashboard-green))" stopOpacity={0.02} />
  </linearGradient>
</defs>
```

Cartesian grid + eixos:

```tsx
<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
<XAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--chart-foreground))' }} />
<YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--chart-foreground))' }} />
```

ReferenceLine "Agora" (linha de marcador):

```tsx
<ReferenceLine
  x={currentHourLabel}
  stroke="hsl(var(--dashboard-gold))"
  strokeDasharray="4 4"
  strokeWidth={2}
  label={{ value: "Agora", position: "top", fill: "hsl(var(--dashboard-gold))", fontSize: 10 }}
/>
```

---

## 9. Animações & micro-interações

| Animação | Onde aplicar | CSS class |
|---|---|---|
| **fade-slide-up** | Em todo card que entra (KpiCard automático) | `.kpi-card` já tem |
| **live-pulse** | Bolinha "LIVE" no topo, indicador de dado vivo | `.live-dot` |
| **health-alert-pulse** | Card de alerta crítico (RED) | `.health-alert-pulse` |
| **bee-bob** | Mascote 7Bee no header | `.bee-bob` |
| **KPI hover lift** | Já no `.kpi-card:hover` | automático |
| Stripe `is-highlight` | KPI principal (mês, total, hoje) | adicione `is-highlight` |

---

## 10. Padrões de cor por contexto

### Categorias de cobrança / status
```ts
const CATEGORY_HEX = {
  MARKETING:      "#fbbf24",  // amber
  UTILITY:        "#a3e635",  // lime
  AUTHENTICATION: "#38bdf8",  // cyan
  SERVICE:        "#a78bfa",  // purple
};
```

### Indicadores de delivery rate
```ts
const deliveredColor = (v) => {
  if (v === null || v === undefined) return "text-muted-foreground";
  if (v >= 95) return "text-lime-400";
  if (v >= 85) return "text-amber-400";
  return "text-red-400";
};
```

### Barras de ranking (por volume)
```ts
const barColor = (count: number) => {
  if (count <= 0)   return "#f87171"; // sem volume = vermelho
  if (count <= 100) return "#fb923c"; // baixo = laranja
  if (count <= 500) return "#fbbf24"; // médio = amarelo
  return "#a3e635";                   // alto = lime
};
```

---

## 11. Utilitários comuns

### `cn` — combine classes

Padrão shadcn em `src/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

### Formatação de números (pt-BR)

```ts
const n = 14956;
n.toLocaleString("pt-BR");      // "14.956"

const v = 8116.20;
v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); // "R$ 8.116,20"
```

### Formatação de tempo (date-fns)

```ts
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

format(d, "dd/MM/yy HH:mm");
formatDistanceToNow(d, { addSuffix: true, locale: ptBR }); // "há 3 minutos"
```

### Helper de duração (segundos → "1h 03m" / "2m 10s" / "45s")

```ts
const fmtDuration = (secs: number | null) => {
  if (secs == null) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
};
```

### Helper de %

```ts
const fmtPct = (v: number | null) =>
  v == null ? "—" : `${v.toFixed(1)}%`;
```

---

## 12. Estados vazios / loading / erro

**Loading skeleton:**
```tsx
<Skeleton className="h-24" />     // cards
<Skeleton className="h-48 w-full" /> // tabela/gráfico
```

**Empty state:**
```tsx
<p className="text-sm text-muted-foreground">Nenhum registro encontrado.</p>
```

**Estado saudável (sem alertas):**
```tsx
<div className="kpi-card flex items-center gap-3 px-4 py-4" style={{ "--kpi-accent": "#a3e635" }}>
  <ShieldCheck className="h-6 w-6 shrink-0 text-lime-400" />
  <div>
    <p className="text-sm font-semibold text-foreground">Nenhuma violação registrada</p>
    <p className="text-xs text-muted-foreground">Todas as contas estão sem restrições.</p>
  </div>
</div>
```

**Erro:**
```tsx
{error && <p className="text-sm text-destructive">{error}</p>}
```

---

## 13. Acessibilidade & boas práticas

- Use `aria-hidden="true"` em ícones puramente decorativos (ex.: gif do bee).
- Botões sempre com texto visível (ou `aria-label` se for só ícone).
- Foco do shadcn já é configurado pelo `--ring` (lime).
- Contraste: `foreground` em `background` passa WCAG AA. `muted-foreground` é deliberadamente baixo — use só para metadado.

---

## 14. Checklist para iniciar outro projeto

1. ✅ Adicionar **`class="dark"`** no `<html>` do `index.html`
2. ✅ Copiar `tailwind.config.ts` da seção 2.2
3. ✅ Copiar `src/index.css` da seção 2.3 (inclui import de fontes)
4. ✅ Instalar shadcn/ui + tailwindcss-animate + lucide-react + date-fns
5. ✅ Criar `src/lib/utils.ts` com a função `cn`
6. ✅ Copiar componentes: `KpiCard.tsx`, `SectionHeader.tsx`, `RowDivider.tsx`, `HealthBadge.tsx`
7. ✅ Aplicar o container padrão `max-w-[1080px]` nos layouts
8. ✅ Usar **Outfit** para texto/números e **JetBrains Mono** para labels/IDs
9. ✅ Toda métrica destaque → `<KpiCard highlight />`
10. ✅ Toda seção começa com `<SectionHeader title="..." />`
11. ✅ Tabelas dentro de `<Card className="chart-card rounded-2xl p-4 sm:p-6">`
12. ✅ Recharts com tooltip custom + cores via `hsl(var(--...))` ou hex da paleta

---

## 15. O que NÃO fazer

- ❌ Glassmorphism / `backdrop-filter: blur(...)` pesado em cards.
- ❌ Cores fora da paleta (não invente outro lime/verde, use `#a3e635`).
- ❌ Box-shadow heavy default — use só no `is-highlight`.
- ❌ Mudar o `--radius` por componente — herda do token (14px).
- ❌ Usar `bg-white text-black` ou similar — tudo via tokens.
- ❌ Misturar light mode parcialmente — o app é dark-only.
- ❌ Esquecer o **stripe accent de 2px no topo** dos cards — é a assinatura visual.
- ❌ Esquecer a **classe `dark`** no `<html>` — sem ela, os tokens não aplicam.

---

## 16. Arquivos-fonte de referência neste projeto

| Arquivo | O que tem |
|---|---|
| `tailwind.config.ts` | Tokens Tailwind |
| `src/index.css` | Variáveis CSS + classes utilitárias + animações |
| `src/components/KpiCard.tsx` | KpiCard completo |
| `src/components/health/SectionHeader.tsx` | Section header |
| `src/components/health/RowDivider.tsx` | Sub-divisor |
| `src/components/health/HealthBadge.tsx` | Badges semânticos |
| `src/components/DashboardHeader.tsx` | Header completo (brand + filtros + nav) |
| `src/components/DisparosHorarioChart.tsx` | Recharts AreaChart com gradients + tooltip + ReferenceLine |
| `src/lib/utils.ts` | `cn()` |
| `src/lib/unitName.ts` | Formatação canônica de nomes (exemplo de helper de domínio) |

---

*Documento gerado a partir do código real do projeto Dashboard CDT — Cobrança AI (`feat/visual-refresh-7bee`). Atualizar este arquivo quando o sistema visual evoluir.*
