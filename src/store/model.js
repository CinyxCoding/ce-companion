import { toEpochSeconds, toInt } from '../lib/format.js'
import { jobLabel } from '../lib/jobs.js'

// This is the only file that knows the raw API field names and the quirks of
// the combined /user response: the flat merge of most types, list types that
// arrive as arrays (expeditions, events), timestamps in seconds or
// milliseconds, and cash delivered as BIGINT strings. Everything downstream
// reads these clean domain objects instead.

function ratio(cur, max) {
  const c = Number(cur)
  const m = Number(max)
  if (!Number.isFinite(m) || m <= 0) return 0
  const p = Math.round(((Number.isFinite(c) ? c : 0) / m) * 100)
  return Math.max(0, Math.min(100, p))
}

function isFull(cur, max) {
  const c = Number(cur)
  const m = Number(max)
  return Number.isFinite(c) && Number.isFinite(m) && m > 0 && c >= m
}

function str(value) {
  return value == null ? '' : String(value)
}

// Events have an unconfirmed shape, so keep the raw object and take a best
// guess at the common fields. The raw is surfaced in a verify panel so the
// exact field names can be locked in. When no id field is present, a hash of
// the text gives a stable id for de-duplicating notifications across polls.
function hashStr(s) {
  let h = 5381
  const str = String(s)
  for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) >>> 0
  return 'h' + h.toString(36)
}

function normalizeEvent(e, i) {
  if (e == null) return { id: 'e' + i, text: '', at: 0, raw: e }
  if (typeof e === 'string') return { id: hashStr(e), text: e, at: 0, raw: e }
  const text = e.message || e.text || e.description || e.event || e.title || e.body || ''
  const at = toEpochSeconds(e.timestamp || e.date || e.time || e.createdAt || e.created || e.datetime || 0)
  const id = e.id != null ? String(e.id) : e.eventId != null ? String(e.eventId) : hashStr(String(text) + '|' + at)
  return { id, text: String(text), at, raw: e }
}

export function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {}

  const player = {
    userId: toInt(d.userId),
    name: str(d.name),
    level: d.level != null ? toInt(d.level) : null,
    status: str(d.status) || 'Unknown',
    reputation: toInt(d.reputation),
    cartelId: toInt(d.cartelId),
    cartelName: str(d.cartelName)
  }

  const vitals = {
    life: { current: toInt(d.currentLife), max: toInt(d.maxLife), pct: ratio(d.currentLife, d.maxLife), full: isFull(d.currentLife, d.maxLife) },
    energy: { current: toInt(d.currentEnergy), max: toInt(d.maxEnergy), pct: ratio(d.currentEnergy, d.maxEnergy), full: isFull(d.currentEnergy, d.maxEnergy) }
  }
  vitals.full = vitals.life.full && vitals.energy.full

  const confinement = {
    hospital: { releaseAt: toEpochSeconds(d.hospitalRelease) },
    jail: { releaseAt: toEpochSeconds(d.jailRelease) }
  }

  const cooldowns = {
    drug: { readyAt: toEpochSeconds(d.drugCooldown) },
    medical: { readyAt: toEpochSeconds(d.medicalCooldown) },
    booster: { readyAt: toEpochSeconds(d.boosterCooldown) }
  }

  const wallet = {
    onHand: str(d.cashOnHand),
    bank: str(d.cashInBank),
    vault: str(d.cashInVault),
    points: toInt(d.points)
  }

  const rawJob = d.job
  const job =
    rawJob && (rawJob.jobType || rawJob.finishTime)
      ? { type: str(rawJob.jobType), label: jobLabel(rawJob.jobType) || 'Active', finishAt: toEpochSeconds(rawJob.finishTime) }
      : null

  const expeditions = Array.isArray(d.expeditions)
    ? d.expeditions.map((e) => ({
        slot: e.slot != null ? toInt(e.slot) : null,
        title: str(e.title),
        region: str(e.regionName || e.region),
        successChance: e.successChance != null ? Number(e.successChance) : null,
        notoriety: e.notoriety != null ? Number(e.notoriety) : null,
        endAt: toEpochSeconds(e.endDate)
      }))
    : []

  const rawProd = d.productions
  const productions = {
    hour: rawProd && rawProd.productionHour != null ? toInt(rawProd.productionHour) : null,
    lines:
      rawProd && Array.isArray(rawProd.lines)
        ? rawProd.lines.map((l) => ({
            id: toInt(l.productionTypeId),
            name: str(l.name) || 'Line ' + toInt(l.productionTypeId),
            owned: toInt(l.owned),
            narcos: toInt(l.narcosAssigned)
          }))
        : []
  }

  const operations = { job, expeditions, productions }

  const events = Array.isArray(d.events) ? d.events.map(normalizeEvent) : []

  return { player, vitals, confinement, cooldowns, wallet, operations, events }
}
