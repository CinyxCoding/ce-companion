import { el, mount } from '../lib/dom.js'
import { saveKey } from '../store/keystore.js'
import { fetchDashboard } from '../api/client.js'

// Renders the connect screen. onConnected(data) fires once a key is accepted;
// the dashboard data from the validating call is passed straight through so we
// do not spend a second request.
export function renderLogin(root, { onConnected }) {
  const input = el('input', {
    type: 'password',
    class: 'input',
    placeholder: 'Paste your API key',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false'
  })

  const reveal = el('button', { type: 'button', class: 'ghost-btn reveal', text: 'Show' })
  reveal.addEventListener('click', () => {
    const hidden = input.type === 'password'
    input.type = hidden ? 'text' : 'password'
    reveal.textContent = hidden ? 'Hide' : 'Show'
    input.focus()
  })

  const msg = el('div', { class: 'msg', role: 'status' })
  const connect = el('button', { class: 'btn btn-primary', text: 'Connect' })

  function setBusy(busy) {
    connect.disabled = busy
    input.disabled = busy
    connect.textContent = busy ? 'Connecting...' : 'Connect'
  }

  function showMsg(kind, text) {
    msg.className = 'msg msg-' + kind
    msg.textContent = text
  }

  async function attempt() {
    const key = input.value.trim()
    if (!key) {
      showMsg('bad', 'Enter your API key to continue.')
      input.focus()
      return
    }
    showMsg('info', '')
    setBusy(true)
    const res = await fetchDashboard(key)
    setBusy(false)

    if (res.ok) {
      await saveKey(key)
      onConnected(res.data)
      return
    }

    switch (res.error) {
      case 'bad_key':
        showMsg('bad', 'That key was not accepted. Check it and try again.')
        break
      case 'forbidden':
        showMsg('bad', 'This key works but its level is too low. Set it to Private-All under Settings > API.')
        break
      case 'rate_limited':
        showMsg('warn', 'The game limited requests. Try again in ' + res.retryAfter + 's.')
        break
      case 'network':
        showMsg('warn', 'Could not reach the game. In a browser this is expected. Test on a device build.')
        break
      default:
        showMsg('bad', 'Something went wrong (status ' + res.status + '). Try again.')
        break
    }
  }

  connect.addEventListener('click', attempt)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attempt()
  })

  const card = el(
    'div',
    { class: 'panel login-card' },
    el(
      'div',
      { class: 'brand' },
      el('div', { class: 'brand-mark', text: 'CE' }),
      el(
        'div',
        { class: 'brand-text' },
        el('div', { class: 'brand-title', text: 'CARTEL EMPIRE' }),
        el('div', { class: 'brand-sub', text: 'COMPANION' })
      )
    ),
    el('p', {
      class: 'tagline',
      text: 'Live status, cooldowns and activity for your account. Your key is stored only on this device.'
    }),
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'label', text: 'API KEY' }),
      el('div', { class: 'input-wrap' }, input, reveal),
      el('div', { class: 'hint', text: 'Create one in game under Settings > API. Requires a Private-All key.' })
    ),
    connect,
    msg
  )

  const view = el(
    'section',
    { class: 'view view-login' },
    card,
    el('footer', { class: 'credit', text: 'developed by Cinyx' })
  )

  mount(root, view)
  setTimeout(() => input.focus(), 50)
}
