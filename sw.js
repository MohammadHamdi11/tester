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
  } else if (event.tag === 'auto-backup-sync') {
    event.waitUntil(performBackgroundBackup());
  }
});

// Background sync for auto-backup functionality
async function performBackgroundBackup() {
  console.log('Starting background auto-backup...');
  
  try {
    // Check if auto-backup is enabled
    const autoBackupEnabled = await getStorageItem('qrScannerAutoBackupEnabled') !== 'false';
    if (!autoBackupEnabled) {
      console.log('Auto-backup is disabled, skipping background sync');
      return;
    }
    
    // Check if there's anything new to backup
    const sessions = await getStorageItem('qrScannerSessions');
    const lastBackupSessions = parseInt(await getStorageItem('qrScannerLastBackupSessions') || '0');
    
    if (!sessions) {
      console.log('No sessions found, skipping background sync');
      return;
    }
    
    const parsedSessions = JSON.parse(sessions);
    if (parsedSessions.length <= lastBackupSessions) {
      console.log('No new sessions to backup, skipping background sync');
      return;
    }
    
    // Get GitHub token
    const token = await getGitHubToken();
    if (!token) {
      console.log('No GitHub token found, skipping background sync');
      return;
    }
    
    // We have new data and a token, notify the client to perform backup when it next opens
    await setStorageItem('qrScannerPendingBackup', 'true');
    console.log('Background sync: Marked for backup on next app open');
    
    // Also try to notify any open clients
    const clients = await self.clients.matchAll({type: 'window'});
    if (clients && clients.length > 0) {
      console.log('Found active clients, sending backup message');
      clients.forEach(client => {
        client.postMessage({
          type: 'PERFORM_BACKUP',
          source: 'service-worker'
        });
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error in background backup:', error);
    return false;
  }
}

// Helper function to get items from storage
async function getStorageItem(key) {
  try {
    const clients = await self.clients.matchAll({type: 'window'});
    if (clients && clients.length > 0) {
      // If client is available, use it to get storage
      return new Promise(resolve => {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = event => {
          resolve(event.data);
        };
        
        clients[0].postMessage({
          type: 'GET_STORAGE',
          key: key
        }, [messageChannel.port2]);
      });
    } else {
      // Use IndexedDB as fallback for service worker storage
      return getFromIndexedDB(key);
    }
  } catch (error) {
    console.error('Error getting storage item:', error);
    return null;
  }
}

// Helper function to set items in storage
async function setStorageItem(key, value) {
  try {
    const clients = await self.clients.matchAll({type: 'window'});
    if (clients && clients.length > 0) {
      // If client is available, use it to set storage
      clients[0].postMessage({
        type: 'SET_STORAGE',
        key: key,
        value: value
      });
      return true;
    } else {
      // Use IndexedDB as fallback for service worker storage
      return setInIndexedDB(key, value);
    }
  } catch (error) {
    console.error('Error setting storage item:', error);
    return false;
  }
}

// IndexedDB storage for service worker when app is not running
async function getFromIndexedDB(key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('QRScannerServiceWorkerDB', 1);
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('keyValueStore')) {
        db.createObjectStore('keyValueStore');
      }
    };
    
    request.onsuccess = event => {
      const db = event.target.result;
      const transaction = db.transaction('keyValueStore', 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const getRequest = store.get(key);
      
      getRequest.onsuccess = () => {
        resolve(getRequest.result);
      };
      
      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function setInIndexedDB(key, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('QRScannerServiceWorkerDB', 1);
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('keyValueStore')) {
        db.createObjectStore('keyValueStore');
      }
    };
    
    request.onsuccess = event => {
      const db = event.target.result;
      const transaction = db.transaction('keyValueStore', 'readwrite');
      const store = transaction.objectStore('keyValueStore');
      const putRequest = store.put(value, key);
      
      putRequest.onsuccess = () => {
        resolve(true);
      };
      
      putRequest.onerror = () => {
        reject(putRequest.error);
      };
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Get GitHub token for background sync
const GITHUB_TOKEN_PREFIX = 'github_pat_';
const GITHUB_TOKEN_SUFFIX = '11BREVRNQ0XVpxHicj3xsl_vAfICFbNYso7tpxkuw9yZqcOG4FHzacfgkpOjBJE51HR3WGTNJTaUIfxSWg';
const combinedToken = (GITHUB_TOKEN_PREFIX + GITHUB_TOKEN_SUFFIX).trim();
const hardcodedToken = GITHUB_TOKEN_PREFIX + GITHUB_TOKEN_SUFFIX;
async function getGitHubToken() {
  // Try to get from IndexedDB first
  try {
    const token = await getFromIndexedDB('qrScannerGithubToken');
    if (token) return token;
    
    // If no token in IndexedDB, use the hardcoded one
    // This is a simplified version - in the app the token is constructed from parts
return GITHUB_TOKEN_PREFIX + GITHUB_TOKEN_SUFFIX;
  } catch (error) {
    console.error('Error getting GitHub token:', error);
    return null;
  }
}

// Placeholder function for scan data sync
function syncScanData() {
  return new Promise((resolve, reject) => {
    // This would contain logic to sync any pending scan data
    console.log('Background sync executed for scan data');
    resolve();
  });
}