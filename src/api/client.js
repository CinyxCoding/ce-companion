import { httpGet } from '../lib/platform.js'
import { noteRequest, noteRateLimited } from './governor.js'

const BASE = 'https://cartelempire.online/api'

// Every request must carry a description. The server truncates it to 30 chars.
// Keep it short, honest, and identifiable in the player's API log.
const DESC = 'CE Companion by Cinyx'

// Build a request URL. The key and desc are percent-encoded, but the type list
// keeps literal commas so the server splits it the way the docs show.
function buildUrl(path, { key, types, extra } = {}) {
  const params = new URLSearchParams()
  if (key) params.set('key', key)
  params.set('desc', DESC)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null) params.set(k, String(v))
    }
  }
  let query = params.toString()
  if (types) {
    query += '&type=' + encodeURIComponent(types).replace(/%2C/gi, ',')
  }
  return BASE + path + '?' + query
}

// Strip the key from any string before it could reach a log.
function headerLookup(headers, name) {
  if (!headers) return undefined
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key]
  }
  return undefined
}

function toIntOr(value, fallback) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

// Map a raw HTTP response into a result the app understands.
function classify(status, body, headers) {
  if (status === 200) return { ok: true, status, data: body }
  if (status === 401) return { ok: false, status, error: 'bad_key' }
  if (status === 403) return { ok: false, status, error: 'forbidden' }
  if (status === 429) {
    const retryAfter = toIntOr(headerLookup(headers, 'retry-after'), 60)
    return { ok: false, status, error: 'rate_limited', retryAfter }
  }
  // On list selections a 400 means "no rows". On the combined user call it
  // means bad params or no data. Surface the body so callers can inspect it.
  if (status === 400) return { ok: false, status, error: 'bad_request', data: body }
  return { ok: false, status, error: 'http_error', data: body }
}

async function request(path, options) {
  const url = buildUrl(path, options)
  noteRequest()
  try {
    const res = await httpGet(url)
    const result = classify(res.status, res.data, res.headers)
    if (result.error === 'rate_limited') noteRateLimited(result.retryAfter)
    return result
  } catch (err) {
    // DNS, offline, or CORS in a browser preview.
    const detail = err && err.message ? err.message : String(err)
    return { ok: false, status: 0, error: 'network', detail }
  }
}

// The v1 dashboard pulls several single-object selections in one request.
// None of these support ETags, so combining them is free and saves budget.
// A 200 both validates the key and returns everything the dashboard needs.
//
// In-flight de-duplication: if a fetch is already running (e.g. an auto-refresh
// overlapping a screen switch, or a future second consumer), callers share the
// same promise instead of opening a second identical request.
let dashInflight = null

export function fetchDashboard(key) {
  if (dashInflight) return dashInflight
  dashInflight = request('/user', { key, types: 'basic,status,cooldowns,activities,money,events' }).finally(() => {
    dashInflight = null
  })
  return dashInflight
}
