/**
 * Phone formatting helpers.
 *
 * NOTE: The canonical implementation of `formatWaId` lives in
 * `lib/format/time.ts` (historical reasons — it was added alongside the
 * window-remaining helpers). We re-export it here so callers can import
 * from the conceptually correct module without duplicating logic.
 */
export { formatWaId } from './time'
