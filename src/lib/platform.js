// The single place that touches Capacitor. Everything else imports from here,
// so swapping a plugin or adjusting native behaviour happens in one file.

import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { App } from '@capacitor/app'

export function isNative() {
  return Capacitor.isNativePlatform()
}

/* HTTP -------------------------------------------------------------- */
// On device, CapacitorHttp issues the request natively. That bypasses the
// WebView CORS policy (the game API will not send CORS headers for our origin)
// and exposes response headers, which the rate governor will read later.
// In a plain browser we fall back to fetch; requests to the game API will fail
// CORS there. That is expected. Test networking on a device build.
export async function httpGet(url, requestHeaders) {
  if (isNative()) {
    const options = { url }
    if (requestHeaders) options.headers = requestHeaders
    const res = await CapacitorHttp.get(options)
    // CapacitorHttp only auto-parses when it recognizes the content type. The
    // game API does not always trigger that, so the body can arrive as a raw
    // JSON string. Parse it here so the rest of the app always sees an object.
    let data = res.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (e) {
        // Not JSON: leave the string as-is for the caller to handle.
      }
    }
    return {
      status: res.status,
      data,
      headers: res.headers || {}
    }
  }

  const res = await fetch(url, { method: 'GET', headers: requestHeaders || {} })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    data = text
  }
  const headers = {}
  res.headers.forEach((value, key) => {
    headers[key] = value
  })
  return { status: res.status, data, headers }
}

/* Secure storage ---------------------------------------------------- */
// aparajita SecureStorage: Android Keystore (AES-GCM) on device, localStorage
// on web for development only. get() resolves to null when a key is absent.
export async function secureGet(name) {
  try {
    const value = await SecureStorage.get(name)
    return value == null ? null : String(value)
  } catch (e) {
    return null
  }
}

export async function secureSet(name, value) {
  await SecureStorage.set(name, value)
}

export async function secureRemove(name) {
  try {
    await SecureStorage.remove(name)
  } catch (e) {
    // Absent or unsupported: nothing to do.
  }
}

/* App lifecycle ----------------------------------------------------- */
// Fires when the app returns to the foreground. Used to refresh stale data.
export function onResume(callback) {
  try {
    App.addListener('resume', callback)
  } catch (e) {
    // Not on a native platform.
  }
}

// Fires when the app leaves the foreground.
export function onPause(callback) {
  try {
    App.addListener('pause', callback)
  } catch (e) {
    // Not on a native platform.
  }
}
