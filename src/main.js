import './styles/tokens.css'
import './styles/components.css'
import './styles/app.css'

import { el, mount } from './lib/dom.js'
import { loadKey, wipeKey } from './store/keystore.js'
import { fetchDashboard } from './api/client.js'
import { renderLogin } from './ui/login.js'
import { renderResult } from './ui/result.js'
import { renderWarConsole } from './ui/warconsole.js'
import { renderCartel } from './ui/cartel.js'
import { renderChat } from './ui/chat.js'
import { onResume, onPause } from './lib/platform.js'
import { setChatForeground } from './api/poller.js'

const root = document.getElementById('app')

// The currently mounted screen exposes { refresh, stop }. Navigation stops the
// current screen before mounting the next so timers and polling never overlap.
// Me and Activity share the dashboard data; War fetches its own.
let active = null
let currentPage = 'me'
let lastDashData = null

function stopActive() {
  if (active && active.stop) active.stop()
  active = null
}

function brandBlock() {
  return el(
    'div',
    { class: 'brand' },
    el('div', { class: 'brand-mark', text: 'CE' }),
    el(
      'div',
      { class: 'brand-text' },
      el('div', { class: 'brand-title', text: 'CARTEL EMPIRE' }),
      el('div', { class: 'brand-sub', text: 'COMPANION' })
    )
  )
}

function goLogin() {
  stopActive()
  currentPage = 'me'
  lastDashData = null
  renderLogin(root, { onConnected: (data) => goResult(data) })
}

function mountDashboard(screen, data) {
  currentPage = screen
  active = renderResult(root, { data, screen, onLogout: goLogin, onNavigate: navigate })
}

function mountWar() {
  currentPage = 'war'
  active = renderWarConsole(root, { onLogout: goLogin, onNavigate: navigate })
}

function mountCartel() {
  currentPage = 'cartel'
  active = renderCartel(root, { onLogout: goLogin, onNavigate: navigate })
}

function mountChat() {
  currentPage = 'chat'
  active = renderChat(root, { onLogout: goLogin, onNavigate: navigate })
}

function goResult(data) {
  lastDashData = data
  stopActive()
  mountDashboard('me', data)
}

function navigate(page) {
  if (page === currentPage) return
  stopActive()
  if (page === 'war') {
    mountWar()
  } else if (page === 'cartel') {
    mountCartel()
  } else if (page === 'chat') {
    mountChat()
  } else if (page === 'me' || page === 'activity') {
    if (lastDashData) mountDashboard(page, lastDashData)
    else boot()
  } else {
    boot()
  }
}

function showBooting() {
  stopActive()
  mount(
    root,
    el(
      'section',
      { class: 'view' },
      el('div', { class: 'boot' }, brandBlock(), el('div', { class: 'spinner' }), el('div', { class: 'boot-text', text: 'Reconnecting...' }))
    )
  )
}

function showBootError(res, onRetry) {
  stopActive()
  const retry = el('button', { class: 'btn btn-primary', text: 'Retry' })
  retry.addEventListener('click', onRetry)

  const other = el('button', { class: 'ghost-btn', text: 'Use a different key' })
  other.addEventListener('click', async () => {
    await wipeKey()
    goLogin()
  })

  const detail =
    res.error === 'network'
      ? 'Could not reach the game. Check your connection and retry.'
      : 'Unexpected response (status ' + res.status + ').'

  mount(
    root,
    el(
      'section',
      { class: 'view' },
      el('div', { class: 'boot' }, brandBlock(), el('div', { class: 'boot-text', text: detail }), el('div', { class: 'boot-actions' }, retry, other))
    )
  )
}

async function boot() {
  const key = await loadKey()
  if (!key) {
    goLogin()
    return
  }

  showBooting()
  const res = await fetchDashboard(key)

  if (res.ok) {
    goResult(res.data)
    return
  }
  if (res.error === 'bad_key' || res.error === 'forbidden') {
    await wipeKey()
    goLogin()
    return
  }
  showBootError(res, () => boot())
}

// Reconcile on foreground: refresh whichever page is up. Also tell the service
// the app is foreground so it pauses chat polling (the viewer handles chat
// while open); on background it resumes so chat alerts can fire.
onResume(() => {
  setChatForeground(true)
  if (active && active.refresh) active.refresh()
})

onPause(() => {
  setChatForeground(false)
})

boot()
