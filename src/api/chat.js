import { httpGet } from '../lib/platform.js'
import { canChat, noteChat, chatWaitMs } from './chatGovernor.js'

// Chat endpoint. Single channel per request (global/trade/cartel), messages
// wrapped under {global,trade,cartel}Chat. Gated by the chat governor.
// Notable behaviours: an empty channel returns 400 (treated as no messages),
// and cartel requires a Private-All key (403 otherwise).

const BASE = 'https://cartelempire.online/api'
const DESC = 'CE Companion by Cinyx'
const WRAP = { global: 'globalChat', trade: 'tradeChat', cartel: 'cartelChat' }

export async function fetchChat(key, channel) {
  if (!canChat()) {
    return { ok: false, error: 'rate_limited', retryAfter: Math.ceil(chatWaitMs() / 1000) }
  }

  // Chat's from-only heuristic sorts newest-first, so from=1 with limit=50
  // returns the 50 most recent messages (default with no bounds returns the
  // oldest 50). We re-sort client-side for display.
  const url =
    BASE +
    '/chat?type=' +
    encodeURIComponent(channel) +
    '&from=1&limit=50&desc=' +
    encodeURIComponent(DESC) +
    '&key=' +
    encodeURIComponent(key)

  noteChat()
  try {
    const res = await httpGet(url)
    if (res.status === 200) {
      const wrap = WRAP[channel]
      const arr = res.data && Array.isArray(res.data[wrap]) ? res.data[wrap] : []
      return { ok: true, messages: arr }
    }
    // An empty channel comes back as 400 rather than an empty array.
    if (res.status === 400) return { ok: true, messages: [] }
    if (res.status === 401) return { ok: false, error: 'bad_key' }
    if (res.status === 403) return { ok: false, error: 'forbidden' }
    if (res.status === 429) return { ok: false, error: 'rate_limited', retryAfter: 20 }
    return { ok: false, error: 'http_error', status: res.status }
  } catch (e) {
    return { ok: false, error: 'network' }
  }
}
