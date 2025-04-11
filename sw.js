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

// Placeholder function for background sync
function syncScanData() {
  return new Promise((resolve, reject) => {
    // This would contain logic to sync any pending scan data
    console.log('Background sync executed');
    resolve();
  });
}

// Handle background sync for auto backup
self.addEventListener('sync', event => {
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncScanData());
  } else if (event.tag === 'auto-backup') {
    event.waitUntil(performBackgroundBackup());
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

// Function to perform background backup
function performBackgroundBackup() {
  return new Promise(async (resolve, reject) => {
    console.log('Background auto-backup initiated');
    
    try {
      // Open all clients to find if any are already handling this
      const clients = await self.clients.matchAll({ type: 'window' });
      
      // If we have an active client, let it handle the backup
      if (clients.length > 0) {
        console.log('Found active client, delegating backup');
        // Sending message to client to handle backup
        clients.forEach(client => client.postMessage({
          command: 'perform-backup',
          timestamp: new Date().toISOString()
        }));
        resolve();
        return;
      }
      
      // If no clients are open, we need to perform backup directly
      console.log('No active clients, performing direct backup');
      
      // Get data from IndexedDB or localStorage
      const sessions = await getSessionsFromStorage();
      const autoBackupEnabled = await getAutoBackupSetting();
      const lastBackupSessions = await getLastBackupSessions();
      
      // Check if backup is needed
      if (!autoBackupEnabled || sessions.length <= lastBackupSessions) {
        console.log('No backup needed or auto-backup disabled');
        resolve();
        return;
      }
      
      // Perform backup to GitHub
      await performGitHubBackup(sessions);
      
      // Update last backup info
      await updateLastBackupInfo(sessions.length);
      
      console.log('Background backup completed successfully');
      resolve();
    } catch (error) {
      console.error('Background backup failed:', error);
      reject(error);
    }
  });
}

// Helper functions for background backup
async function getSessionsFromStorage() {
  try {
    // Try to access the Cache API first
    const cache = await caches.open('app-data');
    const response = await cache.match('sessions-data');
    
    if (response) {
      const data = await response.json();
      return data;
    }
    
    // Fall back to accessing localStorage via a client
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      // Request data from client
      return new Promise((resolve) => {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = event => {
          resolve(event.data);
        };
        
        clients[0].postMessage({
          command: 'get-sessions'
        }, [messageChannel.port2]);
      });
    }
    
    return [];
  } catch (error) {
    console.error('Error getting sessions from storage:', error);
    return [];
  }
}

async function getAutoBackupSetting() {
  try {
    const cache = await caches.open('app-data');
    const response = await cache.match('auto-backup-setting');
    
    if (response) {
      const data = await response.text();
      return data !== 'false';
    }
    
    return true; // Default to enabled
  } catch (error) {
    console.error('Error getting auto-backup setting:', error);
    return true;
  }
}

async function getLastBackupSessions() {
  try {
    const cache = await caches.open('app-data');
    const response = await cache.match('last-backup-sessions');
    
    if (response) {
      const data = await response.text();
      return parseInt(data || '0');
    }
    
    return 0;
  } catch (error) {
    console.error('Error getting last backup sessions:', error);
    return 0;
  }
}

async function performGitHubBackup(sessions) {
  // This is a placeholder. In a real implementation, you'd need to:
  // 1. Get the GitHub token
  // 2. Convert sessions to Excel format
  // 3. Make the API call to GitHub
  
  console.log('Would perform GitHub backup here if this was implemented fully');
  
  // In practice, this is challenging from a service worker context
  // and would likely be delegated to a client
  return true;
}

async function updateLastBackupInfo(sessionCount) {
  try {
    const cache = await caches.open('app-data');
    await cache.put('last-backup-sessions', new Response(sessionCount.toString()));
    await cache.put('last-backup-time', new Response(new Date().toISOString()));
    return true;
  } catch (error) {
    console.error('Error updating last backup info:', error);
    return false;
  }
}