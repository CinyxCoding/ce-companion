// A small request governor for the CE API budget (200 requests per minute,
// counted per player). It records every request in a rolling 60s window and
// honors server backoff from a 429. The auto-refresh loop asks canRequest()
// before polling; the client records usage and backoff here.

const WINDOW_MS = 60000
// The API allows 200/min. The background service polls independently of this
// foreground budget, so we stay well under the ceiling here.
const MAX_PER_WINDOW = 120

let hits = []
let backoffUntil = 0

export function canRequest() {
  const now = Date.now()
  if (now < backoffUntil) return false
  hits = hits.filter((t) => now - t < WINDOW_MS)
  return hits.length < MAX_PER_WINDOW
}

export function noteRequest() {
  hits.push(Date.now())
}

// Called on a 429. retryAfterSec comes from the Retry-After header.
export function noteRateLimited(retryAfterSec) {
  const sec = Number(retryAfterSec) > 0 ? Number(retryAfterSec) : 30
  backoffUntil = Date.now() + sec * 1000
}
