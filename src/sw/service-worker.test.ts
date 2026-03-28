import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CACHE_NAME,
  STATIC_CACHE,
  GAME_ASSET_CACHE,
  DB_NAME,
  DB_VERSION,
  GAME_STORE,
  PROFILE_STORE,
  MAX_CACHE_BYTES,
} from './service-worker';

describe('Service Worker constants', () => {
  it('exports expected cache names', () => {
    expect(CACHE_NAME).toBe('agp-cache-v1');
    expect(STATIC_CACHE).toBe('agp-static-v1');
    expect(GAME_ASSET_CACHE).toBe('agp-game-assets-v1');
  });

  it('exports expected IndexedDB config', () => {
    expect(DB_NAME).toBe('agp-offline');
    expect(DB_VERSION).toBe(1);
    expect(GAME_STORE).toBe('games');
    expect(PROFILE_STORE).toBe('profiles');
  });

  it('sets max cache size to 50 MB', () => {
    expect(MAX_CACHE_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('Service Worker fetch strategies', () => {
  it('cacheFirstFetch returns cached response when available', async () => {
    const mockResponse = new Response('cached', { status: 200 });
    const mockCaches = {
      match: vi.fn().mockResolvedValue(mockResponse),
      open: vi.fn(),
    };
    vi.stubGlobal('caches', mockCaches);

    const { cacheFirstFetch } = await import('./service-worker');
    const request = new Request('https://example.com/asset.png');
    const result = await cacheFirstFetch(request, GAME_ASSET_CACHE);

    expect(result).toBe(mockResponse);
    expect(mockCaches.match).toHaveBeenCalledWith(request);
    vi.unstubAllGlobals();
  });

  it('cacheFirstFetch fetches and caches on miss', async () => {
    const networkResponse = new Response('fresh', { status: 200 });
    const mockCache = { put: vi.fn() };
    const mockCaches = {
      match: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(mockCache),
    };
    vi.stubGlobal('caches', mockCaches);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(networkResponse));

    const { cacheFirstFetch } = await import('./service-worker');
    const request = new Request('https://example.com/asset.png');
    const result = await cacheFirstFetch(request, GAME_ASSET_CACHE);

    expect(result).toBe(networkResponse);
    expect(mockCaches.open).toHaveBeenCalledWith(GAME_ASSET_CACHE);
    vi.unstubAllGlobals();
  });

  it('networkFirstFetch returns network response on success', async () => {
    const networkResponse = new Response('ok', { status: 200 });
    const mockCache = { put: vi.fn() };
    const mockCaches = {
      open: vi.fn().mockResolvedValue(mockCache),
      match: vi.fn(),
    };
    vi.stubGlobal('caches', mockCaches);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(networkResponse));

    const { networkFirstFetch } = await import('./service-worker');
    const request = new Request('https://example.com/api/data');
    const result = await networkFirstFetch(request);

    expect(result).toBe(networkResponse);
    vi.unstubAllGlobals();
  });

  it('networkFirstFetch falls back to cache on network failure', async () => {
    const cachedResponse = new Response('cached', { status: 200 });
    const mockCaches = {
      open: vi.fn(),
      match: vi.fn().mockResolvedValue(cachedResponse),
    };
    vi.stubGlobal('caches', mockCaches);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { networkFirstFetch } = await import('./service-worker');
    const request = new Request('https://example.com/api/data');
    const result = await networkFirstFetch(request);

    expect(result).toBe(cachedResponse);
    vi.unstubAllGlobals();
  });

  it('networkFirstFetch returns 503 when offline and no cache', async () => {
    const mockCaches = {
      open: vi.fn(),
      match: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('caches', mockCaches);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { networkFirstFetch } = await import('./service-worker');
    const request = new Request('https://example.com/api/data');
    const result = await networkFirstFetch(request);

    expect(result.status).toBe(503);
    const body = await result.json();
    expect(body.error).toBe('offline');
    vi.unstubAllGlobals();
  });
});

describe('Cache invalidation', () => {
  it('evictOldEntries removes unknown caches', async () => {
    const deletedCaches: string[] = [];
    const mockCaches = {
      keys: vi.fn().mockResolvedValue(['agp-cache-v1', 'agp-static-v1', 'old-cache-v0']),
      delete: vi.fn().mockImplementation((name: string) => {
        deletedCaches.push(name);
        return Promise.resolve(true);
      }),
    };
    vi.stubGlobal('caches', mockCaches);

    const { evictOldEntries } = await import('./service-worker');
    await evictOldEntries();

    expect(deletedCaches).toEqual(['old-cache-v0']);
    vi.unstubAllGlobals();
  });

  it('trimCache removes oldest entries when over limit', async () => {
    const deletedKeys: string[] = [];
    const keys = [
      new Request('https://example.com/1'),
      new Request('https://example.com/2'),
      new Request('https://example.com/3'),
    ];
    const mockCache = {
      keys: vi.fn().mockResolvedValue(keys),
      delete: vi.fn().mockImplementation((req: Request) => {
        deletedKeys.push(req.url);
        return Promise.resolve(true);
      }),
    };
    const mockCaches = {
      open: vi.fn().mockResolvedValue(mockCache),
    };
    vi.stubGlobal('caches', mockCaches);

    const { trimCache } = await import('./service-worker');
    await trimCache(GAME_ASSET_CACHE, 2);

    expect(deletedKeys).toHaveLength(1);
    expect(deletedKeys[0]).toContain('/1');
    vi.unstubAllGlobals();
  });
});
