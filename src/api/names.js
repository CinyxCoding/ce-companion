import { httpGet } from '../lib/platform.js'
import { canRequest, noteRequest } from './governor.js'

// Resolves userIds to names. Attacks reference players by id only, so names are
// looked up and cached. The cache persists in localStorage and is seeded from
// the roster (which already pairs id and name), so only external attack targets
// require lookups. Lookups are capped per call and gated by the governor;
// leftovers resolve on the next invocation.

const BASE = 'https://cartelempire.online/api'
const DESC = 'CE Companion by Cinyx'
const STORAGE_KEY = 'ce_name_cache_v1'
const MAX_PER_CALL = 20

let cache = loadCache()
const inflight = new Set()

function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return new Map(Object.entries(JSON.parse(raw)))
  } catch (e) {
    // fall through
  }
  return new Map()
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)))
  } catch (e) {
    // storage unavailable
  }
}

export function knownName(id) {
  if (id == null) return null
  return cache.get(String(id)) || null
}

export function seedNames(pairs) {
  let changed = false
  for (const p of pairs || []) {
    if (p && p.id != null && p.name) {
      const k = String(p.id)
      if (cache.get(k) !== p.name) {
        cache.set(k, String(p.name))
        changed = true
      }
    }
  }
  if (changed) persist()
}

export async function resolveNames(key, ids, onResolved) {
  const todo = []
  for (const id of ids || []) {
    if (id == null) continue
    const k = String(id)
    if (!k || k === 'null' || cache.has(k) || inflight.has(k)) continue
    todo.push(k)
    if (todo.length >= MAX_PER_CALL) break
  }

  for (const k of todo) {
    if (!canRequest()) break
    inflight.add(k)
    try {
      noteRequest()
      const url =
        BASE +
        '/user?type=basic&desc=' +
        encodeURIComponent(DESC) +
        '&key=' +
        encodeURIComponent(key) +
        '&id=' +
        encodeURIComponent(k)
      const res = await httpGet(url)
      if (res.status === 200 && res.data) {
        const d = Array.isArray(res.data) ? res.data[0] : res.data
        const name = d && d.name ? String(d.name) : null
        if (name) {
          cache.set(k, name)
          persist()
          if (onResolved) onResolved(k, name)
        }
      }
    } catch (e) {
      // leave unresolved; retried next cycle
    }
    inflight.delete(k)
  }
}
