# CE Companion

An unofficial companion app for the browser game Cartel Empire, for Android.
It reads your account through the official game API and shows what needs your
attention: status, cooldowns, finances, operations, your cartel roster and war
feed, revive readiness, armoury use, and chat. It can notify you of new activity
even while it is closed.

It is read-only, single-device, and local-first. Your API key is stored only on
your phone. Developed by Cinyx. The Cartel Empire admin has approved this app.

Status: public beta. Android only. There is no iOS build.

## Is it safe

A fair question, and you should never install an APK on trust. Here is exactly
what this app does and does not do.

- It is read-only. It cannot attack, spend, send, trade, or change anything on
  your account. It only reads and displays.
- Your API key is stored only on your device, in the Android Keystore
  (encrypted). It is only ever sent to the official Cartel Empire API at
  cartelempire.online. It is never sent to the developer or any third party, and
  never pooled with other users.
- There are no accounts, no analytics, no advertising, and no third-party
  servers. Nothing you do in the app is tracked or transmitted to the developer.
  The developer cannot see your key or your data.
- The full source is in this repository. You can read it, or build it yourself
  and compare (see Build from source).
- Every release APK is published here with its SHA-256 checksum so you can verify
  the file you downloaded is the one that was built.

Privacy policy: https://gist.github.com/CinyxCoding/cdffdb45743b48176a307fa062c91b9f

## Features

- ME and ACTIVITY: life and energy, cooldowns, finances, jobs, expeditions, and
  a paginated events feed, with live countdowns.
- WAR: your cartel roster with revive status, and a live attack feed with player
  names resolved from IDs.
- CARTEL:
  - Revive readiness. Hospitalised members ranked by their revive debuff, so you
    know who is actually worth reviving now. Each recent revive is a stacking
    penalty that expires after six hours; the app shows the stack, the penalty,
    and when it clears.
  - Armoury use. A per-member consumption tally with a date-range filter
    (12h / 24h / 7d / 30d / All), sorting, and a per-item filter. It keeps an
    on-device history so ranges reach past the live feed window.
  - Cartel activity. Territory, vault, role, and mission events in one feed.
- CHAT: read-only Global, Trade, and Cartel channels.
- Notifications: optional alerts for new events, cooldowns ending, jail and
  hospital release, and full life and energy, delivered even when the app is
  closed. Optional per-channel chat alerts. Job alerts are off by default.

## Install (beta)

Android only.

1. Download the latest APK from the Releases page of this repository.
2. Open the file. Android will ask to allow installing from this source. Allow
   it (you can revoke it afterwards).
3. Open CE Companion and paste a Cartel Empire API key. In the game, create one
   under Settings, API. A Private-All key is recommended, since it unlocks the
   full dashboard (including vault), the cartel roster, and cartel chat.

To verify the download, compare its SHA-256 against the value in the release
notes:

```
Get-FileHash app-release.apk -Algorithm SHA256      # Windows PowerShell
shasum -a 256 app-release.apk                        # macOS / Linux
```

## Build from source

Prerequisites:

- Node.js 18 or newer.
- Android Studio, which provides the Android SDK and a bundled Java runtime.
- Java 17 (or 11+). The Android build will fail on Java 8. If Gradle picks up an
  old Java, point it at Android Studio's runtime, for example on Windows:
  `setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"` then reopen the
  terminal.

Build:

```
npm install
npm run build
npx cap sync android
cd android
./gradlew assembleDebug        # a debug APK you can install directly
```

The debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

For a signed release APK, create a keystore and signing config first (see
SIGNING.md), then run `./gradlew assembleRelease`. The output is at
`android/app/build/outputs/apk/release/app-release.apk`.

The `android/` folder is committed, so a normal build uses `npx cap sync`. Do
not run `npx cap add android` on a clone; that regenerates native files.

## How it works

- Data. One combined request pulls the dashboard in a single call:
  `GET /api/user?type=basic,status,cooldowns,activities,money,events`. Cartel
  screens use `/api/cartel` selections, and chat uses `/api/chat`. Descriptions
  are sanitised before display; the API key is never written to logs.
- Rate limits. All general requests pass through a governor that stays inside the
  200-per-minute budget and backs off on a 429 using the Retry-After header.
  Chat has its own separate 3-per-minute governor. The app only ever reads, and
  respects the game's published limits.
- Notifications. A single native foreground service is the only notifier. When
  Notifications is on, it runs a small poll-and-alert loop and posts a permanent
  notification, which is what lets it keep polling while the app is closed. It
  holds a wake lock so polling continues with the screen off, and polls
  adaptively (roughly every 10s when active, backing off when quiet and under
  battery-saver). New events are detected with ETags; cooldown, jail, hospital,
  and vitals alerts come from state transitions. Chat alerts are background-only,
  and the service watches one enabled channel per cycle to stay under the chat
  limit. Because a wake lock uses more battery, turn Notifications off when you
  do not need alerts.

## Tech stack

- Capacitor 8 (Android)
- Vite 5 (build)
- Vanilla JS, ES modules, no framework
- `@aparajita/capacitor-secure-storage` for the key (Keystore, AES-GCM)
- `CapacitorHttp` from `@capacitor/core` for native requests
- `@capacitor/local-notifications` for the notification permission and test alert
- A native Java foreground service (`PollService`) and Capacitor plugin
  (`BackgroundPoller`) for background alerts

App package: `com.cecompanion`.

## Project layout

```
src/
  main.js              boot and screen routing (ME, ACTIVITY, WAR, CARTEL, CHAT)
  styles/              design tokens, components, layout
  lib/
    platform.js        the only file that touches Capacitor
    dom.js             textContent-safe element builder
    format.js          money and countdown helpers
    eventhtml.js       safe renderer for API event HTML (in-domain links only)
  api/
    client.js          dashboard fetch, error mapping
    governor.js        200-per-minute rate governor
    cartel.js          roster, attacks, cartel events (ETag-backed)
    names.js           resolve player names from IDs
    chat.js            chat fetch
    chatGovernor.js    separate 3-per-minute chat governor
    poller.js          bridge to the native background service
  store/
    keystore.js        save / load / wipe the key
    model.js           normalise the /user response
    cartelModel.js     parse roster, attacks, revives, armoury, activity
    history.js         on-device armoury-use history
    settings.js        persisted settings
  ui/
    login.js           connect screen
    result.js          ME / ACTIVITY dashboard, settings, privacy
    warconsole.js      WAR screen
    cartel.js          CARTEL screen
    chat.js            CHAT screen
    nav.js             tab bar
    widgets.js         shared UI helpers
  notify/scheduler.js  notification permission, test alert, legacy cleanup
android-plugin/        source for the native service and plugin
```

## Conventions

For anyone reading or contributing:

- Source files are pure ASCII. No em dashes, smart quotes, or emoji. The pound
  sign is written as `\u00A3` in JS so the source stays ASCII while rendering
  correctly.
- Cash fields are BIGINT delivered as strings. They are never converted to a JS
  number, which would corrupt values past 2^53. Grouping is done on the string.
- The API `desc` field is required and truncated to 30 characters by the server.
  It is set once in `src/api/client.js`.
- The API key is never written to a log.

## Legal

Unofficial and not affiliated with Cartel Empire. Used with the game admin's
permission. Cartel Empire and its assets belong to their respective owner. This
app uses the game's official public API with a key you supply, and that key
stays on your device.

## Contact

Questions, bugs, or feedback: cartelempire.ravage@gmail.com
