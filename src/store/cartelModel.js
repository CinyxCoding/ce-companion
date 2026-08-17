import { toInt, toEpochSeconds } from '../lib/format.js'

// Normalization for cartel data, using the confirmed field shapes.
// Roster members: { userId, name, level, reputation, status, allowRevive,
//   lastActive (string unix seconds), joined }.
// Attacks: { id, initiatorId, targetId, initiatorCartelId, targetCartelId,
//   repGained, cashMugged, outcome, attackType, isWar, warId, created }.
// Attacks carry ids only, not names, so names are resolved separately.

function str(value) {
  return value == null ? '' : String(value)
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function pickArray(data, key) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data[key])) return data[key]
  return []
}

export function normalizeRoster(data) {
  return pickArray(data, 'members').map((m, i) => ({
    id: m.userId != null ? m.userId : m.id != null ? m.id : i,
    name: str(m.name),
    level: m.level != null ? toInt(m.level) : null,
    reputation: m.reputation != null ? Number(m.reputation) : null,
    status: str(m.status),
    allowRevive: bool(m.allowRevive),
    lastActive: toEpochSeconds(m.lastActive || 0),
    joined: toEpochSeconds(m.joined || 0)
  }))
}

export function normalizeAttacks(data) {
  return pickArray(data, 'attacks').map((a, i) => ({
    id: a.id != null ? String(a.id) : 'a' + i,
    initiatorId: a.initiatorId != null ? a.initiatorId : null,
    targetId: a.targetId != null ? a.targetId : null,
    initiatorCartelId: a.initiatorCartelId != null ? a.initiatorCartelId : null,
    targetCartelId: a.targetCartelId != null ? a.targetCartelId : null,
    outcome: str(a.outcome),
    attackType: str(a.attackType),
    repGained: a.repGained != null ? Number(a.repGained) : null,
    // Cash may be BIGINT: keep it a string.
    cashMugged: a.cashMugged != null ? String(a.cashMugged) : null,
    isWar: bool(a.isWar),
    warId: a.warId != null ? String(a.warId) : '',
    at: toEpochSeconds(a.created || a.timestamp || 0)
  }))
}

// Cartel events envelope: { events: [ { id, category, description, created } ] }.
// Descriptions are plain text (no HTML), unlike user events.
export function parseCartelEvents(data) {
  return pickArray(data, 'events').map((e, i) => ({
    id: e.id != null ? String(e.id) : 'ce' + i,
    category: str(e.category),
    description: str(e.description),
    at: toEpochSeconds(e.created || 0)
  }))
}

// "REVIVER revived REVIVEE, gaining N Rep (M Rep to cartel)."
// Cartel event descriptions contain HTML anchors for player names, e.g.
// "<a href='/User/92090'>KETUM</a> used a Cocaine from the Cartel Armory".
// These helpers pull the plain text and the linked user out of that.
function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const USER_ANCHOR = /<a[^>]*\/[Uu]ser\/(\d+)[^>]*>([^<]*)<\/a>/

function firstUser(desc) {
  const m = USER_ANCHOR.exec(desc || '')
  if (m) return { id: m[1], name: (m[2] || '').trim() }
  return { id: null, name: '' }
}

const REVIVE_RE = /^(.+?) revived (.+?), gaining ([\d,]+) Rep \(([\d,]+) Rep to cartel\)\.?$/

export function extractRevives(events) {
  const out = []
  for (const e of events || []) {
    if (e.category !== 'Revive') continue
    const m = REVIVE_RE.exec(stripTags(e.description))
    if (!m) continue
    out.push({
      reviver: m[1].trim(),
      revivee: m[2].trim(),
      rep: toInt(m[3].replace(/,/g, '')),
      cartelRep: toInt(m[4].replace(/,/g, '')),
      at: e.at
    })
  }
  return out
}

