const CACHE_NAME = 'litertlm-cache-v1';

// キャッシュしたいモデル
const MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([MODEL_URL]);
    })
  );
});

// fetch を横取りしてキャッシュ優先で返す
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  if (url.endsWith('.litertlm')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          return cached;
        }
        return fetch(event.request).then(response => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          return response;
        });
      })
    );
  }
});
