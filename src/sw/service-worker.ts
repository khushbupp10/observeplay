/**
 * Service Worker for Accessible Gaming Platform PWA.
 *
 * Strategies:
 *  - Cache-first for static assets and previously generated game assets
 *  - Network-first for API calls
 *  - IndexedDB for GameSpec and AccessibilityProfile offline storage
 */

/* eslint-disable no-restricted-globals */

// Service Worker types — these only exist in the SW global scope.
// We declare minimal shapes so the file compiles under the default tsconfig
// (which uses "dom" lib, not "webworker").
interface SWGlobalScope {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: string, listener: (event: never) => void): void;
}

interface SWExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SWFetchEvent extends Event {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface SWExtendableMessageEvent extends Event {
  data: { type?: string; payload?: Record<string, unknown> };
  ports?: MessagePort[];
}

const _self =
  typeof self !== 'undefined' ? (self as unknown as SWGlobalScope) : undefined;

const CACHE_NAME = 'agp-cache-v1';
const STATIC_CACHE = 'agp-static-v1';
const GAME_ASSET_CACHE = 'agp-game-assets-v1';

const DB_NAME = 'agp-offline';
const DB_VERSION = 1;
const GAME_STORE = 'games';
const PROFILE_STORE = 'profiles';

/** Max cache size in bytes (50 MB) */
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

// ─── IndexedDB helpers ───

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GAME_STORE)) {
        db.createObjectStore(GAME_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE, { keyPath: 'playerId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}


// ─── Cache helpers ───

const STATIC_ASSETS = ['/', '/manifest.json'];

async function precacheStatic(): Promise<void> {
  const cache = await caches.open(STATIC_CACHE);
  await cache.addAll(STATIC_ASSETS);
}

async function cacheFirstFetch(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstFetch(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', message: 'No cached data available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Cache invalidation ───

async function evictOldEntries(): Promise<void> {
  const cacheNames = await caches.keys();
  const validCaches = [CACHE_NAME, STATIC_CACHE, GAME_ASSET_CACHE];
  for (const name of cacheNames) {
    if (!validCaches.includes(name)) {
      await caches.delete(name);
    }
  }
}

async function trimCache(cacheName: string, maxItems: number): Promise<void> {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    for (let i = 0; i < keys.length - maxItems; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// ─── Public API for caching games & profiles (called via postMessage) ───

async function cacheGame(gameSpec: { id: string; [key: string]: unknown }): Promise<void> {
  await idbPut(GAME_STORE, { ...gameSpec, cachedAt: Date.now() });
}

async function getCachedGame(gameId: string): Promise<unknown> {
  return idbGet(GAME_STORE, gameId);
}

async function cacheProfile(profile: { playerId: string; [key: string]: unknown }): Promise<void> {
  await idbPut(PROFILE_STORE, { ...profile, cachedAt: Date.now() });
}

async function getCachedProfile(playerId: string): Promise<unknown> {
  return idbGet(PROFILE_STORE, playerId);
}

async function removeCachedGame(gameId: string): Promise<void> {
  await idbDelete(GAME_STORE, gameId);
}

async function listCachedGames(): Promise<unknown[]> {
  return idbGetAll(GAME_STORE);
}

// ─── Event handlers ───

if (_self) {
  _self.addEventListener('install', (event: SWExtendableEvent) => {
    event.waitUntil(precacheStatic().then(() => _self.skipWaiting()));
  });

  _self.addEventListener('activate', (event: SWExtendableEvent) => {
    event.waitUntil(evictOldEntries().then(() => _self.clients.claim()));
  });

  _self.addEventListener('fetch', (event: SWFetchEvent) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // API calls: network-first
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(networkFirstFetch(request));
      return;
    }

    // Game assets: cache-first
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/games/')) {
      event.respondWith(cacheFirstFetch(request, GAME_ASSET_CACHE));
      return;
    }

    // Static assets: cache-first
    event.respondWith(cacheFirstFetch(request, STATIC_CACHE));
  });
}

function handleSWMessage(event: SWExtendableMessageEvent) {
  const { type, payload } = event.data ?? {};

  const respond = (data: unknown) => {
    event.ports?.[0]?.postMessage(data);
  };

  const p = payload ?? {};

  switch (type) {
    case 'CACHE_GAME':
      cacheGame(p as { id: string; [key: string]: unknown }).then(() => respond({ ok: true })).catch((e) => respond({ ok: false, error: String(e) }));
      break;
    case 'GET_CACHED_GAME':
      getCachedGame(String(p.gameId ?? '')).then((g) => respond({ ok: true, game: g })).catch((e) => respond({ ok: false, error: String(e) }));
      break;
    case 'CACHE_PROFILE':
      cacheProfile(p as { playerId: string; [key: string]: unknown }).then(() => respond({ ok: true })).catch((e) => respond({ ok: false, error: String(e) }));
      break;
    case 'GET_CACHED_PROFILE':
      getCachedProfile(String(p.playerId ?? '')).then((pr) => respond({ ok: true, profile: pr })).catch((e) => respond({ ok: false, error: String(e) }));
      break;
    case 'REMOVE_CACHED_GAME':
      removeCachedGame(String(p.gameId ?? '')).then(() => respond({ ok: true })).catch((e) => respond({ ok: false, error: String(e) }));
      break;
    case 'LIST_CACHED_GAMES':
      listCachedGames().then((games) => respond({ ok: true, games })).catch((e) => respond({ ok: false, error: String(e) }));
      break;
    case 'TRIM_CACHE':
      trimCache(GAME_ASSET_CACHE, typeof p.maxItems === 'number' ? p.maxItems : 100).then(() => respond({ ok: true })).catch((e) => respond({ ok: false, error: String(e) }));
      break;
    default:
      break;
  }
}

if (_self) {
  _self.addEventListener('message', handleSWMessage);
}

export {
  CACHE_NAME,
  STATIC_CACHE,
  GAME_ASSET_CACHE,
  DB_NAME,
  DB_VERSION,
  GAME_STORE,
  PROFILE_STORE,
  MAX_CACHE_BYTES,
  openDB,
  idbGet,
  idbPut,
  idbGetAll,
  idbDelete,
  cacheGame,
  getCachedGame,
  cacheProfile,
  getCachedProfile,
  removeCachedGame,
  listCachedGames,
  cacheFirstFetch,
  networkFirstFetch,
  evictOldEntries,
  trimCache,
};
