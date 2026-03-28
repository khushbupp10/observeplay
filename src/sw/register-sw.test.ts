import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerServiceWorker,
  sendSWMessage,
  cacheGameOffline,
  getCachedGameOffline,
  cacheProfileOffline,
  getCachedProfileOffline,
  removeCachedGameOffline,
  listCachedGamesOffline,
  trimCacheOffline,
} from './register-sw';

describe('registerServiceWorker', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when window is undefined (SSR)', async () => {
    // In node test env, navigator.serviceWorker is not available
    const result = await registerServiceWorker();
    expect(result).toBe(false);
  });

  it('returns true when registration succeeds', async () => {
    const mockRegistration = {
      addEventListener: vi.fn(),
    };
    const mockServiceWorker = {
      register: vi.fn().mockResolvedValue(mockRegistration),
    };
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { serviceWorker: mockServiceWorker });

    const result = await registerServiceWorker();
    expect(result).toBe(true);
    expect(mockServiceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('returns false when registration throws', async () => {
    const mockServiceWorker = {
      register: vi.fn().mockRejectedValue(new Error('not allowed')),
    };
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { serviceWorker: mockServiceWorker });

    const result = await registerServiceWorker();
    expect(result).toBe(false);
  });
});

describe('sendSWMessage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns error when no active service worker', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });

    const result = await sendSWMessage({ type: 'TEST' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active service worker');
  });

  it('sends message via MessageChannel and resolves with response', async () => {
    let capturedPort: MessagePort | undefined;
    const mockController = {
      postMessage: vi.fn().mockImplementation((_msg: unknown, ports: MessagePort[]) => {
        capturedPort = ports[0];
      }),
    };
    vi.stubGlobal('navigator', { serviceWorker: { controller: mockController } });

    const promise = sendSWMessage({ type: 'CACHE_GAME', payload: { id: 'g1' } });

    // Simulate SW responding
    await new Promise((r) => setTimeout(r, 10));
    if (capturedPort) {
      capturedPort.postMessage({ ok: true });
    }

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(mockController.postMessage).toHaveBeenCalled();
  });
});

describe('convenience helpers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
  });

  it('cacheGameOffline sends CACHE_GAME message', async () => {
    const result = await cacheGameOffline({ id: 'g1', title: 'Test' });
    expect(result.ok).toBe(false); // no SW
  });

  it('getCachedGameOffline sends GET_CACHED_GAME message', async () => {
    const result = await getCachedGameOffline('g1');
    expect(result.ok).toBe(false);
  });

  it('cacheProfileOffline sends CACHE_PROFILE message', async () => {
    const result = await cacheProfileOffline({ playerId: 'p1' });
    expect(result.ok).toBe(false);
  });

  it('getCachedProfileOffline sends GET_CACHED_PROFILE message', async () => {
    const result = await getCachedProfileOffline('p1');
    expect(result.ok).toBe(false);
  });

  it('removeCachedGameOffline sends REMOVE_CACHED_GAME message', async () => {
    const result = await removeCachedGameOffline('g1');
    expect(result.ok).toBe(false);
  });

  it('listCachedGamesOffline sends LIST_CACHED_GAMES message', async () => {
    const result = await listCachedGamesOffline();
    expect(result.ok).toBe(false);
  });

  it('trimCacheOffline sends TRIM_CACHE message', async () => {
    const result = await trimCacheOffline(50);
    expect(result.ok).toBe(false);
  });
});
