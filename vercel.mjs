import { isIP } from 'node:net'

// The web app calls /api on its own origin. Vercel forwards those requests to
// the persistent API host; no customer data is stored in Vercel Functions.
const configuredApiOrigin = process.env.NAYLA_API_ORIGIN?.trim()
if (!configuredApiOrigin) {
  throw new Error('Configure NAYLA_API_ORIGIN com a origem HTTPS publica da API antes de implantar na Vercel.')
}

let apiUrl
try {
  apiUrl = new URL(configuredApiOrigin)
} catch {
  throw new Error('NAYLA_API_ORIGIN deve ser uma origem HTTPS valida, sem caminho ou barra final.')
}

const hostname = apiUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase()
if (apiUrl.protocol !== 'https:' || apiUrl.origin !== configuredApiOrigin ||
    apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' ||
    apiUrl.search || apiUrl.hash || apiUrl.port || isIP(hostname) ||
    !hostname.includes('.') || hostname === 'localhost' ||
    hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname.endsWith('.internal')) {
  throw new Error('NAYLA_API_ORIGIN deve usar um dominio publico HTTPS, sem porta, caminho, credenciais, parametros ou barra final.')
}

// Keep the web security policy aligned with server/security.ts. The API
// continues to send its own headers and remains uncached behind the rewrite.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ')

export const config = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*', destination: `${apiUrl.origin}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      ],
    },
    { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }] },
  ],
}
