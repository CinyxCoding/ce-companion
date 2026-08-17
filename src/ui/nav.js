import { el } from '../lib/dom.js'

// Three screens: Me (status, cooldowns, finances), Activity (jobs, expeditions,
// production, events), War (roster, attack feed).
const TABS = [
  ['me', 'ME'],
  ['activity', 'ACTIVITY'],
  ['war', 'WAR'],
  ['cartel', 'CARTEL'],
  ['chat', 'CHAT']
]

export function tabBar(active, onNavigate) {
  const mk = (key, label) => {
    const b = el('button', { class: 'tab' + (active === key ? ' tab-on' : ''), type: 'button', text: label })
    if (active !== key) b.addEventListener('click', () => onNavigate && onNavigate(key))
    return b
  }
  return el('div', { class: 'tabbar' }, ...TABS.map(([k, label]) => mk(k, label)))
}
