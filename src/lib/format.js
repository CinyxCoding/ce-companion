// Currency symbol written as an escaped code point so the source stays pure
// ASCII. At runtime this renders the pound sign the game uses.
const CURRENCY = '\u00A3'

// Group a non-negative integer supplied as a string, WITHOUT converting it to a
// JS number. Cash fields are BIGINT and would corrupt past 2^53 as Number.
export function groupDigits(value) {
  const digits = String(value == null ? '' : value).replace(/[^0-9]/g, '')
  if (digits === '') return '0'
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function money(value) {
  return CURRENCY + groupDigits(value)
}

// Parse a value that may be a number or a numeric string into an integer.
export function toInt(value) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : 0
}

// Normalize a timestamp to unix seconds. The API is inconsistent: some fields
// arrive in seconds (10 digits) and others in milliseconds (13 digits). Any
// value past ~1e11 could only be a seconds count in the year 5138 or later, so
// it is really milliseconds and gets divided down. Idempotent for seconds.
// Timestamps stay well inside the safe integer range, so Number math is fine
// here (unlike cash, which must remain a string).
export function toEpochSeconds(value) {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 100000000000 ? Math.floor(n / 1000) : n
}

// Compact H:MM:SS or M:SS from a number of seconds.
export function hms(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s)
  return m + ':' + pad(s)
}
