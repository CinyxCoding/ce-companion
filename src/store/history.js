// On-device store of armoury-use records, so history accumulates past the ~100
// event cartel feed. Records are merged (deduped by event id) each time the
// cartel tab polls, and pruned to a bounded age/size. Backed by localStorage,
// which is plenty for the realistic volume; if it ever outgrows that we would
// move to IndexedDB.

const KEY = 'ce_armoury_history_v1'
const MAX_AGE = 90 * 24 * 3600 // keep ~90 days
const MAX_COUNT = 30000 // hard cap, drop oldest beyond this

let recs = null // records sorted by at ascending
let ids = null // Set of record ids for dedup

function load() {
  if (recs) return
  recs = []
  ids = new Set()
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (Array.isArray(arr)) {
      for (const r of arr) {
        if (r == null || r.id == null) continue
        const k = String(r.id)
        if (ids.has(k)) continue
        ids.add(k)
        recs.push(r)
      }
    }
  } catch (e) {
    recs = []
    ids = new Set()
  }
  recs.sort((a, b) => a.at - b.at)
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(recs))
  } catch (e) {
    // storage full or unavailable; keep the in-memory copy
  }
}

function prune() {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - MAX_AGE
  let changed = false
  if (recs.length && recs[0].at < cutoff) {
    recs = recs.filter((r) => r.at >= cutoff)
    changed = true
  }
  if (recs.length > MAX_COUNT) {
    recs = recs.slice(recs.length - MAX_COUNT)
    changed = true
  }
  if (changed) ids = new Set(recs.map((r) => String(r.id)))
  return changed
}

// Merge new armoury records; returns how many were newly added.
export function mergeArmoury(records) {
  load()
  let added = 0
  for (const r of records || []) {
    if (r == null || r.id == null) continue
    const k = String(r.id)
    if (ids.has(k)) continue
    ids.add(k)
    recs.push(r)
    added += 1
  }
  if (added) {
    recs.sort((a, b) => a.at - b.at)
    prune()
    persist()
  }
  return added
}

// Records at or after fromTs (fromTs null = all).
export function armouryRange(fromTs) {
  load()
  if (fromTs == null) return recs.slice()
  return recs.filter((r) => r.at >= fromTs)
}

export function armouryEarliest() {
  load()
  return recs.length ? recs[0].at : 0
}

export function armouryCount() {
  load()
  return recs.length
}

export function clearArmouryHistory() {
  recs = []
  ids = new Set()
  try {
    localStorage.removeItem(KEY)
  } catch (e) {
    // ignore
  }
}
