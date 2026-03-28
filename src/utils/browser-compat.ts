/**
 * Browser compatibility utilities.
 *
 * Detects feature support and provides fallbacks for the last 2 major
 * versions of Chrome, Firefox, Safari, and Edge.
 */

export interface BrowserCapabilities {
  serviceWorker: boolean;
  indexedDB: boolean;
  webAudio: boolean;
  webGL: boolean;
  webSocket: boolean;
  mediaDevices: boolean;
  speechRecognition: boolean;
  touchEvents: boolean;
  gamepad: boolean;
  wasm: boolean;
}

/**
 * Detect which platform features the current browser supports.
 * Safe to call in SSR (returns all false).
 */
export function detectCapabilities(): BrowserCapabilities {
  if (typeof window === 'undefined') {
    return {
      serviceWorker: false,
      indexedDB: false,
      webAudio: false,
      webGL: false,
      webSocket: false,
      mediaDevices: false,
      speechRecognition: false,
      touchEvents: false,
      gamepad: false,
      wasm: false,
    };
  }

  return {
    serviceWorker: 'serviceWorker' in navigator,
    indexedDB: 'indexedDB' in window,
    webAudio: 'AudioContext' in window || 'webkitAudioContext' in window,
    webGL: (() => {
      try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
      } catch {
        return false;
      }
    })(),
    webSocket: 'WebSocket' in window,
    mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    speechRecognition: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    touchEvents: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    gamepad: 'getGamepads' in navigator,
    wasm: typeof WebAssembly === 'object',
  };
}

/**
 * Returns a list of unsupported features that are required for core functionality.
 */
export function getUnsupportedCoreFeatures(caps: BrowserCapabilities): string[] {
  const missing: string[] = [];
  if (!caps.indexedDB) missing.push('IndexedDB (offline storage)');
  if (!caps.webSocket) missing.push('WebSocket (real-time features)');
  if (!caps.wasm) missing.push('WebAssembly (client-side ML)');
  return missing;
}

/**
 * Check if the browser meets minimum requirements for the platform.
 */
export function meetsMinimumRequirements(caps: BrowserCapabilities): boolean {
  return caps.indexedDB && caps.webSocket && caps.wasm;
}
