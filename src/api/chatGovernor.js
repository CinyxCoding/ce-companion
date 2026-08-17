// The chat endpoint has its own hard limit: 3 requests per 60-second window,
// separate from the general 200/min budget. This paces all chat requests
// (polls, channel switches, manual refreshes) so we never trip a 429.

const WINDOW_MS = 60000
const MAX = 3
let hits = []

function prune() {
  const now = Date.now()
  hits = hits.filter((t) => now - t < WINDOW_MS)
}

export function canChat() {
  prune()
  return hits.length < MAX
}

export function noteChat() {
  hits.push(Date.now())
}

// Milliseconds until the next request would be allowed (0 if allowed now).
export function chatWaitMs() {
  prune()
  if (hits.length < MAX) return 0
  return WINDOW_MS - (Date.now() - hits[0])
}