// Revive readiness for hospitalized members. Each revive within the window is a
// stacking -15% penalty that expires 6h after it happened. Matching is by name
// (revive lines carry names, the roster carries the same names).
export function reviveReadiness(roster, revives, now, windowSec) {
  const win = windowSec || 6 * 3600
  const byName = new Map()
  for (const r of revives || []) {
    if (now - r.at >= win) continue
    const k = (r.revivee || '').toUpperCase()
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(r.at)
  }

  const list = (roster || [])
    .filter((m) => /hospital/i.test(m.status))
    .map((m) => {
      const times = (byName.get((m.name || '').toUpperCase()) || []).slice().sort((a, b) => a - b)
      const stacks = times.length
      return {
        id: m.id,
        name: m.name,
        level: m.level,
        allowRevive: m.allowRevive,
        stacks,
        penalty: stacks * 15,
        clearsIn: stacks ? Math.max(0, times[0] + win - now) : 0,
        lastAt: stacks ? times[times.length - 1] : 0
      }
    })

  // Cleanest first (fewest stacks), then higher level.
  list.sort((a, b) => a.stacks - b.stacks || (b.level || 0) - (a.level || 0))
  return list
}

// One record per Armory Use event: { id, userId, name, item, at }. Handles the
// HTML anchor in the name. These records are what gets stored for history.
export function extractArmoury(events) {
  const out = []
  for (const e of events || []) {
    if (e.category !== 'Armory Use') continue
    const plain = stripTags(e.description)
    const im = /used (?:an? )?(.+?) from the Cartel Armory/i.exec(plain)
    if (!im) continue
    const item = im[1].trim()
    const u = firstUser(e.description)
    let name = u.name
    if (!name) {
      const nm = /^(.+?) used /.exec(plain)
      name = nm ? nm[1].trim() : 'Unknown'
    }
    out.push({ id: e.id, userId: u.id != null ? Number(u.id) : null, name, item, at: e.at })
  }
  return out
}

// Aggregate armoury records into a per-player / per-item tally. Optionally limit
// to records at or after fromTs. Works on records from the live feed or from
// stored history alike.
export function aggregateArmoury(records, fromTs) {
  const perUser = new Map()
  const itemTotals = new Map()
  let total = 0
  let oldest = Infinity
  let newest = 0

  for (const r of records || []) {
    if (r == null) continue
    if (fromTs != null && r.at < fromTs) continue
    const name = r.name || 'Unknown'
    const key = r.userId != null ? 'id:' + r.userId : 'nm:' + name.toUpperCase()

    if (!perUser.has(key)) perUser.set(key, { id: r.userId, name, count: 0, items: new Map(), firstAt: r.at, lastAt: r.at })
    const rec = perUser.get(key)
    rec.count += 1
    rec.items.set(r.item, (rec.items.get(r.item) || 0) + 1)
    if (r.at && r.at < rec.firstAt) rec.firstAt = r.at
    if (r.at > rec.lastAt) rec.lastAt = r.at

    itemTotals.set(r.item, (itemTotals.get(r.item) || 0) + 1)
    total += 1
    if (r.at && r.at < oldest) oldest = r.at
    if (r.at > newest) newest = r.at
  }

  const players = Array.from(perUser.values()).map((r) => ({
    id: r.id,
    name: r.name,
    total: r.count,
    items: Array.from(r.items.entries())
      .map(([item, count]) => ({ item, count }))
      .sort((a, b) => b.count - a.count),
    firstAt: r.firstAt,
    lastAt: r.lastAt
  }))

  const items = Array.from(itemTotals.entries())
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count)

  return { total, players, items, oldest: oldest === Infinity ? 0 : oldest, newest }
}

// Cartel activity feed: everything except revives and armoury use, which have
// their own sections.
const ACTIVITY_EXCLUDE = new Set(['Revive', 'Armory Use'])

export function cartelActivity(events) {
  return (events || []).filter((e) => !ACTIVITY_EXCLUDE.has(e.category))
}
