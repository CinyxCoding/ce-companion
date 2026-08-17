import { el, mount } from '../lib/dom.js'
import { loadKey, wipeKey } from '../store/keystore.js'
import { fetchRoster, fetchCartelEvents, clearCartelCache } from '../api/cartel.js'
import { normalizeRoster, parseCartelEvents, extractRevives, reviveReadiness, extractArmoury, aggregateArmoury, cartelActivity } from '../store/cartelModel.js'
import { mergeArmoury, armouryRange, armouryEarliest, armouryCount, clearArmouryHistory } from '../store/history.js'
import { loadSettings } from '../store/settings.js'
import { canRequest } from '../api/governor.js'
import { tabBar } from './nav.js'
import { nowSec, ago, dur, userLink, section, openUrl } from './widgets.js'
import { renderEventHtml } from '../lib/eventhtml.js'

const REVIVE_WINDOW = 6 * 3600

// Time-window options for the armoury filter (label -> seconds; 0 = all stored).
const ARMOURY_WINDOWS = [
  ['12h', 12 * 3600],
  ['24h', 24 * 3600],
  ['7d', 7 * 86400],
  ['30d', 30 * 86400],
  ['All', 0]
]
const ARMOURY_SORTS = [
  ['Most used', 'used'],
  ['Recent', 'recent'],
  ['A-Z', 'name']
]

let pollHandle = null
let tickHandle = null

export function stopCartel() {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
  if (tickHandle) {
    clearInterval(tickHandle)
    tickHandle = null
  }
}

function readinessItem(m) {
  const bits = []
  if (m.level != null) bits.push('Lv ' + m.level)
  if (m.stacks > 0) {
    bits.push(m.stacks + ' recent ' + (m.stacks === 1 ? 'revive' : 'revives'))
    if (m.clearsIn > 0) bits.push('one clears in ' + dur(m.clearsIn))
  } else if (m.lastAt > 0) {
    bits.push('last revived ' + ago(nowSec() - m.lastAt))
  }

  const right = el('div', { class: 'li-right' })
  if (!m.allowRevive) right.append(el('span', { class: 'badge muted', text: 'revives off' }))
  else if (m.stacks === 0) right.append(el('span', { class: 'badge active', text: 'Reviveable' }))
  else right.append(el('span', { class: 'badge ' + (m.stacks >= 3 ? 'hospital' : 'warn'), text: '-' + m.penalty + '%' }))

  return el(
    'div',
    { class: 'list-item' },
    el('div', { class: 'li-main' }, el('span', { class: 'li-title' }, userLink(m.id, m.name)), el('span', { class: 'li-sub', text: bits.join('   ') })),
    right
  )
}

function armouryRow(p, nameToId, filterItem) {
  const titleEl = el('span', { class: 'li-title' })
  const id = p.id != null ? p.id : nameToId.get((p.name || '').toUpperCase())
  if (id != null) titleEl.append(userLink(id, p.name))
  else titleEl.textContent = p.name || 'Unknown'

  let breakdown
  let badge
  if (filterItem) {
    const n = p.filterCount || 0
    breakdown = n + ' ' + filterItem
    badge = String(n)
  } else {
    breakdown = p.items.map((x) => x.count + ' ' + x.item).join(', ')
    badge = String(p.total)
  }

  const now = nowSec()
  const meta = []
  if (p.lastAt) meta.push('last ' + ago(now - p.lastAt))
  const span = (p.lastAt || 0) - (p.firstAt || 0)
  if (span >= 60) meta.push('over ' + dur(span))

  return el(
    'div',
    { class: 'list-item' },
    el(
      'div',
      { class: 'li-main' },
      titleEl,
      el('span', { class: 'li-sub', text: breakdown }),
      meta.length ? el('span', { class: 'li-sub li-dim', text: meta.join('   ') }) : null
    ),
    el('div', { class: 'li-right' }, el('span', { class: 'badge muted', text: badge }))
  )
}

function activityRow(e) {
  const meta = el('div', { class: 'ev-meta' })
  if (e.category) meta.append(el('span', { class: 'ev-cat cat-' + e.category.toLowerCase().replace(/[^a-z0-9]/g, ''), text: e.category }))
  if (e.at > 0) meta.append(el('span', { class: 'ev-time', text: ago(nowSec() - e.at) }))
  const textEl = el('span', { class: 'li-title ev-text' })
  textEl.appendChild(renderEventHtml(e.description, openUrl))
  return el('div', { class: 'list-item' }, el('div', { class: 'li-main' }, textEl, meta))
}

