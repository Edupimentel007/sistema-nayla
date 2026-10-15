import { Capacitor } from '@capacitor/core'

export function publicAppOrigin() {
  if (!Capacitor.isNativePlatform()) return window.location.origin
  const configured = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim() || import.meta.env.VITE_API_ORIGIN?.trim()
  if (!configured) return ''
  try {
    const url = new URL(configured)
    return url.protocol === 'https:' ? url.origin : ''
  } catch { return '' }
}

export function publicBookingLink(slug: string) {
  const origin = publicAppOrigin()
  return origin ? `${origin}/agendar/${encodeURIComponent(slug)}` : ''
}
