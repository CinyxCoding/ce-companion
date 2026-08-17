import { httpGet } from '../lib/platform.js'
import { noteRequest, noteRateLimited } from './governor.js'

// Cartel endpoints. Single-type list selections (members, attacks, events)
// support weak ETags, so each is fetched on its own with If-None-Match and a
// small response cache. A 304 returns the cached body and costs almost nothing
// but the round trip, which is what makes polling the attack feed cheap.

const BASE = 'https://cartelempire.online/api'
const DESC = 'CE Companion by Cinyx'

// cacheKey -> { etag, data }
const etagCache = new Map()

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
  if (types) query += '&type=' + encodeURIComponent(types).replace(/%2C/gi, ',')
  return BASE + path + '?' + query
}

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

async function conditionalGet(path, cacheKey, options) {
  const url = buildUrl(path, options)
  const cached = etagCache.get(cacheKey)
  const reqHeaders = {}
  if (cached && cached.etag) reqHeaders['If-None-Match'] = cached.etag

  noteRequest()
  try {
    const res = await httpGet(url, reqHeaders)

    if (res.status === 304 && cached) {
      return { ok: true, status: 304, data: cached.data, notModified: true }
    }
    if (res.status === 429) {
      const retryAfter = toIntOr(headerLookup(res.headers, 'retry-after'), 60)
      noteRateLimited(retryAfter)
      return { ok: false, status: 429, error: 'rate_limited', retryAfter }
    }
    if (res.status === 401) return { ok: false, status: 401, error: 'bad_key' }
    if (res.status === 403) return { ok: false, status: 403, error: 'forbidden' }
    if (res.status === 200) {
      const etag = headerLookup(res.headers, 'etag')
      etagCache.set(cacheKey, { etag: etag || null, data: res.data })
      return { ok: true, status: 200, data: res.data }
    }
    if (res.status === 400) return { ok: false, status: 400, error: 'bad_request', data: res.data }
    return { ok: false, status: res.status, error: 'http_error', data: res.data }
  } catch (err) {
    const detail = err && err.message ? err.message : String(err)
    return { ok: false, status: 0, error: 'network', detail }
  }
}

export function fetchRoster(key) {
  return conditionalGet('/cartel', 'cartel:members', { key, types: 'members' })
}

export function fetchAttacks(key) {
  return conditionalGet('/cartel', 'cartel:attacks', { key, types: 'attacks' })
}

export function fetchCartelEvents(key) {
  return conditionalGet('/cartel', 'cartel:events', { key, types: 'events' })
}

// Clear cached ETags and bodies, e.g. on logout.
export function clearCartelCache() {
  etagCache.clear()
}
