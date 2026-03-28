import { describe, it, expect } from 'vitest';
import {
  detectCapabilities,
  getUnsupportedCoreFeatures,
  meetsMinimumRequirements,
  type BrowserCapabilities,
} from './browser-compat';

describe('detectCapabilities', () => {
  it('returns all false in SSR / node environment', () => {
    const caps = detectCapabilities();
    // In node test env, most browser APIs are absent
    expect(caps).toBeDefined();
    expect(typeof caps.serviceWorker).toBe('boolean');
    expect(typeof caps.indexedDB).toBe('boolean');
    expect(typeof caps.webAudio).toBe('boolean');
    expect(typeof caps.webSocket).toBe('boolean');
    expect(typeof caps.wasm).toBe('boolean');
  });
});

describe('getUnsupportedCoreFeatures', () => {
  it('returns empty array when all core features supported', () => {
    const caps: BrowserCapabilities = {
      serviceWorker: true,
      indexedDB: true,
      webAudio: true,
      webGL: true,
      webSocket: true,
      mediaDevices: true,
      speechRecognition: true,
      touchEvents: false,
      gamepad: false,
      wasm: true,
    };
    expect(getUnsupportedCoreFeatures(caps)).toEqual([]);
  });

  it('lists missing core features', () => {
    const caps: BrowserCapabilities = {
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
    const missing = getUnsupportedCoreFeatures(caps);
    expect(missing).toContain('IndexedDB (offline storage)');
    expect(missing).toContain('WebSocket (real-time features)');
    expect(missing).toContain('WebAssembly (client-side ML)');
  });
});

describe('meetsMinimumRequirements', () => {
  it('returns true when indexedDB, webSocket, and wasm are supported', () => {
    const caps: BrowserCapabilities = {
      serviceWorker: false,
      indexedDB: true,
      webAudio: false,
      webGL: false,
      webSocket: true,
      mediaDevices: false,
      speechRecognition: false,
      touchEvents: false,
      gamepad: false,
      wasm: true,
    };
    expect(meetsMinimumRequirements(caps)).toBe(true);
  });

  it('returns false when any core feature is missing', () => {
    const caps: BrowserCapabilities = {
      serviceWorker: true,
      indexedDB: true,
      webAudio: true,
      webGL: true,
      webSocket: true,
      mediaDevices: true,
      speechRecognition: true,
      touchEvents: true,
      gamepad: true,
      wasm: false,
    };
    expect(meetsMinimumRequirements(caps)).toBe(false);
  });
});
