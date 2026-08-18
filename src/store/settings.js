// User settings, persisted in the WebView's localStorage (which survives app
// restarts in Capacitor). Non-sensitive, so this is separate from the secure
// keystore that holds the API key.

const STORAGE_KEY = 'ce_settings_v1'

// Allowed auto-refresh intervals in seconds. 0 means off (manual only). The
// smallest interval stays well inside the 200/min budget.
export const REFRESH_OPTIONS = [0, 5, 10, 30, 60]

const DEFAULTS = {
  refreshSeconds: 5,
  notifications: true,
  // Job completions are frequent and self-initiated, so they do not raise
  // notifications unless the user opts in. They still show in the events list.
  jobAlerts: false,
  // Per-category notification switches (only apply while notifications is on).
  notifEvents: true,
  notifDrug: true,
  notifMedical: true,
  notifBooster: true,
  notifJail: true,
  notifHospital: true,
  notifVitals: true,
  // Cooldowns notify only when they hit ready, with no countdown steps. This is
  // the quieter default; turn it off to also get the step reminders.
  cooldownReadyOnly: true,
  chatGlobal: false,
  chatTrade: false,
  chatCartel: false
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const merged = { ...DEFAULTS, ...parsed }
      if (!REFRESH_OPTIONS.includes(merged.refreshSeconds)) merged.refreshSeconds = DEFAULTS.refreshSeconds
      return merged
    }
  } catch (e) {
    // Corrupt or unavailable: fall back to defaults.
  }
  return { ...DEFAULTS }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    // Storage unavailable: settings simply will not persist this session.
  }
}
