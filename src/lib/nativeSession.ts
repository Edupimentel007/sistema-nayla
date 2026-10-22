import { Capacitor } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

export type SessionRole = 'owner' | 'client'
export const isNativeApp = Capacitor.isNativePlatform()

const sessionKey = (role: SessionRole) => `nayla-${role}-session`
const installationKey = 'nayla-installation-v1'
let installationPromise: Promise<string> | null = null

export async function nativeInstallationId(): Promise<string | null> {
  if (!isNativeApp) return null
  if (!installationPromise) installationPromise = (async () => {
    const stored = await SecureStorage.get(installationKey)
    if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored)) return stored
    const random = crypto.getRandomValues(new Uint8Array(32))
    const id = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('')
    await SecureStorage.set(installationKey, id)
    return id
  })().catch(error => { installationPromise = null; throw error })
  return installationPromise
}

export async function nativeSessionToken(role: SessionRole): Promise<string | null> {
  if (!isNativeApp) return null
  const value = await SecureStorage.get(sessionKey(role))
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
}

export async function saveNativeSession(role: SessionRole, token: string | undefined) {
  if (!isNativeApp) return
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new Error('O servidor não devolveu uma sessão válida para o app.')
  await SecureStorage.set(sessionKey(role), token)
}

export async function clearNativeSession(role: SessionRole) {
  if (isNativeApp) await SecureStorage.remove(sessionKey(role))
}
