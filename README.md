# CE Companion
An unofficial companion app for Cartel Empire. It reads your account through the official game API and shows what needs your attention now: status, life and energy, cooldowns, finances, and running operations. Local-first and single device. Your API key is stored only on your phone.

# Developed by Cinyx.


# Stack
Capacitor 8 (Android)
Vite (build)
Vanilla JS, ES modules, no framework
@aparajita/capacitor-secure-storage` for the key (Keystore, AES-GCM)

`CapacitorHttp` from `@capacitor/core` for native requests (no CORS, real response headers for the rate governor later)

# Notifications
Notifications come in two kinds.   Scheduled   alerts have a known future time and fire whether the app is open or closed, with no background polling.

Detection alerts depend on something changing and can only fire while the app is active (a fetch or a resume), because predicting them from one snapshot is not possible.

# Scheduled:
- Each cooldown (drug, medical, booster) at 20h, 15h, 10h, 5h, 1h, and 15m remaining, plus a "ready" alert. Steps already in the past are skipped.

- Hospital and jail release at 10m, 5m, and 2m remaining, plus a "released" alert, only while actually confined.

Job completion and each expedition return.

# Detection (app active only):
- Life and energy reaching full, fired once on the transition to full. Firing this while the app is closed would require an energy-fill timestamp from the API; if `/user` exposes one, it can become a scheduled alert instead.

 Everything is rescheduled from fresh data on every successful fetch, including on resume, so alerts always match the latest state. On first connect the app asks for notification permission (required on Android 13+); if declined, the dashboard still works and scheduling is skipped. The dashboard also has a Test alert button that fires a notification about eight seconds out, so delivery can be verified without waiting on a real timer.



# Settings and auto-refresh
A settings sheet (the gear in the header) controls:
- Auto-refresh interval: Off, 5s, 10s, 30s, 60s. The dashboard silently refetches on that interval while open, which also keeps notification schedules fresh.
- Notifications: a master on/off. Off cancels everything pending.
- All requests pass through a governor that tracks the 200-per-minute budget in a rolling window and backs off on a 429 using the Retry-After header. The auto-refresh loop asks the governor before each poll.


# Legal
Unofficial and not affiliated with Cartel Empire. Uses the game's official API with a key you supply. The key stays on your device.

