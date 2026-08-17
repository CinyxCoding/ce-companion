import { registerPlugin } from '@capacitor/core'
import { isNative } from '../lib/platform.js'

// Bridges to the native BackgroundPoller plugin (Android foreground service).
// No-ops on web and if the native plugin is not present.
const BackgroundPoller = registerPlugin('BackgroundPoller')

// chatChannels is a comma list of channels to watch for new-message alerts
// (e.g. "cartel" or "cartel,global"); empty means no chat alerts.
export async function startBackgroundAlerts(key, muteJobs, chatChannels) {
  if (!isNative() || !key) return
  try {
    await BackgroundPoller.start({
      key,
      muteJobs: !!muteJobs,
      chatChannels: chatChannels || '',
      intervalActive: 10000,
      intervalIdle: 30000
    })
  } catch (e) {
    // Plugin missing or start failed; background alerts simply stay off.
  }
}

export async function stopBackgroundAlerts() {
  if (!isNative()) return
  try {
    await BackgroundPoller.stop()
  } catch (e) {
    // Ignore.
  }
}

// Chat alerts fire only while the app is backgrounded, so the foreground chat
// viewer and the service never poll chat at the same time. The app tells the
// service which state it is in.
export async function setChatForeground(foreground) {
  if (!isNative()) return
  try {
    await BackgroundPoller.setForeground({ foreground: !!foreground })
  } catch (e) {
    // Ignore.
  }
}
