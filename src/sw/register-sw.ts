/**
 * Service Worker registration utility.
 *
 * Registers the service worker in production and provides a messaging
 * helper for caching games and profiles from the main thread.
 */

export interface SWMessage {
  type: string;
  payload?: unknown;
}

export interface SWResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Send a message to the active service worker and wait for a response.
 */
export function sendSWMessage(message: SWMessage): Promise<SWResponse> {
  return new Promise((resolve, reject) => {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) {
      resolve({ ok: false, error: 'No active service worker' });
      return;
    }

    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data as SWResponse);
    channel.port1.onmessageerror = () => reject(new Error('SW message error'));

    sw.postMessage(message, [channel.port2]);
  });
}

/**
 * Register the service worker. Call once on app startup.
 * Returns true if registration succeeded, false otherwise.
 */
export async function registerServiceWorker(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // New service worker activated — could notify user of update
          }
        });
      }
    });

    return true;
  } catch {
    console.warn('Service worker registration failed');
    return false;
  }
}

/** Cache a game spec for offline play. */
export function cacheGameOffline(gameSpec: { id: string; [key: string]: unknown }): Promise<SWResponse> {
  return sendSWMessage({ type: 'CACHE_GAME', payload: gameSpec });
}

/** Retrieve a cached game spec. */
export function getCachedGameOffline(gameId: string): Promise<SWResponse> {
  return sendSWMessage({ type: 'GET_CACHED_GAME', payload: { gameId } });
}

/** Cache an accessibility profile for offline use. */
export function cacheProfileOffline(profile: { playerId: string; [key: string]: unknown }): Promise<SWResponse> {
  return sendSWMessage({ type: 'CACHE_PROFILE', payload: profile });
}

/** Retrieve a cached accessibility profile. */
export function getCachedProfileOffline(playerId: string): Promise<SWResponse> {
  return sendSWMessage({ type: 'GET_CACHED_PROFILE', payload: { playerId } });
}

/** Remove a cached game. */
export function removeCachedGameOffline(gameId: string): Promise<SWResponse> {
  return sendSWMessage({ type: 'REMOVE_CACHED_GAME', payload: { gameId } });
}

/** List all cached games. */
export function listCachedGamesOffline(): Promise<SWResponse> {
  return sendSWMessage({ type: 'LIST_CACHED_GAMES' });
}

/** Trim the game asset cache to a max number of items. */
export function trimCacheOffline(maxItems = 100): Promise<SWResponse> {
  return sendSWMessage({ type: 'TRIM_CACHE', payload: { maxItems } });
}
