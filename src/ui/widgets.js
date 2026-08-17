import { el } from '../lib/dom.js'

// Small presentational helpers shared by the War and Cartel screens.

export const CE_BASE = 'https://cartelempire.online'

export function nowSec() {
  return Math.floor(Date.now() / 1000)
}

// Relative past time, e.g. "2m ago".
export function ago(sec) {
  const s = Math.max(0, sec)
  if (s < 45) return 'just now'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}

// Forward duration, e.g. "2h 14m" / "45m" / "30s".
export function dur(sec) {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m ? h + 'h ' + m + 'm' : h + 'h'
}

export function openUrl(url) {
  try {
    window.open(url, '_blank')
  } catch (e) {
    // ignore
  }
}

// A profile link. Shows the known name or a #id placeholder that can resolve
// later; data-uid lets a resolver fill the name in place.
export function userLink(id, name) {
  if (id == null) return el('span', { text: '?' })
  const a = el('a', { class: 'ev-link', href: CE_BASE + '/user/' + id, dataset: { uid: String(id) } })
  a.textContent = name || '#' + id
  a.addEventListener('click', (e) => {
    e.preventDefault()
    openUrl(a.href)
  })
  return a
}

export function updateNameLinks(container, id, name) {
  container.querySelectorAll('[data-uid="' + id + '"]').forEach((a) => {
    a.textContent = name
  })
}

export function isHospitalized(status) {
  return /hospital/i.test(status || '')
}

// A collapsible accordion section, matching the dashboard styling.
export function section(key, label, meta, open, bodyKids) {
  const summary = el(
    'summary',
    { class: 'sec-head' },
    el('span', { class: 'lbl', text: label }),
    el('span', { class: 'sec-meta' }, meta == null ? '' : meta),
    el('span', { class: 'chev', 'aria-hidden': 'true' })
  )
  const details = el('details', { class: 'sec', dataset: { key } }, summary, el('div', { class: 'sec-body' }, ...bodyKids))
  if (open) details.open = true
  return details
}

// Compact clock time for chat: "14:32" today, "9/3 14:32" on other days.
export function chatTime(sec) {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return hh + ':' + mm
  return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hh + ':' + mm
}
