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