export function renderCartel(root, { onLogout, onNavigate }) {
  stopCartel()

  const settings = loadSettings()
  let refreshing = false
  let armourySort = 'used'
  let armouryWindow = 0
  let armouryItem = 'all'
  let lastRoster = []
  let lastEvents = []

  // A row of selectable chips (used for the armoury sort and window filters).
  function chipRow(options, current, onPick) {
    const row = el('div', { class: 'chips arm-chips' })
    options.forEach(([label, value]) => {
      const c = el('button', { class: 'chip' + (value === current ? ' chip-on' : ''), type: 'button', text: label })
      if (value !== current) c.addEventListener('click', () => onPick(value))
      row.append(c)
    })
    return row
  }

  // Dropdown to filter the armoury list to a single item.
  function itemSelect(items, current, onPick) {
    const sel = el('select', { class: 'arm-select' })
    sel.append(el('option', { value: 'all', text: 'All items' }))
    items.forEach(({ item, count }) => sel.append(el('option', { value: item, text: item + ' (' + count + ')' })))
    sel.value = current
    sel.addEventListener('change', () => onPick(sel.value))
    return sel
  }

  const msg = el('div', { class: 'msg', role: 'status' })
  const acc = el('div', { class: 'acc' })
  const freshness = el('span', { class: 'freshness', dataset: { since: '0' } })
  const refreshBtn = el('button', { class: 'ghost-btn refresh', text: 'Refresh' })

  const logoutBtn = el('button', { class: 'ghost-btn', text: 'Log out' })
  logoutBtn.addEventListener('click', () => {
    stopCartel()
    clearCartelCache()
    onLogout()
  })

  function updateFreshness() {
    const since = parseInt(freshness.dataset.since, 10) || 0
    if (!since) {
      freshness.textContent = ''
      return
    }
    const secs = Math.max(0, Math.floor((Date.now() - since) / 1000))
    freshness.textContent = 'updated ' + (secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm') + ' ago'
  }

  function reviveSection(roster, revives, open) {
    const now = nowSec()
    const list = reviveReadiness(roster, revives, now, REVIVE_WINDOW)
    const revivable = list.filter((m) => m.allowRevive)
    const off = list.length - revivable.length

    const body = []
    if (!list.length) {
      body.push(el('div', { class: 'empty', text: 'Nobody is currently hospitalized.' }))
    } else {
      list.forEach((m) => body.push(readinessItem(m)))
    }

    // If the feed does not reach back a full window, some stacks may be missed.
    if (revives.length) {
      const oldest = Math.min(...revives.map((r) => r.at))
      const coverage = now - oldest
      if (coverage < REVIVE_WINDOW) {
        body.push(el('div', { class: 'sec-note', text: 'Revive history only reaches back ' + dur(coverage) + '; older stacks may be missed.' }))
      }
    }

    const meta = list.length ? revivable.length + ' revivable' + (off ? ' - ' + off + ' off' : '') : 'nobody down'
    return section('revive', 'REVIVE READINESS', meta, open, body)
  }

  function armourySection(events, roster, open) {
    const now = nowSec()
    const fromTs = armouryWindow ? now - armouryWindow : null
    const records = armouryRange(fromTs)
    const usage = aggregateArmoury(records)
    const nameToId = new Map(roster.map((m) => [(m.name || '').toUpperCase(), m.id]))

    // Item filter: drop a stale selection if that item isn't in this window.
    const itemNames = new Set(usage.items.map((i) => i.item))
    if (armouryItem !== 'all' && !itemNames.has(armouryItem)) armouryItem = 'all'
    const filterItem = armouryItem !== 'all' ? armouryItem : null

    let players = usage.players.slice()
    if (filterItem) {
      players = players
        .map((p) => {
          const it = p.items.find((x) => x.item === filterItem)
          return it ? Object.assign({}, p, { filterCount: it.count }) : null
        })
        .filter(Boolean)
    }
    if (armourySort === 'recent') players.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
    else if (armourySort === 'name') players.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    else players.sort((a, b) => (filterItem ? b.filterCount - a.filterCount : b.total - a.total))

    const body = []
    body.push(chipRow(ARMOURY_WINDOWS, armouryWindow, (v) => {
      armouryWindow = v
      paint(lastRoster, lastEvents)
    }))
    body.push(chipRow(ARMOURY_SORTS, armourySort, (v) => {
      armourySort = v
      paint(lastRoster, lastEvents)
    }))
    if (usage.items.length) {
      body.push(itemSelect(usage.items, armouryItem, (v) => {
        armouryItem = v
        paint(lastRoster, lastEvents)
      }))
    }

    if (!usage.total) {
      body.push(el('div', { class: 'empty', text: 'No armoury use in this window yet.' }))
    } else {
      if (!filterItem && usage.items.length) {
        const summary = usage.items.map((x) => x.count + ' ' + x.item).join(', ')
        body.push(el('div', { class: 'sec-note', text: 'Items used: ' + summary }))
      }
      if (filterItem && !players.length) {
        body.push(el('div', { class: 'empty', text: 'Nobody used ' + filterItem + ' in this window.' }))
      } else {
        players.forEach((p) => body.push(armouryRow(p, nameToId, filterItem)))
      }
    }

    // Coverage: how much history is stored on this device.
    const stored = armouryCount()
    const earliest = armouryEarliest()
    let note = 'Stored on this device: ' + stored + (stored === 1 ? ' event' : ' events')
    if (earliest) note += ', since ' + ago(now - earliest)
    note += '. History builds up while you open this tab.'
    if (fromTs && earliest && earliest > fromTs) note += ' It does not reach the full window yet.'
    body.push(el('div', { class: 'sec-note', text: note }))

    if (stored > 0) {
      const clearBtn = el('button', { class: 'ghost-btn arm-clear', type: 'button', text: 'Clear stored history' })
      clearBtn.addEventListener('click', () => {
        if (window.confirm('Clear all stored armoury history on this device? This cannot be undone.')) {
          clearArmouryHistory()
          paint(lastRoster, lastEvents)
        }
      })
      body.push(clearBtn)
    }

    const meta = usage.total + ' uses' + (filterItem ? ' - ' + filterItem : '')
    return section('armoury', 'ARMOURY USE', meta, open, body)
  }

  function activitySection(events, open) {
    const acts = cartelActivity(events)
    const body = []
    if (!acts.length) body.push(el('div', { class: 'empty', text: 'No recent cartel activity.' }))
    else acts.slice(0, 30).forEach((e) => body.push(activityRow(e)))
    return section('activity', 'CARTEL ACTIVITY', acts.length + ' events', open, body)
  }

  function paint(roster, events) {
    lastRoster = roster
    lastEvents = events
    const openState = {}
    acc.querySelectorAll('details.sec').forEach((d) => {
      openState[d.dataset.key] = d.open
    })
    const isOpen = (key, def) => (key in openState ? openState[key] : def)

    const revives = extractRevives(events)
    acc.replaceChildren(
      reviveSection(roster, revives, isOpen('revive', true)),
      armourySection(events, roster, isOpen('armoury', true)),
      activitySection(events, isOpen('activity', false))
    )

    freshness.dataset.since = String(Date.now())
    updateFreshness()
  }

  function showNoAccess() {
    acc.replaceChildren(
      el(
        'div',
        { class: 'panel tile' },
        el('div', { class: 'tile-head' }, el('span', { class: 'lbl', text: 'CARTEL ACCESS NEEDED' })),
        el('p', {
          class: 'tagline',
          text: 'This key cannot read cartel data. In the game under Settings > API, enable the cartel Access permission on the key (or create a new key with it), then log out and reconnect.'
        })
      )
    )
  }

  async function load(opts) {
    const silent = !!(opts && opts.silent)
    if (refreshing) return
    refreshing = true
    if (!silent) {
      refreshBtn.disabled = true
      refreshBtn.textContent = 'Refreshing...'
    }

    const key = await loadKey()
    if (!key) {
      refreshing = false
      stopCartel()
      onLogout()
      return
    }

    const results = await Promise.all([fetchRoster(key), fetchCartelEvents(key)])
    const rosterRes = results[0]
    const eventsRes = results[1]

    if (!silent) {
      refreshBtn.disabled = false
      refreshBtn.textContent = 'Refresh'
    }
    refreshing = false

    if (rosterRes.error === 'bad_key') {
      await wipeKey()
      stopCartel()
      clearCartelCache()
      onLogout()
      return
    }
    if (rosterRes.error === 'forbidden') {
      if (!silent) {
        msg.className = 'msg'
        msg.textContent = ''
      }
      showNoAccess()
      return
    }
    if (rosterRes.error === 'rate_limited') {
      if (!silent) {
        msg.className = 'msg msg-warn'
        msg.textContent = 'Rate limited. Try again in ' + rosterRes.retryAfter + 's.'
      }
      return
    }

    const roster = rosterRes.ok ? normalizeRoster(rosterRes.data) : []
    const events = eventsRes.ok ? parseCartelEvents(eventsRes.data) : []
    // Accumulate armoury-use records into on-device history so the stats and
    // date-range filters have data beyond the ~100-event feed window.
    if (eventsRes.ok) mergeArmoury(extractArmoury(events))
    if (!silent) {
      msg.className = 'msg'
      msg.textContent = ''
    }
    paint(roster, events)
  }
  refreshBtn.addEventListener('click', () => load({ silent: false }))

  const view = el(
    'section',
    { class: 'view view-result' },
    el(
      'header',
      { class: 'topbar' },
      el(
        'div',
        { class: 'brand brand-sm' },
        el('div', { class: 'brand-mark', text: 'CE' }),
        el('div', { class: 'brand-text' }, el('div', { class: 'brand-title', text: 'CARTEL EMPIRE' }), el('div', { class: 'brand-sub', text: 'COMPANION' }))
      ),
      logoutBtn
    ),
    tabBar('cartel', onNavigate),
    el('div', { class: 'status-row' }, el('span', { class: 'pill pill-good pill-live', text: 'Connected' }), refreshBtn),
    acc,
    el('div', { class: 'foot-tools' }, freshness),
    msg,
    el('footer', { class: 'credit', text: 'developed by Cinyx  -  unofficial companion' })
  )

  mount(root, view)
  load({ silent: false })
  tickHandle = setInterval(updateFreshness, 1000)
  if (settings.refreshSeconds > 0) {
    pollHandle = setInterval(() => {
      if (!refreshing && canRequest()) load({ silent: true })
    }, settings.refreshSeconds * 1000)
  }

  return { refresh: () => load({ silent: true }), stop: stopCartel }
}
