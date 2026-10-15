import 'dotenv/config'

const raw = process.env.VITE_API_ORIGIN?.trim()
let origin
try { origin = raw ? new URL(raw) : null } catch { /* invalid URL */ }

if (!origin || origin.origin !== raw ||
    (origin.protocol !== 'https:' &&
      !(process.env.NAYLA_MOBILE_DEV_HTTP === '1' && origin.protocol === 'http:'))) {
  console.error('Defina VITE_API_ORIGIN como a origem HTTPS pública da API antes de sincronizar o app nativo.')
  console.error('Para testar em emulador com HTTP local, use NAYLA_MOBILE_DEV_HTTP=1 somente no desenvolvimento.')
  process.exit(1)
}

console.log(`App nativo conectado à API: ${origin.origin}`)
