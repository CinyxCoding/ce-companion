import { secureGet, secureSet, secureRemove } from '../lib/platform.js'

// The one secret this app holds. Stored only on the device.
const KEY_NAME = 'ce_api_key'

export function loadKey() {
  return secureGet(KEY_NAME)
}

export function saveKey(key) {
  return secureSet(KEY_NAME, key)
}

export function wipeKey() {
  return secureRemove(KEY_NAME)
}
