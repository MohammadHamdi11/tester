// Service Worker for QR Code Scanner PWA
const CACHE_NAME = 'qr-scanner-cache-v3'; // Incremented version
const APP_PREFIX = 'qr-scanner-';
const OFFLINE_URL = './offline.html';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
const urlsToCache = [
'./',
'./index.html',
'./sw.js',
'./manifest.json',
'./zxing.min.js',
'./usercredentials.json',
'./students_ids.xlsx',
'./Barcode-scanner-beep-sound.mp3',
'./favicon-96x96.png',
'./web-app-manifest-192x192.png',
'./web-app-manifest-512x512.png',
'./apple-touch-icon.png',
'./offline.html',
'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];
// Install event - cache assets
self.addEventListener('install', event => {
console.log('[Service Worker] Installing new service worker...');
event.waitUntil(
caches.open(CACHE_NAME)
.then(cache => {
console.log('[Service Worker] Cache opened, adding all URLs to cache');
return cache.addAll(urlsToCache)
.then(() => {
console.log('[Service Worker] All required resources have been cached');
return self.skipWaiting();
});
})
.catch(err => {
console.error('[Service Worker] Cache failed to open: ', err);
})
);
});
// Activate event - clean old caches
self.addEventListener('activate', event => {
console.log('[Service Worker] Activating new service worker...');
const cacheWhitelist = [CACHE_NAME];
event.waitUntil(
Promise.all([
// Clean up old caches
caches.keys().then(cacheNames => {
return Promise.all(
cacheNames
.filter(cacheName => cacheName.startsWith(APP_PREFIX) && !cacheWhitelist.includes(cacheName))
.map(cacheName => {
console.log('[Service Worker] Deleting outdated cache:', cacheName);
return caches.delete(cacheName);
})
);
}),
// Take control of all clients immediately
self.clients.claim()
])
.then(() => {
console.log('[Service Worker] Service Worker activated; now ready to handle fetches!');
})
);
});
// Helper function to determine if a resource should be cached
function shouldCache(url) {
// Don't cache API calls, analytics, etc.
if (url.includes('/api/') || 
url.includes('analytics') || 
url.includes('chrome-extension://')) {
return false;
}
return true;
}
// Improved fetch event - network first with intelligent caching
self.addEventListener('fetch', event => {
const requestUrl = new URL(event.request.url);
// Skip cross-origin requests except for our CDN resources
if (!requestUrl.origin.startsWith(self.location.origin) && 
!requestUrl.href.startsWith('https://cdnjs.cloudflare.com/')) {
return;
}
// Handle different caching strategies based on request type
if (event.request.mode === 'navigate') {
// For navigation requests, use network first with offline fallback
event.respondWith(
fetch(event.request)
.then(response => {
if (response && response.status === 200) {
const clonedResponse = response.clone();
caches.open(CACHE_NAME).then(cache => {
cache.put(event.request, clonedResponse);
});
}
return response;
})
.catch(() => {
console.log('[Service Worker] Serving offline page for navigation request');
return caches.match(OFFLINE_URL);
})
);
} else if (event.request.destination === 'image' || 
event.request.url.endsWith('.css') || 
event.request.url.endsWith('.js')) {
// For assets that rarely change, use cache first with network fallback
event.respondWith(
caches.match(event.request)
.then(cachedResponse => {
if (cachedResponse) {
return cachedResponse;
}
return fetch(event.request)
.then(response => {
if (!response || response.status !== 200 || response.type !== 'basic') {
return response;
}
if (shouldCache(event.request.url)) {
const responseToCache = response.clone();
caches.open(CACHE_NAME).then(cache => {
cache.put(event.request, responseToCache);
});
}
return response;
});
})
);
} else {
// For other requests, use network first, falling back to cache
event.respondWith(
fetch(event.request)
.then(response => {
// If we got a valid response, clone it and store in cache
if (response && response.status === 200 && shouldCache(event.request.url)) {
const responseToCache = response.clone();
caches.open(CACHE_NAME)
.then(cache => {
cache.put(event.request, responseToCache);
});
}
return response;
})
.catch(() => {
console.log('[Service Worker] Fetch failed, trying cache for:', event.request.url);
// If network fetch fails, try the cache
return caches.match(event.request)
.then(cachedResponse => {
if (cachedResponse) {
return cachedResponse;
}
// If resource isn't in cache, return empty response
return new Response('', {
status: 408,
statusText: 'Request timed out.'
});
});
})
);
}
});
// Handle background sync for offline data submission
self.addEventListener('sync', event => {
console.log('[Service Worker] Background sync event received:', event.tag);
if (event.tag === 'sync-scans') {
event.waitUntil(syncScanData());
} else if (event.tag === 'sync-backup') {
event.waitUntil(syncBackupData());
}
});
// Periodic cache cleanup
self.addEventListener('message', event => {
if (event.data && event.data.action === 'cleanupCache') {
event.waitUntil(cleanupCache());
}
});
// Periodic cache cleanup function
async function cleanupCache() {
const cache = await caches.open(CACHE_NAME);
const requests = await cache.keys();
const now = Date.now();
for (const request of requests) {
const response = await cache.match(request);
// Skip if no response or no headers
if (!response || !response.headers) continue;
// Check cache timestamp if available
const dateHeader = response.headers.get('date');
if (dateHeader) {
const cacheTime = new Date(dateHeader).getTime();
if (now - cacheTime > CACHE_DURATION) {
console.log('[Service Worker] Removing stale cache item:', request.url);
await cache.delete(request);
}
}
}
console.log('[Service Worker] Cache cleanup completed');
return true;
}
// Placeholder function for background sync
function syncScanData() {
return new Promise((resolve, reject) => {
// This would contain logic to sync any pending scan data
console.log('[Service Worker] Scan data background sync executed');
// Add offline scan data sync logic here
// For example, check IndexedDB for pending scans and submit them
resolve();
});
}
// New function for backup syncing
function syncBackupData() {
return new Promise((resolve, reject) => {
console.log('[Service Worker] Backup data background sync executed');
// Add logic to sync backup data when online
// For example, check for pending backups in storage and process them
resolve();
});
}
// Log service worker lifecycle events for easier debugging
console.log('[Service Worker] Service Worker registered');
