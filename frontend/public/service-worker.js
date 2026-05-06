const CACHE_NAME = 'hivegate-ai-v2'
const APP_SHELL = ['/', '/manifest.webmanifest', '/hivegate-mark.svg']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/motion-api')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (request.method === 'GET' && response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request))
  )
})
