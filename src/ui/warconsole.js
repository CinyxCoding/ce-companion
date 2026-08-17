import { el, mount } from '../lib/dom.js'
import { loadKey, wipeKey } from '../store/keystore.js'
import { fetchRoster, fetchAttacks, clearCartelCache } from '../api/cartel.js'
import { normalizeRoster, normalizeAttacks } from '../store/cartelModel.js'
import { knownName, seedNames, resolveNames } from '../api/names.js'
import { loadSettings } from '../store/settings.js'
import { canRequest } from '../api/governor.js'
import { money } from '../lib/format.js'
import { tabBar } from './nav.js'
import { nowSec, ago, userLink, updateNameLinks, isHospitalized, section as warSection } from './widgets.js'

let pollHandle = null
let tickHandle = null

export function stopWarConsole() {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
  if (tickHandle) {
    clearInterval(tickHandle)
    tickHandle = null
  }
}

function rosterItem(m) {
  const bits = []
  if (m.level != null) bits.push('Lv ' + m.level)
  if (m.reputation != null) bits.push(Math.round(m.reputation).toLocaleString() + ' rep')
  if (m.lastActive > 0) bits.push('active ' + ago(nowSec() - m.lastActive))

  const right = el('div', { class: 'li-right' })
  if (isHospitalized(m.status)) {
    if (m.allowRevive) right.append(el('span', { class: 'badge active', text: 'revive' }))
    else right.append(el('span', { class: 'badge hospital', text: 'hospital' }))
  }

  return el(
    'div',
    { class: 'list-item' },
    el('div', { class: 'li-main' }, el('span', { class: 'li-title' }, userLink(m.id, m.name)), el('span', { class: 'li-sub', text: bits.join('   ') })),
    right
  )
}

function attackItem(a) {
  const title = el('span', { class: 'li-title' })
  title.append(userLink(a.initiatorId, knownName(a.initiatorId)))
  title.append(document.createTextNode('  vs  '))
  title.append(userLink(a.targetId, knownName(a.targetId)))

  const sub = []
  if (a.outcome) sub.push(a.outcome)
  if (a.repGained != null) sub.push('+' + Math.round(a.repGained) + ' rep')
  if (a.cashMugged && a.cashMugged !== '0') sub.push(money(a.cashMugged))

  const right = el('div', { class: 'li-right' })
  if (a.isWar) right.append(el('span', { class: 'badge hospital', text: 'WAR' }))
  if (a.at > 0) right.append(el('span', { class: 'ev-time', text: ago(nowSec() - a.at) }))

  return el(
    'div',
    { class: 'list-item' },
    el('div', { class: 'li-main' }, title, el('span', { class: 'li-sub', text: sub.join('   ') })),
    right
  )
}

export function renderWarConsole(root, { onLogout, onNavigate }) {
  stopWarConsole()

  const settings = loadSettings()
  let refreshing = false

  const msg = el('div', { class: 'msg', role: 'status' })
  const acc = el('div', { class: 'acc' })
  const freshness = el('span', { class: 'freshness', dataset: { since: '0' } })
  const refreshBtn = el('button', { class: 'ghost-btn refresh', text: 'Refresh' })

  const logoutBtn = el('button', { class: 'ghost-btn', text: 'Log out' })
  logoutBtn.addEventListener('click', () => {
    stopWarConsole()
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

  function paint(roster, attacks) {
    const openState = {}
    acc.querySelectorAll('details.sec').forEach((d) => {
      openState[d.dataset.key] = d.open
    })
    const isOpen = (key, def) => (key in openState ? openState[key] : def)

    // Hospitalized members first (revive priority), then most recently active.
    const sorted = roster.slice().sort((a, b) => {
      const ah = isHospitalized(a.status) ? 1 : 0
      const bh = isHospitalized(b.status) ? 1 : 0
      if (ah !== bh) return bh - ah
      return b.lastActive - a.lastActive
    })
    const down = roster.filter((m) => isHospitalized(m.status)).length
    const rosterMeta = roster.length + ' members' + (down ? ', ' + down + ' down' : '')

    const rosterBody = []
    if (!sorted.length) rosterBody.push(el('div', { class: 'empty', text: 'No members returned.' }))
    else sorted.forEach((m) => rosterBody.push(rosterItem(m)))

    const attacksBody = []
    if (!attacks.length) attacksBody.push(el('div', { class: 'empty', text: 'No recent attacks.' }))
    else attacks.slice(0, 40).forEach((a) => attacksBody.push(attackItem(a)))

    acc.replaceChildren(
      warSection('roster', 'ROSTER', rosterMeta, isOpen('roster', true), rosterBody),
      warSection('attacks', 'ATTACK FEED', attacks.length + ' attacks', isOpen('attacks', true), attacksBody)
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
      stopWarConsole()
      onLogout()
      return
    }

    const results = await Promise.all([fetchRoster(key), fetchAttacks(key)])
    const rosterRes = results[0]
    const attacksRes = results[1]

    if (!silent) {
      refreshBtn.disabled = false
      refreshBtn.textContent = 'Refresh'
    }
    refreshing = false

    if (rosterRes.error === 'bad_key') {
      await wipeKey()
      stopWarConsole()
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
    const attacks = attacksRes.ok ? normalizeAttacks(attacksRes.data) : []

    // Roster pairs id and name, so seed the cache before painting.
    seedNames(roster.map((m) => ({ id: m.id, name: m.name })))

    if (!silent) {
      msg.className = 'msg'
      msg.textContent = ''
    }
    paint(roster, attacks)

    // Resolve any names still missing (external attack targets), filling them
    // in place as they arrive.
    const ids = []
    attacks.forEach((a) => {
      if (a.initiatorId != null) ids.push(a.initiatorId)
      if (a.targetId != null) ids.push(a.targetId)
    })
    resolveNames(key, ids, (id, name) => updateNameLinks(acc, id, name))
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
        el(
          'div',
          { class: 'brand-text' },
          el('div', { class: 'brand-title', text: 'CARTEL EMPIRE' }),
          el('div', { class: 'brand-sub', text: 'COMPANION' })
        )
      ),
      logoutBtn
    ),
    tabBar('war', onNavigate),
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

  return { refresh: () => load({ silent: true }), stop: stopWarConsole }
}
