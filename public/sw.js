// Only immutable Vite JavaScript and CSS are cached. Navigation, API requests,
// account data and third-party requests always use the network.
const CACHE_NAME = 'nayla-static-v1'
const CACHE_PREFIX = 'nayla-static-'
const ASSET_PATH = /^\/assets\/[^/]+\.(?:js|css)$/

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.search || !ASSET_PATH.test(url.pathname)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    const type = response.headers.get('content-type') || ''
    if (response.ok && response.type === 'basic' &&
      (type.includes('javascript') || type.includes('text/css'))) {
      await cache.put(request, response.clone())
    }
    return response
  })())
})
