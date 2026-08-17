import { el, mount } from '../lib/dom.js'
import { loadKey, wipeKey } from '../store/keystore.js'
import { fetchChat } from '../api/chat.js'
import { tabBar } from './nav.js'
import { userLink, chatTime } from './widgets.js'

const CHANNELS = [
  ['global', 'Global'],
  ['trade', 'Trade'],
  ['cartel', 'Cartel']
]
const POLL_MS = 20000
const CAP = 200

let pollHandle = null

export function stopChat() {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
}

function normalize(messages) {
  return (messages || []).map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.name != null ? String(m.name) : '',
    at: parseInt(m.posted, 10) || 0,
    text: m.message != null ? String(m.message) : ''
  }))
}

function mergeInto(arr, incoming) {
  const seen = new Set(arr.map((m) => m.id))
  for (const m of incoming) {
    if (!seen.has(m.id)) {
      arr.push(m)
      seen.add(m.id)
    }
  }
  arr.sort((a, b) => a.at - b.at || a.id - b.id)
  if (arr.length > CAP) arr.splice(0, arr.length - CAP)
  return arr
}

function msgRow(m) {
  const head = el(
    'div',
    { class: 'chat-head' },
    el('span', { class: 'chat-name' }, userLink(m.userId, m.name)),
    el('span', { class: 'chat-time', text: chatTime(m.at) })
  )
  const text = el('div', { class: 'chat-text' })
  text.textContent = m.text
  return el('div', { class: 'chat-msg' }, head, text)
}

export function renderChat(root, { onLogout, onNavigate }) {
  stopChat()

  let channel = 'global'
  let loading = false
  const data = { global: [], trade: [], cartel: [] }
  const state = { global: null, trade: null, cartel: null } // null | 'forbidden' | 'empty' | 'rate'

  const log = el('div', { class: 'chat-log' })
  const note = el('div', { class: 'msg', role: 'status' })
  const refreshBtn = el('button', { class: 'ghost-btn refresh', text: 'Refresh' })

  const logoutBtn = el('button', { class: 'ghost-btn', text: 'Log out' })
  logoutBtn.addEventListener('click', () => {
    stopChat()
    onLogout()
  })

  const subBtns = {}
  const subtabs = el('div', { class: 'subtabs' })
  for (const [key, label] of CHANNELS) {
    const b = el('button', { class: 'subtab', type: 'button', text: label })
    b.addEventListener('click', () => selectChannel(key))
    subBtns[key] = b
    subtabs.append(b)
  }

  function setActiveSub() {
    for (const [key] of CHANNELS) subBtns[key].className = 'subtab' + (key === channel ? ' subtab-on' : '')
  }

  function renderLog() {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
    const msgs = data[channel]
    if (!msgs.length) {
      let txt = 'No messages yet.'
      if (state[channel] === 'forbidden') txt = 'Cartel chat needs a Private-All key. Global and Trade work with any key.'
      else if (state[channel] === 'rate') txt = 'Rate limited (3 chat requests per minute). Catching up shortly.'
      log.replaceChildren(el('div', { class: 'empty', text: txt }))
      return
    }
    log.replaceChildren(...msgs.map(msgRow))
    if (atBottom) log.scrollTop = log.scrollHeight
  }

  async function load(ch, opts) {
    const silent = !!(opts && opts.silent)
    if (loading) return
    loading = true
    if (!silent) {
      refreshBtn.disabled = true
      refreshBtn.textContent = 'Refreshing...'
    }

    const key = await loadKey()
    if (!key) {
      loading = false
      stopChat()
      onLogout()
      return
    }

    const res = await fetchChat(key, ch)

    if (!silent) {
      refreshBtn.disabled = false
      refreshBtn.textContent = 'Refresh'
    }
    loading = false

    if (res.error === 'bad_key') {
      await wipeKey()
      stopChat()
      onLogout()
      return
    }
    if (res.error === 'forbidden') {
      state[ch] = 'forbidden'
      if (ch === channel) renderLog()
      return
    }
    if (res.error === 'rate_limited') {
      if (!data[ch].length) state[ch] = 'rate'
      if (ch === channel) {
        renderLog()
        if (!silent) {
          note.className = 'msg msg-warn'
          note.textContent = 'Rate limited. Try again in ' + (res.retryAfter || 20) + 's.'
        }
      }
      return
    }
    if (!res.ok) return

    state[ch] = res.messages.length ? null : state[ch] === 'forbidden' ? 'forbidden' : 'empty'
    mergeInto(data[ch], normalize(res.messages))
    if (ch === channel) {
      note.className = 'msg'
      note.textContent = ''
      renderLog()
    }
  }

  function selectChannel(ch) {
    if (ch === channel) return
    channel = ch
    setActiveSub()
    note.className = 'msg'
    note.textContent = ''
    renderLog() // show cached immediately
    load(ch, { silent: false })
  }

  refreshBtn.addEventListener('click', () => load(channel, { silent: false }))

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
    tabBar('chat', onNavigate),
    subtabs,
    el('div', { class: 'status-row' }, el('span', { class: 'pill pill-good pill-live', text: 'Connected' }), refreshBtn),
    log,
    note,
    el('footer', { class: 'credit', text: 'developed by Cinyx  -  unofficial companion' })
  )

  mount(root, view)
  setActiveSub()
  renderLog()
  load(channel, { silent: false })
  pollHandle = setInterval(() => load(channel, { silent: true }), POLL_MS)

  return { refresh: () => load(channel, { silent: true }), stop: stopChat }
}
