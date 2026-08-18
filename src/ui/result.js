import { el, mount } from '../lib/dom.js'
import { loadKey, wipeKey } from '../store/keystore.js'
import { fetchDashboard } from '../api/client.js'
import { normalize } from '../store/model.js'
import { money, hms } from '../lib/format.js'
import { renderEventHtml } from '../lib/eventhtml.js'
import { tabBar } from './nav.js'
import { loadSettings, saveSettings, REFRESH_OPTIONS } from '../store/settings.js'
import { canRequest } from '../api/governor.js'
import { startBackgroundAlerts, stopBackgroundAlerts } from '../api/poller.js'
import { cancelAll, sendTestAlert } from '../notify/scheduler.js'

let tickHandle = null
let autoHandle = null

export function stopResultTick() {
  if (tickHandle) {
    clearInterval(tickHandle)
    tickHandle = null
  }
  if (autoHandle) {
    clearInterval(autoHandle)
    autoHandle = null
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function ago(secs) {
  if (secs < 60) return secs + 's'
  if (secs < 3600) return Math.floor(secs / 60) + 'm'
  return Math.floor(secs / 3600) + 'h'
}

// Open a URL outside the app. Capacitor routes window.open to the system
// browser on device, so the SPA is never navigated away from.
function openUrl(url) {
  try {
    window.open(url, '_blank')
  } catch (e) {
    // Ignore.
  }
}

// Which sections live on each dashboard screen. Me holds what needs attention
// now; Activity holds what is in progress.
const SCREEN_SECTIONS = {
  me: ['links', 'status', 'cooldowns', 'finances'],
  activity: ['operations', 'events']
}

// Quick links into the game. These open the game site in the browser, since the
// app itself is read-only and does not act for you.
const GAME_BASE = 'https://cartelempire.online'
const GAME_LINKS = [
  ['Town', '/Town'],
  ['Gym', '/Gym'],
  ['Missions', '/Missions'],
  ['Expedition', '/Expedition'],
  ['Market', '/Market'],
  ['Inventory', '/Inventory'],
  ['Hospital', '/Hospital'],
  ['Bounty', '/Bounty'],
  ['Casino', '/Casino'],
  ['Cartel', '/Cartel'],
  ['Forum', '/Forum']
]

function cd(atSeconds, zeroLabel) {
  const t = Number(atSeconds) || 0
  return el('span', {
    class: 'mono cd cd-none',
    dataset: { until: String(t), zero: zeroLabel || 'ready', none: '-' },
    text: '-'
  })
}

function tick() {
  const now = nowSec()

  document.querySelectorAll('[data-until]').forEach((node) => {
    const until = parseInt(node.dataset.until, 10) || 0
    if (until <= 0) {
      node.textContent = node.dataset.none || '-'
      node.className = 'mono cd cd-none'
      return
    }
    const diff = until - now
    if (diff <= 0) {
      node.textContent = node.dataset.zero || 'ready'
      node.className = 'mono cd cd-ready'
      return
    }
    node.textContent = hms(diff)
    node.className = diff <= 60 ? 'mono cd cd-soon' : 'mono cd cd-active'
  })

  document.querySelectorAll('[data-since]').forEach((node) => {
    const since = parseInt(node.dataset.since, 10) || 0
    if (!since) {
      node.textContent = ''
      return
    }
    const secs = Math.max(0, Math.floor((Date.now() - since) / 1000))
    node.textContent = 'updated ' + ago(secs) + ' ago'
  })
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase()
  let cls = 'badge'
  if (s.includes('hospital')) cls += ' hospital'
  else if (s.includes('jail')) cls += ' jail'
  else if (s.includes('active') || s.includes('okay') || s.includes('free')) cls += ' active'
  return el('span', { class: cls, text: status || 'Unknown' })
}

function row(label, valueNode) {
  return el('div', { class: 'row' }, el('span', { class: 'k', text: label }), valueNode)
}

function bar(label, current, max, kind, pctVal) {
  return el(
    'div',
    { class: 'bar' },
    el(
      'div',
      { class: 'bar-top' },
      el('span', { class: 'bar-label', text: label }),
      el('span', { class: 'bar-val', text: current.toLocaleString() + ' / ' + max.toLocaleString() })
    ),
    el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill ' + kind, style: 'width:' + pctVal + '%' }))
  )
}

function timerRow(label, at) {
  const active = at > nowSec()
  const value = active ? cd(at, 'clear') : el('span', { class: 'mono cd cd-none', text: 'clear' })
  return row(label, value)
}

function cooldownRow(label, at) {
  const active = at > nowSec()
  const value = active ? cd(at, 'ready') : el('span', { class: 'mono cd cd-ready', text: 'ready' })
  return row(label, value)
}

function expeditionItem(e) {
  const chance = e.successChance != null ? e.successChance + '% success' : ''
  const sub = [e.region, chance].filter(Boolean).join('   ')
  return el(
    'div',
    { class: 'list-item' },
    el(
      'div',
      { class: 'li-main' },
      el('span', { class: 'li-title', text: e.title || 'Slot ' + (e.slot != null ? e.slot : '?') }),
      el('span', { class: 'li-sub', text: sub })
    ),
    el('div', { class: 'li-right' }, cd(e.endAt, 'done'))
  )
}

function agoLong(sec) {
  const s = Math.max(0, sec)
  if (s < 45) return 'just now'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}

function eventItem(ev) {
  const textEl = el('span', { class: 'li-title ev-text' })
  if (ev.text && ev.text.trim()) textEl.appendChild(renderEventHtml(ev.text, openUrl))
  else textEl.textContent = '(event)'

  const meta = el('div', { class: 'ev-meta' })
  if (ev.category) {
    const catClass = 'ev-cat cat-' + ev.category.toLowerCase().replace(/[^a-z0-9]/g, '')
    meta.append(el('span', { class: catClass, text: ev.category }))
  }
  if (ev.at > 0) meta.append(el('span', { class: 'ev-time', text: agoLong(nowSec() - ev.at) }))

  const main = el('div', { class: 'li-main' }, textEl, meta)
  return el('div', { class: 'list-item event-item' + (ev.viewed ? '' : ' unread') }, main)
}

function makeSection(key, label, metaNode, open, bodyKids) {
  const summary = el(
    'summary',
    { class: 'sec-head' },
    el('span', { class: 'lbl', text: label }),
    el('span', { class: 'sec-meta' }, metaNode == null ? '' : metaNode),
    el('span', { class: 'chev', 'aria-hidden': 'true' })
  )
  const details = el('details', { class: 'sec', dataset: { key } }, summary, el('div', { class: 'sec-body' }, ...bodyKids))
  if (open) details.open = true
  return details
}

function statusSection(m, open) {
  const v = m.vitals
  const c = m.confinement
  const body = [
    bar('Life', v.life.current, v.life.max, 'life', v.life.pct),
    bar('Energy', v.energy.current, v.energy.max, 'energy', v.energy.pct),
    row('Reputation', el('span', { class: 'v mono', text: m.player.reputation.toLocaleString() })),
    timerRow('Hospital', c.hospital.releaseAt),
    timerRow('Jail', c.jail.releaseAt)
  ]
  return makeSection('status', 'STATUS', statusBadge(m.player.status), open, body)
}

function cooldownSection(m, open) {
  const now = nowSec()
  const cds = [
    ['Drug', m.cooldowns.drug.readyAt],
    ['Medical', m.cooldowns.medical.readyAt],
    ['Booster', m.cooldowns.booster.readyAt]
  ]
  const ready = cds.filter(([, at]) => !(at > now)).length
  const body = cds.map(([name, at]) => cooldownRow(name, at))
  return makeSection('cooldowns', 'COOLDOWNS', ready + '/3 ready', open, body)
}

function linksSection(open) {
  const grid = el('div', { class: 'link-grid' })
  GAME_LINKS.forEach(([label, path]) => {
    const b = el('button', { class: 'link-btn', type: 'button', text: label })
    b.addEventListener('click', () => openUrl(GAME_BASE + path))
    grid.append(b)
  })
  return makeSection('links', 'GAME LINKS', GAME_LINKS.length + ' places', open, [grid])
}

function financeSection(m, open) {
  const w = m.wallet
  const body = [
    row('On hand', el('span', { class: 'amount', text: money(w.onHand) })),
    row('Bank', el('span', { class: 'amount', text: money(w.bank) })),
    row('Vault', el('span', { class: 'amount', text: money(w.vault) })),
    row('Points', el('span', { class: 'v mono', text: w.points.toLocaleString() }))
  ]
  return makeSection('finances', 'FINANCES', money(w.onHand), open, body)
}

function operationsSection(m, open) {
  const ops = m.operations
  const body = []
  if (ops.job) body.push(row('Job: ' + (ops.job.label || ops.job.type), cd(ops.job.finishAt, 'done')))
  else body.push(row('Job', el('span', { class: 'mono cd cd-none', text: 'idle' })))

  body.push(el('div', { class: 'tile-sub-label', text: 'EXPEDITIONS' }))
  if (!ops.expeditions.length) body.push(el('div', { class: 'empty', text: 'None running.' }))
  else ops.expeditions.forEach((e) => body.push(expeditionItem(e)))

  const meta = ops.job ? 'job active' : ops.expeditions.length ? ops.expeditions.length + ' expeditions' : 'idle'
  return makeSection('operations', 'OPERATIONS', meta, open, body)
}

const EVENTS_PER_PAGE = 15

function eventsSection(m, open, page, onPageChange) {
  const evs = m.events || []
  const total = evs.length
  const pages = Math.max(1, Math.ceil(total / EVENTS_PER_PAGE))
  let p = page
  if (p > pages) p = pages
  if (p < 1) p = 1
  const start = (p - 1) * EVENTS_PER_PAGE
  const pageEvents = evs.slice(start, start + EVENTS_PER_PAGE)

  const body = []
  if (!total) body.push(el('div', { class: 'empty', text: 'No recent events.' }))
  else pageEvents.forEach((ev) => body.push(eventItem(ev)))

  if (pages > 1) {
    const prev = el('button', { class: 'ghost-btn pager-btn', type: 'button', text: 'Prev' })
    prev.disabled = p <= 1
    prev.addEventListener('click', () => onPageChange(p - 1))
    const next = el('button', { class: 'ghost-btn pager-btn', type: 'button', text: 'Next' })
    next.disabled = p >= pages
    next.addEventListener('click', () => onPageChange(p + 1))
    body.push(el('div', { class: 'pager' }, prev, el('span', { class: 'pager-info', text: 'Page ' + p + ' of ' + pages }), next))
  }

  return makeSection('events', 'RECENT EVENTS', total + ' events', open, body)
}

/* Settings sheet -------------------------------------------------- */

function gearIcon() {
  const s = el('span', { class: 'gear-ic', 'aria-hidden': 'true' })
  s.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
  return s
}

function switchEl(active, onChange) {
  const sw = el('button', { class: 'switch' + (active ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(active) }, el('span', { class: 'knob' }))
  sw.addEventListener('click', () => {
    const on = sw.classList.toggle('on')
    sw.setAttribute('aria-checked', String(on))
    onChange(on)
  })
  return sw
}

function setRow(label, active, onChange) {
  return el('div', { class: 'set-row' }, el('span', { class: 'set-name', text: label }), switchEl(active, onChange))
}

// Renders the dashboard. Returns { refresh } so the host can refresh on resume.
export function renderResult(root, { data, screen, onLogout, onNavigate }) {
  stopResultTick()

  const screenName = screen === 'activity' ? 'activity' : 'me'
  const sections = SCREEN_SECTIONS[screenName]

  const settings = loadSettings()
  let lastModel = null
  let refreshing = false
  let eventsPage = 1

  // Re-render only the events section (used by the pager) so paging does not
  // rebuild the whole dashboard or disturb other sections.
  function rerenderEvents() {
    if (!lastModel) return
    const existing = acc.querySelector('details.sec[data-key="events"]')
    const open = existing ? existing.open : true
    const fresh = eventsSection(lastModel, open, eventsPage, setEventsPage)
    if (existing) existing.replaceWith(fresh)
  }

  function setEventsPage(p) {
    const total = lastModel && lastModel.events ? lastModel.events.length : 0
    const pages = Math.max(1, Math.ceil(total / EVENTS_PER_PAGE))
    eventsPage = Math.min(Math.max(1, p), pages)
    rerenderEvents()
  }

  const msg = el('div', { class: 'msg', role: 'status' })
  const acc = el('div', { class: 'acc' })
  const whoEl = el('span', { class: 'who' })
  const freshness = el('span', { class: 'freshness', dataset: { since: '0' } })
  const refreshBtn = el('button', { class: 'ghost-btn refresh', text: 'Refresh' })

  const logoutBtn = el('button', { class: 'ghost-btn', text: 'Log out' })
  logoutBtn.addEventListener('click', () => {
    stopResultTick()
    cancelAll()
    onLogout()
  })

  const testBtn = el('button', { class: 'ghost-btn test-btn', text: 'Test notification' })
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true
    const res = await sendTestAlert()
    testBtn.disabled = false
    if (res.ok) {
      msg.className = 'msg msg-info'
      msg.textContent = 'Notification sent - if you did not see it, notifications are blocked for this app. (Live alerts come from the background service.)'
    } else if (res.reason === 'no-permission') {
      msg.className = 'msg msg-warn'
      msg.textContent = 'Notifications are turned off for this app.'
    } else if (res.reason === 'not-native') {
      msg.className = 'msg msg-warn'
      msg.textContent = 'Test alerts only work in the device build, not the browser preview.'
    } else {
      msg.className = 'msg msg-warn'
      msg.textContent = 'Could not schedule the test alert.'
    }
  })

  // The native foreground service is the sole notifier: one poll-and-alert loop
  // that runs whenever notifications are on. Start or stop it to match settings.
  async function syncBackgroundService() {
    if (settings.notifications) {
      const k = await loadKey()
      if (k) startBackgroundAlerts(k, !settings.jobAlerts, chatChannels(), notifCategories(), settings.cooldownReadyOnly)
      else stopBackgroundAlerts()
    } else {
      stopBackgroundAlerts()
      cancelAll() // clear any alarms a previous version may have scheduled
    }
  }

  function notifCategories() {
    const cats = []
    if (settings.notifEvents) cats.push('events')
    if (settings.notifDrug) cats.push('drug')
    if (settings.notifMedical) cats.push('medical')
    if (settings.notifBooster) cats.push('booster')
    if (settings.notifJail) cats.push('jail')
    if (settings.notifHospital) cats.push('hospital')
    if (settings.notifVitals) cats.push('vitals')
    return cats.join(',')
  }

  function chatChannels() {
    const list = []
    if (settings.chatGlobal) list.push('global')
    if (settings.chatTrade) list.push('trade')
    if (settings.chatCartel) list.push('cartel')
    return list.join(',')
  }

  function startAuto(seconds) {
    if (autoHandle) {
      clearInterval(autoHandle)
      autoHandle = null
    }
    if (seconds > 0) {
      autoHandle = setInterval(() => {
        if (!refreshing && canRequest()) refresh({ silent: true })
      }, seconds * 1000)
    }
  }

  function setWho(player) {
    if (!player.name) {
      whoEl.textContent = ''
      return
    }
    const bits = []
    if (player.level != null) bits.push('Lv ' + player.level)
    if (player.cartelName) bits.push(player.cartelName)
    whoEl.textContent = bits.length ? player.name + '   ' + bits.join('   ') : player.name
  }

  function paint(raw) {
    const m = normalize(raw)
    lastModel = m
    setWho(m.player)

    const openState = {}
    acc.querySelectorAll('details.sec').forEach((d) => {
      openState[d.dataset.key] = d.open
    })
    const isOpen = (key, def) => (key in openState ? openState[key] : def)

    const builders = {
      links: () => linksSection(isOpen('links', true)),
      status: () => statusSection(m, isOpen('status', true)),
      cooldowns: () => cooldownSection(m, isOpen('cooldowns', true)),
      finances: () => financeSection(m, isOpen('finances', true)),
      operations: () => operationsSection(m, isOpen('operations', true)),
      events: () => eventsSection(m, isOpen('events', true), eventsPage, setEventsPage)
    }
    const order = sections.filter((k) => builders[k])
    acc.replaceChildren(...order.map((k) => builders[k]()))

    freshness.dataset.since = String(Date.now())
    tick()
  }

  async function refresh(opts) {
    const silent = !!(opts && opts.silent)
    if (refreshing) return
    refreshing = true
    const label = refreshBtn.textContent
    if (!silent) {
      refreshBtn.disabled = true
      refreshBtn.textContent = 'Refreshing...'
    }

    const key = await loadKey()
    if (!key) {
      refreshing = false
      stopResultTick()
      cancelAll()
      onLogout()
      return
    }

    const res = await fetchDashboard(key)
    if (!silent) {
      refreshBtn.disabled = false
      refreshBtn.textContent = label
    }
    refreshing = false

    if (res.ok) {
      if (!silent) {
        msg.className = 'msg'
        msg.textContent = ''
      }
      paint(res.data)
      return
    }
    if (res.error === 'bad_key' || res.error === 'forbidden') {
      await wipeKey()
      stopResultTick()
      cancelAll()
      onLogout()
      return
    }
    if (!silent) {
      if (res.error === 'rate_limited') {
        msg.className = 'msg msg-warn'
        msg.textContent = 'Rate limited. Try again in ' + res.retryAfter + 's.'
      } else {
        msg.className = 'msg msg-warn'
        msg.textContent = 'Refresh failed (status ' + res.status + ').'
      }
    }
  }
  refreshBtn.addEventListener('click', () => refresh({ silent: false }))

  // Settings sheet
  const overlay = el('div', { class: 'overlay' })
  overlay.hidden = true
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true
  })

  const doneBtn = el('button', { class: 'ghost-btn', text: 'Done' })
  doneBtn.addEventListener('click', () => {
    overlay.hidden = true
  })

  const chipsRow = el('div', { class: 'chips' })
  const chipButtons = []
  REFRESH_OPTIONS.forEach((sec) => {
    const b = el('button', { class: 'chip' + (sec === settings.refreshSeconds ? ' chip-on' : ''), type: 'button', text: sec === 0 ? 'Off' : sec + 's' })
    b.addEventListener('click', () => {
      settings.refreshSeconds = sec
      saveSettings(settings)
      chipButtons.forEach((c) => c.el.classList.toggle('chip-on', c.sec === sec))
      startAuto(sec)
    })
    chipButtons.push({ el: b, sec })
    chipsRow.append(b)
  })

  // Privacy policy panel, opened from the settings About entry.
  const privacyOverlay = el('div', { class: 'overlay' })
  privacyOverlay.hidden = true
  privacyOverlay.addEventListener('click', (e) => {
    if (e.target === privacyOverlay) privacyOverlay.hidden = true
  })
  const privacyDone = el('button', { class: 'ghost-btn', text: 'Done' })
  privacyDone.addEventListener('click', () => {
    privacyOverlay.hidden = true
  })
  const emailBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Email cartelempire.ravage@gmail.com' })
  emailBtn.addEventListener('click', () => {
    try {
      window.open('mailto:cartelempire.ravage@gmail.com?subject=CE%20Companion', '_blank')
    } catch (e) {
      // ignore
    }
  })
  const onlineBtn = el('button', { class: 'ghost-btn', type: 'button', text: 'View policy online' })
  onlineBtn.addEventListener('click', () => {
    try {
      window.open('https://gist.github.com/CinyxCoding/cdffdb45743b48176a307fa062c91b9f', '_blank')
    } catch (e) {
      // ignore
    }
  })

  const ppH = (t) => el('div', { class: 'pp-h', text: t })
  const ppP = (t) => el('p', { class: 'pp-p', text: t })

  const privacyCard = el(
    'div',
    { class: 'panel overlay-card' },
    el('div', { class: 'overlay-head' }, el('span', { class: 'lbl', text: 'PRIVACY POLICY' }), privacyDone),
    el(
      'div',
      { class: 'pp-body' },
      ppP('Last updated: August 2026'),
      ppP('CE Companion ("the app") is an unofficial, independent companion for the browser game Cartel Empire. It is not operated by or affiliated with the makers of Cartel Empire. This policy explains what the app accesses and how your information is handled.'),
      ppH('What the app accesses'),
      ppP('The app uses a Cartel Empire API key that you create and enter yourself. With that key it reads your Cartel Empire account and cartel information - such as your status, cooldowns, finances, in-game events, cartel roster and chat - only to display it to you and to alert you to new activity.'),
      ppH('Where your data is stored'),
      ppP('Your API key is stored only on your device, in the operating system secure storage. The app sends your key only to the official Cartel Empire API at cartelempire.online, to make the requests needed to show your data. Your key and your data are never sent anywhere else and are never shared, sold or pooled with other users.'),
      ppH('What the app does not collect'),
      ppP('The app has no accounts, no analytics, no advertising and no third-party servers. Nothing you do in the app is tracked or transmitted to the developer. The developer cannot see your key or your data.'),
      ppH('Notifications and background activity'),
      ppP('If you enable Notifications, the app runs a background service that periodically polls the Cartel Empire API to detect new in-game activity and alert you. This only communicates with the Cartel Empire API; no information is collected or sent elsewhere. You can turn it off at any time in Settings.'),
      ppH('Data retention and deletion'),
      ppP('Your key stays on your device until you log out, which erases it, or uninstall the app, which removes all app data. The developer holds no copy of your data.'),
      ppH('Children'),
      ppP('The app is a companion tool for an existing game and is not directed at children under 13.'),
      ppH('Changes'),
      ppP('This policy may be updated; material changes will be reflected in the app and at the hosted policy link.'),
      ppH('Contact'),
      ppP('Questions about this policy or your data:'),
      emailBtn,
      onlineBtn
    )
  )
  privacyOverlay.append(privacyCard)

  const privacyBtn = el('button', { class: 'ghost-btn', type: 'button', text: 'Privacy policy' })
  privacyBtn.addEventListener('click', () => {
    overlay.hidden = true
    privacyOverlay.hidden = false
  })

  // A settings toggle bound to a boolean setting that re-syncs the service.
  const notifToggle = (label, keyName) =>
    setRow(label, settings[keyName], (on) => {
      settings[keyName] = on
      saveSettings(settings)
      syncBackgroundService()
    })

  const overlayCard = el(
    'div',
    { class: 'panel overlay-card' },
    el('div', { class: 'overlay-head' }, el('span', { class: 'lbl', text: 'SETTINGS' }), doneBtn),
    el('div', { class: 'set-group' }, el('div', { class: 'set-label', text: 'AUTO REFRESH' }), chipsRow),
    el(
      'div',
      { class: 'set-group' },
      el('div', { class: 'set-label', text: 'NOTIFICATIONS' }),
      notifToggle('Notifications', 'notifications'),
      el('div', {
        class: 'set-note',
        text: 'Master switch. A background service watches your account and pings you while the app is closed. It shows a permanent notification and uses more battery, so turn it off when you do not need alerts. The switches below take effect only while this is on.'
      }),
      el('div', { class: 'set-sublabel', text: 'ALERT TYPES' }),
      notifToggle('Events', 'notifEvents'),
      notifToggle('Job events', 'jobAlerts'),
      notifToggle('Drug cooldown', 'notifDrug'),
      notifToggle('Medical cooldown', 'notifMedical'),
      notifToggle('Booster cooldown', 'notifBooster'),
      notifToggle('Jail release', 'notifJail'),
      notifToggle('Hospital release', 'notifHospital'),
      notifToggle('Life and energy full', 'notifVitals'),
      notifToggle('Cooldowns: ready alert only', 'cooldownReadyOnly'),
      el('div', {
        class: 'set-note',
        text: 'Ready alert only means cooldowns ping once when they are ready, with no countdown steps. Turn it off to also get step reminders. Job events stay off by default and still appear in the events list.'
      })
    ),
    el(
      'div',
      { class: 'set-group' },
      el('div', { class: 'set-label', text: 'CHAT ALERTS' }),
      el('div', { class: 'set-note', text: 'Pings for new chat messages while the app is closed. Requires Notifications (above). Global and Trade are high-volume and can be noisy; Cartel needs a Private-All key.' }),
      setRow('Global chat', settings.chatGlobal, (on) => {
        settings.chatGlobal = on
        saveSettings(settings)
        syncBackgroundService()
      }),
      setRow('Trade chat', settings.chatTrade, (on) => {
        settings.chatTrade = on
        saveSettings(settings)
        syncBackgroundService()
      }),
      setRow('Cartel chat', settings.chatCartel, (on) => {
        settings.chatCartel = on
        saveSettings(settings)
        syncBackgroundService()
      })
    ),
    el(
      'div',
      { class: 'set-group' },
      el('div', { class: 'set-label', text: 'ABOUT' }),
      privacyBtn
    )
  )
  overlay.append(overlayCard)

  const gearBtn = el('button', { class: 'ghost-btn icon-btn', type: 'button', 'aria-label': 'Settings' }, gearIcon())
  gearBtn.addEventListener('click', () => {
    overlay.hidden = false
  })

  // A small easter egg: tap the logo five times.
  const brandMark = el('div', { class: 'brand-mark', text: 'CE' })
  const eggToast = el('div', { class: 'egg-toast', text: 'Tom sucks' })
  eggToast.hidden = true
  let eggTaps = 0
  let eggTimer = null
  brandMark.addEventListener('click', () => {
    eggTaps += 1
    if (eggTimer) clearTimeout(eggTimer)
    if (eggTaps >= 5) {
      eggTaps = 0
      eggToast.hidden = false
      requestAnimationFrame(() => eggToast.classList.add('show'))
      setTimeout(() => {
        eggToast.classList.remove('show')
        setTimeout(() => {
          eggToast.hidden = true
        }, 300)
      }, 1600)
    } else {
      eggTimer = setTimeout(() => {
        eggTaps = 0
      }, 1200)
    }
  })

  const view = el(
    'section',
    { class: 'view view-result' },
    el(
      'header',
      { class: 'topbar' },
      el(
        'div',
        { class: 'brand brand-sm' },
        brandMark,
        el(
          'div',
          { class: 'brand-text' },
          el('div', { class: 'brand-title', text: 'CARTEL EMPIRE' }),
          el('div', { class: 'brand-sub', text: 'COMPANION' })
        )
      ),
      el('div', { class: 'top-actions' }, gearBtn, logoutBtn)
    ),
    tabBar(screenName, onNavigate),
    el(
      'div',
      { class: 'status-row' },
      el('span', { class: 'pill pill-good pill-live', text: 'Connected' }),
      whoEl,
      refreshBtn
    ),
    acc,
    el('div', { class: 'foot-tools' }, freshness, testBtn),
    msg,
    el('footer', { class: 'credit', text: 'developed by Cinyx  -  unofficial companion' }),
    overlay,
    privacyOverlay,
    eggToast
  )

  mount(root, view)
  paint(data)
  tickHandle = setInterval(tick, 1000)
  startAuto(settings.refreshSeconds)

  // The service is the sole notifier now. Clear any alarms an older version
  // may have scheduled, then start the service if notifications are on.
  cancelAll()
  syncBackgroundService()

  return { refresh: () => refresh({ silent: true }), stop: stopResultTick }
}
