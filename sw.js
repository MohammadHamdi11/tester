// Service Worker for QR Code Scanner PWA
const CACHE_NAME = 'qr-scanner-cache-v2';
const APP_PREFIX = 'qr-scanner-';
const urlsToCache = [
  './',
  './index.html',
  './QRScanner.webapp.html', // If this is your main app file
  './sw.js',
  './manifest.json',
  './jsQR.min.js',
  './favicon-96x96.png',
  './web-app-manifest-192x192.png',
  './web-app-manifest-512x512.png',
  './apple-touch-icon.png',
  './offline.html',
  'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
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
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin) && 
      !event.request.url.startsWith('https://cdnjs.cloudflare.com/')) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If we got a valid response, clone it and store in cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        // If network fetch fails, try the cache
        return caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // If resource isn't in cache, return the offline page for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('./offline.html');
            }
            
            // Return empty response for other resources
            return new Response('', {
              status: 408,
              statusText: 'Request timed out.'
            });
          });
      })
  );
});

// Handle background sync for offline data submission
self.addEventListener('sync', event => {
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncScanData());
  }
});

// Post message to client when online status changes
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHECK_CONNECTIVITY') {
    const clients = self.clients.matchAll();
    clients.then(clientList => {
      clientList.forEach(client => {
        client.postMessage({
          type: 'CONNECTIVITY_STATUS',
          online: self.navigator.onLine
        });
      });
    });
  }
});

// Placeholder function for background sync
function syncScanData() {
  return new Promise((resolve, reject) => {
    // This would contain logic to sync any pending scan data
    console.log('Background sync executed');
    resolve();
  });
}