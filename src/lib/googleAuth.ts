import { App as NativeApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { api, type GoogleCompletion } from './api'
import { isNativeApp, type SessionRole } from './nativeSession'

let pendingAppNonce = ''
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)))
  .map(value => value.toString(16).padStart(2, '0')).join('')

export function currentGoogleAppNonce() { return isNativeApp ? pendingAppNonce : undefined }
export function clearGoogleAppNonce() { pendingAppNonce = '' }

export async function beginGoogleLogin(role: SessionRole, remember: boolean, slug?: string): Promise<GoogleCompletion | null> {
  const appNonce = isNativeApp ? randomHex() : undefined
  pendingAppNonce = appNonce || ''
  const { authorizationUrl } = await api.googleStart({ role, slug, remember, appNonce })
  if (!isNativeApp) {
    window.location.assign(authorizationUrl)
    return null
  }

  let resolveTicket: (value: string) => void = () => {}
  let rejectTicket: (error: Error) => void = () => {}
  const ticketPromise = new Promise<string>((resolve, reject) => {
    resolveTicket = resolve
    rejectTicket = reject
  })
  let settled = false
  const appListener = await NativeApp.addListener('appUrlOpen', ({ url }) => {
    if (settled) return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'com.edupimentel.nayla:' || parsed.hostname !== 'auth') return
      if (parsed.searchParams.get('error') === 'cancelled')
        throw new Error('Entrada com Google cancelada. Você pode tentar novamente.')
      const ticket = parsed.searchParams.get('ticket')
      if (!ticket) throw new Error('O Google não retornou um acesso válido. Tente novamente.')
      settled = true
      resolveTicket(ticket)
    } catch (error) { settled = true; rejectTicket(error instanceof Error ? error : new Error('Retorno Google inválido.')) }
  })
  const browserListener = await Browser.addListener('browserFinished', () => {
    if (!settled) { settled = true; rejectTicket(new Error('Entrada com Google interrompida.')) }
  })
  const timeout = setTimeout(() => {
    if (!settled) { settled = true; rejectTicket(new Error('A entrada com Google expirou. Tente novamente.')) }
  }, 10 * 60_000)
  try {
    await Browser.open({ url: authorizationUrl })
    const ticket = await ticketPromise
    await Browser.close().catch(() => {})
    const result = await api.googleComplete(role, ticket, appNonce)
    return 'user' in result ? result : { ...result, googleTicket: ticket }
  } finally {
    clearTimeout(timeout)
    await appListener.remove()
    await browserListener.remove()
  }
}

export function readGoogleTicketFromUrl() {
  if (isNativeApp) return ''
  const url = new URL(window.location.href)
  const ticket = url.searchParams.get('google_ticket') || ''
  if (ticket) {
    url.searchParams.delete('google_ticket')
    window.history.replaceState(window.history.state, '', url.toString())
  }
  return ticket
}

export function readGoogleErrorFromUrl() {
  if (isNativeApp) return ''
  const url = new URL(window.location.href)
  const code = url.searchParams.get('google_error') || ''
  if (code) {
    url.searchParams.delete('google_error')
    window.history.replaceState(window.history.state, '', url.toString())
  }
  return code === 'cancelled' ? 'Entrada com Google cancelada. Você pode tentar novamente.' : ''
}
