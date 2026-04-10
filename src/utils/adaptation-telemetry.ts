/**
 * Client-side adaptation / feedback telemetry (localStorage).
 * Used for session review and aggregate stats in the data dashboard.
 */

const STORAGE_KEY = 'observeplay-adaptation-telemetry';
const MAX_ENTRIES = 200;

export type AdaptationTelemetryKind =
  | 'profile_adaptation'
  | 'feedback'
  | 'session_summary'
  | 'accept'
  | 'undo';

export interface AdaptationTelemetryEntry {
  id: string;
  timestamp: number;
  game: string;
  kind: AdaptationTelemetryKind;
  message: string;
  /** Optional structured payload for exports */
  meta?: Record<string, unknown>;
}

function loadRaw(): AdaptationTelemetryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AdaptationTelemetryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveRaw(entries: AdaptationTelemetryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore quota */
  }
}

export function recordAdaptationTelemetry(entry: Omit<AdaptationTelemetryEntry, 'id' | 'timestamp'> & { id?: string }): void {
  const full: AdaptationTelemetryEntry = {
    id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    game: entry.game,
    kind: entry.kind,
    message: entry.message,
    meta: entry.meta,
  };
  const next = [...loadRaw(), full];
  saveRaw(next);
}

export function listAdaptationTelemetry(limit = 50): AdaptationTelemetryEntry[] {
  return loadRaw().slice(-limit).reverse();
}

export function clearAdaptationTelemetry(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
