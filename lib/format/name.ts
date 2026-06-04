/**
 * Person-name formatting.
 *
 * The validated CRM name (clientes_cobranca_dashboard.name) arrives in ALL
 * CAPS and as a full legal name, e.g. "BEATRIZ APARECIDA DOS SANTOS INABA".
 * For display we show first + last name in Title Case → "Beatriz Inaba".
 * Connectors (de/da/dos/…) are kept lowercase and skipped when they would be
 * the trailing token.
 */

const CONNECTORS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'di',
  'du',
  'del',
  'la',
])

function capitalize(word: string): string {
  const lower = word.toLocaleLowerCase('pt-BR')
  if (!lower) return ''
  return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1)
}

/**
 * "BEATRIZ APARECIDA DOS SANTOS INABA" → "Beatriz Inaba".
 * Returns '' for empty/blank input so callers can fall back.
 */
export function formatPersonName(raw: string | null | undefined): string {
  if (!raw) return ''
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''
  if (tokens.length === 1) return capitalize(tokens[0])

  const first = tokens[0]
  // Last meaningful token — skip trailing connectors ("Maria de" → "Maria").
  let lastIdx = tokens.length - 1
  while (
    lastIdx > 0 &&
    CONNECTORS.has(tokens[lastIdx].toLocaleLowerCase('pt-BR'))
  ) {
    lastIdx--
  }
  if (lastIdx === 0) return capitalize(first)
  return `${capitalize(first)} ${capitalize(tokens[lastIdx])}`
}

/**
 * Up to two uppercased initials for an avatar, derived from a person name.
 * Returns '' when the name is empty (callers fall back to phone digits).
 *
 * CRITICAL: extraction is code-point safe. Naive `name[0]` / `charAt(0)` /
 * `slice(0,2)` split a surrogate PAIR (any astral char — emoji, 🇧🇷, etc., which
 * litter WhatsApp profile names) in half, yielding a lone surrogate. The server
 * serializes that to U+FFFD (�) in the HTML while the client keeps the raw
 * surrogate in the JS string → the two disagree → React hydration mismatch and
 * a full client re-render. We pick the first letter/number per token via a
 * Unicode-aware regex (skipping emoji entirely), falling back to the first whole
 * code point. See inbox-row / thread-header / context-panel avatars.
 */
export function nameInitials(raw: string | null | undefined): string {
  if (!raw) return ''
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''

  // First letter/number of a token (Unicode-aware), else its first code point.
  const firstOf = (token: string): string => {
    const m = token.match(/[\p{L}\p{N}]/u)
    return m ? m[0] : (Array.from(token)[0] ?? '')
  }

  if (tokens.length === 1) {
    const letters = tokens[0].match(/[\p{L}\p{N}]/gu)
    const two = letters ? letters.slice(0, 2).join('') : firstOf(tokens[0])
    // Plain toUpperCase (locale-independent) — toLocaleUpperCase can differ
    // between Node and the browser and reintroduce a hydration mismatch.
    return two.toUpperCase()
  }
  return (firstOf(tokens[0]) + firstOf(tokens[tokens.length - 1])).toUpperCase()
}
