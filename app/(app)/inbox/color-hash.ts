/**
 * Deterministic color hashing for inbox visual cues.
 *
 * Two distinct palettes are exposed:
 *   - UNIT_PALETTE: ~13 strong colors for unit badges (high signal).
 *     Skips the lime accent band (~70-100°) so unit chips never
 *     read as "selected".
 *   - CONTACT_PALETTE: 10 muted gradient pairs for contact avatars
 *     (soft signal — the unit badge is the loud channel).
 *
 * Hashing is FNV-1a 32-bit over the input string. Stable across
 * sessions: same id always lands on the same color.
 */

function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Unit palette — 13 distinct hues outside the lime band (70-100°).
// Saturation kept moderate (45-58%) so badges read as identity, not as state.
// Foreground is the badge text color; bg/border use the same hue at low alpha.
// ---------------------------------------------------------------------------
export type UnitColor = {
  /** Tailwind-compatible inline color for chip background (low alpha). */
  bg: string
  /** Border color (slightly stronger alpha). */
  border: string
  /** Foreground text color (readable on dark bg). */
  fg: string
  /** Pure hue (no alpha) — used for thin accent slivers. */
  solid: string
}

const UNIT_PALETTE: UnitColor[] = [
  // sky
  { bg: 'hsl(205 70% 55% / 0.14)', border: 'hsl(205 70% 55% / 0.35)', fg: 'hsl(205 80% 70%)', solid: 'hsl(205 70% 55%)' },
  // rose
  { bg: 'hsl(345 65% 58% / 0.14)', border: 'hsl(345 65% 58% / 0.35)', fg: 'hsl(345 80% 72%)', solid: 'hsl(345 65% 58%)' },
  // violet
  { bg: 'hsl(265 55% 60% / 0.14)', border: 'hsl(265 55% 60% / 0.35)', fg: 'hsl(265 75% 75%)', solid: 'hsl(265 55% 60%)' },
  // amber-orange (warmer than handoff amber)
  { bg: 'hsl(30 70% 55% / 0.14)',  border: 'hsl(30 70% 55% / 0.35)',  fg: 'hsl(30 85% 68%)',  solid: 'hsl(30 70% 55%)'  },
  // teal
  { bg: 'hsl(175 50% 50% / 0.14)', border: 'hsl(175 50% 50% / 0.35)', fg: 'hsl(175 65% 65%)', solid: 'hsl(175 50% 50%)' },
  // pink
  { bg: 'hsl(320 55% 60% / 0.14)', border: 'hsl(320 55% 60% / 0.35)', fg: 'hsl(320 75% 75%)', solid: 'hsl(320 55% 60%)' },
  // indigo
  { bg: 'hsl(230 55% 60% / 0.14)', border: 'hsl(230 55% 60% / 0.35)', fg: 'hsl(230 75% 75%)', solid: 'hsl(230 55% 60%)' },
  // crimson
  { bg: 'hsl(355 55% 55% / 0.14)', border: 'hsl(355 55% 55% / 0.35)', fg: 'hsl(355 75% 70%)', solid: 'hsl(355 55% 55%)' },
  // cyan
  { bg: 'hsl(190 60% 50% / 0.14)', border: 'hsl(190 60% 50% / 0.35)', fg: 'hsl(190 75% 65%)', solid: 'hsl(190 60% 50%)' },
  // magenta
  { bg: 'hsl(295 50% 60% / 0.14)', border: 'hsl(295 50% 60% / 0.35)', fg: 'hsl(295 70% 75%)', solid: 'hsl(295 50% 60%)' },
  // copper
  { bg: 'hsl(15 60% 55% / 0.14)',  border: 'hsl(15 60% 55% / 0.35)',  fg: 'hsl(15 80% 70%)',  solid: 'hsl(15 60% 55%)'  },
  // ocean
  { bg: 'hsl(215 60% 55% / 0.14)', border: 'hsl(215 60% 55% / 0.35)', fg: 'hsl(215 75% 72%)', solid: 'hsl(215 60% 55%)' },
  // mauve
  { bg: 'hsl(280 40% 55% / 0.14)', border: 'hsl(280 40% 55% / 0.35)', fg: 'hsl(280 60% 75%)', solid: 'hsl(280 40% 55%)' },
]

export function unitColor(unitId: string): UnitColor {
  const idx = fnv1a(unitId) % UNIT_PALETTE.length
  return UNIT_PALETTE[idx]
}

// ---------------------------------------------------------------------------
// Contact avatar palette — 10 soft gradients. Lower contrast than units;
// adds personality without competing with the unit badge.
// ---------------------------------------------------------------------------
export type AvatarGradient = {
  from: string
  to: string
  fg: string
}

const CONTACT_PALETTE: AvatarGradient[] = [
  { from: 'hsl(210 35% 28%)', to: 'hsl(210 45% 18%)', fg: 'hsl(210 60% 80%)' },
  { from: 'hsl(345 30% 28%)', to: 'hsl(345 40% 18%)', fg: 'hsl(345 60% 82%)' },
  { from: 'hsl(265 28% 28%)', to: 'hsl(265 38% 18%)', fg: 'hsl(265 55% 82%)' },
  { from: 'hsl(30 32% 28%)',  to: 'hsl(30 42% 18%)',  fg: 'hsl(30 65% 80%)'  },
  { from: 'hsl(175 25% 26%)', to: 'hsl(175 35% 16%)', fg: 'hsl(175 50% 78%)' },
  { from: 'hsl(320 28% 28%)', to: 'hsl(320 38% 18%)', fg: 'hsl(320 55% 82%)' },
  { from: 'hsl(230 28% 28%)', to: 'hsl(230 38% 18%)', fg: 'hsl(230 60% 82%)' },
  { from: 'hsl(15 30% 28%)',  to: 'hsl(15 40% 18%)',  fg: 'hsl(15 65% 80%)'  },
  { from: 'hsl(190 30% 26%)', to: 'hsl(190 40% 16%)', fg: 'hsl(190 60% 78%)' },
  { from: 'hsl(295 25% 28%)', to: 'hsl(295 35% 18%)', fg: 'hsl(295 50% 82%)' },
]

export function avatarGradient(seed: string): AvatarGradient {
  const idx = fnv1a(seed) % CONTACT_PALETTE.length
  return CONTACT_PALETTE[idx]
}
