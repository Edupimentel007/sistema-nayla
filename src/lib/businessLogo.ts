import { isNativeApp, nativeSessionToken } from './nativeSession'

function apiOrigin() {
  if (!isNativeApp) return ''
  const origin = import.meta.env.VITE_API_ORIGIN?.trim() || ''
  if (!/^https:\/\/[^/]+$/.test(origin))
    throw new Error('Configure o endereço HTTPS da API para usar a logo no app instalado.')
  return origin
}

export function businessLogoSrc(logoUrl?: string | null) {
  if (!logoUrl) return ''
  return `${apiOrigin()}${logoUrl}`
}

export function validateBusinessLogoFile(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 1024 * 1024)
    return 'Escolha uma imagem PNG, JPEG ou WebP de até 1 MB.'
  return null
}

async function logoRequest(method: 'POST' | 'DELETE', file?: File) {
  const token = await nativeSessionToken('owner')
  const response = await fetch(`${apiOrigin()}/api/business/logo`, {
    method,
    credentials: isNativeApp ? 'omit' : 'include',
    headers: {
      ...(file ? { 'Content-Type': file.type } : {}),
      ...(isNativeApp ? { 'X-Nayla-App': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {}),
    },
    body: file,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || 'Não foi possível atualizar a logo. Tente novamente.')
  }
  return response.json() as Promise<{ logoUrl: string | null }>
}

export function uploadBusinessLogo(file: File) { return logoRequest('POST', file) }
export function deleteBusinessLogo() { return logoRequest('DELETE') }
