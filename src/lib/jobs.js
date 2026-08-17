// Job types arrive as lowercase concatenated strings ("agavestorage") with no
// delimiter to split on, so correct display names need an explicit map. This is
// a finite set in the game; add pairs here as they are encountered.
const JOB_NAMES = {
  agavestorage: 'Agave storage',
intimidation: 'Intimidation',
arson: 'Arson',
gta: 'Grand Theft Auto',
transportdrugs: 'Transport Drugs',
farmrobbery: 'Farm Robbery',
cocapaste: 'Coca Paste Robbery',
blackmail: 'Blackmail',
hacking: 'Hacking',
}

export function jobLabel(raw) {
  if (!raw) return ''
  const key = String(raw).toLowerCase()
  if (JOB_NAMES[key]) return JOB_NAMES[key]
  // Fallback for anything not yet mapped: split camelCase or separators and
  // capitalize. Concatenated lowercase words cannot be split, so this only
  // tidies the casing until the exact name is added above.
  const spaced = String(raw)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
