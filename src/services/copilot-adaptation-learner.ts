/**
 * Copilot Adaptation Learner
 *
 * Learns which accessibility adaptations work for each player and determines
 * when to apply them proactively. Tracks accepted/undone adaptations per
 * player, per barrier type, per adaptation type across sessions.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import type {
  AdaptationHistory,
  AdaptationHistoryEntry,
  AdaptationModel,
  ProactiveRule,
  ProactiveDecision,
} from '../types/learning';
import type { BarrierEvent, AdaptationAction } from '../types/barrier';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum distinct sessions with acceptance before proactive application */
const PROACTIVE_SESSION_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Key for grouping outcomes by barrier + adaptation type */
interface OutcomeKey {
  barrierType: string;
  adaptationType: string;
}

/** Per-player in-memory state */
interface PlayerState {
  /** All recorded outcomes */
  entries: AdaptationHistoryEntry[];
  /** Adaptation types the player has explicitly disabled for proactive use */
  disabledAdaptationTypes: Set<string>;
  /** Cached model (invalidated on new outcomes or retrain) */
  model: AdaptationModel | null;
}

// ---------------------------------------------------------------------------
// Listener callback type for Profile Learner integration
// ---------------------------------------------------------------------------

/**
 * Callback invoked whenever the learner's model changes so that the
 * Profile Learner can incorporate adaptation preferences into the player's
 * AccessibilityProfile.
 *
 * Requirement 11.4 — share learned adaptation preferences with Profile Learner.
 */
export type AdaptationPreferenceListener = (
  playerId: string,
  preferences: Record<string, unknown>,
) => void;

// ---------------------------------------------------------------------------
// CopilotAdaptationLearner
// ---------------------------------------------------------------------------

export class CopilotAdaptationLearner {
  private players: Map<string, PlayerState> = new Map();
  private preferenceListeners: AdaptationPreferenceListener[] = [];

  // ── Listener registration ───────────────────────────────────────

  /**
   * Register a listener that will be called whenever adaptation preferences
   * change for a player. This is the integration point with Profile Learner.
   *
   * Requirement 11.4
   */
  onPreferenceChange(listener: AdaptationPreferenceListener): void {
    this.preferenceListeners.push(listener);
  }

  // ── Core API ────────────────────────────────────────────────────

  /**
   * Record the outcome of an adaptation (accepted or undone).
   *
   * Requirement 11.1 — build a model of which adaptations the player
   * accepts and which the player undoes.
   */
  recordOutcome(
    playerId: string,
    event: BarrierEvent,
    adaptation: AdaptationAction,
    accepted: boolean,
  ): void {
    const state = this.getOrCreatePlayerState(playerId);

    const entry: AdaptationHistoryEntry = {
      barrierType: event.type,
      adaptationType: adaptation.type,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      accepted,
    };

    state.entries.push(entry);
    // Invalidate cached model so next query rebuilds it
    state.model = null;

    // Notify listeners of updated preferences
    this.notifyListeners(playerId);
  }

  /**
   * Determine whether a proactive adaptation should be applied.
   *
   * Returns `apply: true` when the player has accepted the same adaptation
   * type for the same barrier type in ≥3 distinct sessions AND the player
   * has not disabled proactive application for that adaptation type.
   *
   * Requirement 11.2, 11.3
   */
  shouldApplyProactively(
    playerId: string,
    barrierType: string,
    adaptationType: string,
  ): ProactiveDecision {
    const state = this.players.get(playerId);

    if (!state) {
      return {
        apply: false,
        confidence: 0,
        sessionsObserved: 0,
        acceptanceRate: 0,
      };
    }

    // If the player disabled proactive for this adaptation type, always false
    if (state.disabledAdaptationTypes.has(adaptationType)) {
      const stats = this.computeStats(state.entries, barrierType, adaptationType);
      return {
        apply: false,
        confidence: 0,
        sessionsObserved: stats.sessionsObserved,
        acceptanceRate: stats.acceptanceRate,
      };
    }

    const stats = this.computeStats(state.entries, barrierType, adaptationType);

    return {
      apply: stats.acceptedSessionCount >= PROACTIVE_SESSION_THRESHOLD,
      confidence: stats.acceptanceRate,
      sessionsObserved: stats.sessionsObserved,
      acceptanceRate: stats.acceptanceRate,
    };
  }

  /**
   * Disable proactive application for a specific adaptation type.
   *
   * Requirement 11.3 — player can disable proactive application per
   * adaptation type.
   */
  disableProactive(playerId: string, adaptationType: string): void {
    const state = this.getOrCreatePlayerState(playerId);
    state.disabledAdaptationTypes.add(adaptationType);
    // Invalidate cached model
    state.model = null;

    this.notifyListeners(playerId);
  }

