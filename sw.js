// Service Worker for QR Code Scanner PWA
const CACHE_NAME = 'qr-scanner-cache-v3';
const APP_PREFIX = 'qr-scanner-';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './jsQR.min.js',
  './usercredentials.json',
  './students_ids.xlsx',
  './Barcode-scanner-beep-sound.mp3',
  './sw.js',
  './icons/icon-152x152.png',
  './offline.html',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://unpkg.com/@zxing/library@latest'
];

// Install event - cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('Cache failed to open: ', err);
      })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => cacheName.startsWith(APP_PREFIX) && !cacheWhitelist.includes(cacheName))
          .map(cacheName => {
            console.log('Deleting outdated cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
    .then(() => {
      console.log('Service Worker activated; now ready to handle fetches!');
      return self.clients.claim();
    })
  );
});

// Fetch event - network first, falling back to cache
self.addEventListener('fetch', event => {
  // Skip cross-origin requests except those we need
  if (!event.request.url.startsWith(self.location.origin) && 
      !event.request.url.startsWith('https://cdnjs.cloudflare.com/') &&
      !event.request.url.startsWith('https://unpkg.com/')) {
    return;
  }

  // Handle API requests separately
  if (event.request.url.includes('api.github.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, responseToCache));
        }
        return response;
      })
      .catch(() => {
        // Return cached content or offline page
        return caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            if (event.request.mode === 'navigate') return caches.match('./offline.html');
            return new Response('', { status: 408, statusText: 'Request timed out.' });
          });
      })
  );
});

// Handle background sync
self.addEventListener('sync', event => {
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncScanData());
  }
});

async function syncScanData() {
  // Implement your actual sync logic here
  console.log('Background sync executed');
}
