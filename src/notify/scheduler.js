import { LocalNotifications } from '@capacitor/local-notifications'
import { isNative } from '../lib/platform.js'

// Local-notification helpers. The native foreground service is the sole notifier
// for live alerts (events, cooldowns, jail/hospital, vitals, chat). This module
// only handles two things that live on the JS side:
//   - cancelAll(): clears notifications an older build may have scheduled, so
//     upgrading users are not left with stale alarms.
//   - sendTestAlert(): fires one immediate notification to confirm the OS will
//     deliver notifications for this app. It checks the notification path only;
//     it does not exercise the background service, which is separate.

const TEST_ID = 999999

let permissionState = 'unknown'

async function ensurePermission() {
  if (!isNative()) return false
  if (permissionState === 'granted') return true
  if (permissionState === 'denied') return false
  try {
    let res = await LocalNotifications.checkPermissions()
    if (res.display === 'prompt' || res.display === 'prompt-with-rationale') {
      res = await LocalNotifications.requestPermissions()
    }
    permissionState = res.display === 'granted' ? 'granted' : 'denied'
    return permissionState === 'granted'
  } catch (e) {
    permissionState = 'denied'
    return false
  }
}

// Clear any pending notifications left by an older build that used JS scheduling.
// The service posts immediately and schedules nothing, so there is normally
// nothing pending; this is a one-time migration safety net.
export async function cancelAll() {
  if (!isNative()) return
  try {
    const pending = await LocalNotifications.getPending()
    const list = pending && pending.notifications ? pending.notifications : []
    if (list.length) {
      await LocalNotifications.cancel({ notifications: list.map((n) => ({ id: n.id })) })
    }
  } catch (e) {
    // Ignore.
  }
}

// Fire one immediate notification to confirm notifications are permitted and can
// be delivered. Live alerts come from the background service, which is separate.
export async function sendTestAlert() {
  if (!isNative()) return { ok: false, reason: 'not-native' }
  const granted = await ensurePermission()
  if (!granted) return { ok: false, reason: 'no-permission' }
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: TEST_ID,
          title: 'CE Companion',
          body: 'Test notification. If you can see this, notifications work.',
          autoCancel: true
        }
      ]
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'schedule-failed' }
  }
}