  /**
   * Deterministic retraining from historical data.
   *
   * Requirement 11.5 — same historical data → same proactive decisions.
   *
   * Replaces the player's current entries with the provided historical data
   * and rebuilds the model deterministically.
   */
  retrain(playerId: string, historicalData: AdaptationHistory[]): AdaptationModel {
    const state = this.getOrCreatePlayerState(playerId);

    // Merge all historical entries for this player
    const allEntries: AdaptationHistoryEntry[] = [];
    for (const history of historicalData) {
      allEntries.push(...history.entries);
    }

    // Sort deterministically by timestamp, then barrierType, then adaptationType
    allEntries.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.barrierType !== b.barrierType) return a.barrierType.localeCompare(b.barrierType);
      return a.adaptationType.localeCompare(b.adaptationType);
    });

    state.entries = allEntries;

    // Build model from sorted entries
    const model = this.buildModel(playerId, state);
    state.model = model;

    this.notifyListeners(playerId);

    return model;
  }

  // ── Query helpers (useful for testing / inspection) ─────────────

  /** Get the current adaptation model for a player. */
  getModel(playerId: string): AdaptationModel | null {
    const state = this.players.get(playerId);
    if (!state) return null;

    if (!state.model) {
      state.model = this.buildModel(playerId, state);
    }
    return state.model;
  }

  /** Get all recorded entries for a player. */
  getEntries(playerId: string): AdaptationHistoryEntry[] {
    return this.players.get(playerId)?.entries ?? [];
  }

  /** Get the set of disabled adaptation types for a player. */
  getDisabledTypes(playerId: string): string[] {
    const state = this.players.get(playerId);
    return state ? Array.from(state.disabledAdaptationTypes).sort() : [];
  }

  /**
   * Build adaptation preferences as a plain record suitable for merging
   * into an AccessibilityProfile's `learnedPreferences`.
   *
   * Requirement 11.4
   */
  getAdaptationPreferences(playerId: string): Record<string, unknown> {
    const model = this.getModel(playerId);
    if (!model) return {};

    const preferences: Record<string, unknown> = {};
    for (const rule of model.rules) {
      const key = `adaptation:${rule.barrierType}:${rule.adaptationType}`;
      preferences[key] = {
        isProactive: rule.isProactive,
        acceptanceRate: rule.acceptanceRate,
        sessionsObserved: rule.sessionsObserved,
        disabledByPlayer: rule.disabledByPlayer,
      };
    }
    return preferences;
  }

  // ── Private helpers ─────────────────────────────────────────────

  private getOrCreatePlayerState(playerId: string): PlayerState {
    let state = this.players.get(playerId);
    if (!state) {
      state = {
        entries: [],
        disabledAdaptationTypes: new Set(),
        model: null,
      };
      this.players.set(playerId, state);
    }
    return state;
  }

  /**
   * Compute statistics for a specific barrier/adaptation pair.
   */
  private computeStats(
    entries: AdaptationHistoryEntry[],
    barrierType: string,
    adaptationType: string,
  ): {
    sessionsObserved: number;
    acceptedSessionCount: number;
    acceptanceRate: number;
  } {
    const relevant = entries.filter(
      (e) => e.barrierType === barrierType && e.adaptationType === adaptationType,
    );

    if (relevant.length === 0) {
      return { sessionsObserved: 0, acceptedSessionCount: 0, acceptanceRate: 0 };
    }

    // Group by session — a session counts as "accepted" if the player
    // accepted at least one adaptation of this type in that session
    // and did not undo all of them.
    const sessionMap = new Map<string, { accepted: number; total: number }>();
    for (const entry of relevant) {
      const existing = sessionMap.get(entry.sessionId) ?? { accepted: 0, total: 0 };
      existing.total += 1;
      if (entry.accepted) existing.accepted += 1;
      sessionMap.set(entry.sessionId, existing);
    }

    const sessionsObserved = sessionMap.size;
    let acceptedSessionCount = 0;
    for (const [, counts] of sessionMap) {
      // Session counts as accepted if majority of outcomes were accepted
      if (counts.accepted > counts.total / 2) {
        acceptedSessionCount += 1;
      }
    }

    const acceptanceRate =
      sessionsObserved > 0 ? acceptedSessionCount / sessionsObserved : 0;

    return { sessionsObserved, acceptedSessionCount, acceptanceRate };
  }

  /**
   * Build a deterministic AdaptationModel from the player's current state.
   */
  private buildModel(playerId: string, state: PlayerState): AdaptationModel {
    // Collect unique barrier/adaptation pairs
    const pairMap = new Map<string, OutcomeKey>();
    for (const entry of state.entries) {
      const key = `${entry.barrierType}::${entry.adaptationType}`;
      if (!pairMap.has(key)) {
        pairMap.set(key, {
          barrierType: entry.barrierType,
          adaptationType: entry.adaptationType,
        });
      }
    }

    // Sort pairs deterministically for consistent output
    const sortedPairs = Array.from(pairMap.values()).sort((a, b) => {
      if (a.barrierType !== b.barrierType) return a.barrierType.localeCompare(b.barrierType);
      return a.adaptationType.localeCompare(b.adaptationType);
    });

    const rules: ProactiveRule[] = sortedPairs.map((pair) => {
      const stats = this.computeStats(state.entries, pair.barrierType, pair.adaptationType);
      const disabledByPlayer = state.disabledAdaptationTypes.has(pair.adaptationType);

      return {
        barrierType: pair.barrierType,
        adaptationType: pair.adaptationType,
        sessionsObserved: stats.sessionsObserved,
        acceptanceRate: stats.acceptanceRate,
        isProactive:
          !disabledByPlayer &&
          stats.acceptedSessionCount >= PROACTIVE_SESSION_THRESHOLD,
        disabledByPlayer,
      };
    });

    return {
      playerId,
      trainedAt: Date.now(),
      rules,
    };
  }

  /**
   * Notify all registered preference listeners of updated preferences.
   */
  private notifyListeners(playerId: string): void {
    const preferences = this.getAdaptationPreferences(playerId);
    for (const listener of this.preferenceListeners) {
      listener(playerId, preferences);
    }
  }
}
