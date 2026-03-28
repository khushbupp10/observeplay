/**
 * Companion Learning Service
 *
 * Tracks player capability evolution across sessions and adjusts AI companion
 * behavior. Monitors mechanic success/failure, suggests control transfers,
 * detects struggling, and synchronizes with the Profile Learner.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import type {
  MechanicOutcome,
  TransferSuggestion,
  StrugglingDetection,
} from '../types/learning';
import type {
  CompanionPlayerModel,
  MechanicPerformanceRecord,
  SessionMechanicResult,
} from '../types/companion';
import type { AccessibilityProfile } from '../types/player';
import type { CommunicationChannel } from '../types/common';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of consecutive session successes before suggesting transfer to player */
const CONSECUTIVE_SUCCESS_THRESHOLD = 3;

/** Error rate threshold (fraction) above which a player is considered struggling */
const STRUGGLING_ERROR_RATE_THRESHOLD = 0.6;

/** Number of recent attempts to evaluate for struggling detection */
const STRUGGLING_ATTEMPT_WINDOW = 5;

// ---------------------------------------------------------------------------
// Listener callback type for Profile Learner integration
// ---------------------------------------------------------------------------

/**
 * Callback invoked whenever the companion's learned player model changes so
 * that the Profile Learner can incorporate companion insights into the
 * player's AccessibilityProfile.
 *
 * Requirement 12.5 — synchronize learned player model with Profile Learner.
 */
export type CompanionModelListener = (
  playerId: string,
  preferences: Record<string, unknown>,
) => void;

// ---------------------------------------------------------------------------
// CompanionLearningService
// ---------------------------------------------------------------------------

export class CompanionLearningService {
  private players: Map<string, CompanionPlayerModel> = new Map();
  private modelListeners: CompanionModelListener[] = [];

  // ── Listener registration ───────────────────────────────────────

  /**
   * Register a listener that will be called whenever the companion's learned
   * model changes for a player. This is the integration point with Profile
   * Learner.
   *
   * Requirement 12.5
   */
  onModelChange(listener: CompanionModelListener): void {
    this.modelListeners.push(listener);
  }

  // ── Core API ────────────────────────────────────────────────────

  /**
   * Track a mechanic outcome (success/failure) for a player in a session.
   *
   * Requirement 12.1 — track which game mechanics the player handles
   * independently and which require AI Companion assistance.
   */
  trackPerformance(
    playerId: string,
    mechanicId: string,
    outcome: MechanicOutcome,
  ): void {
    const model = this.getOrCreatePlayerModel(playerId);
    let record = model.mechanicPerformance.find(
      (r) => r.mechanicId === mechanicId,
    );

    if (!record) {
      record = {
        mechanicId,
        controlledBy: 'player',
        sessionResults: [],
      };
      model.mechanicPerformance.push(record);
    }

    // Find or create session result for this session
    let sessionResult = record.sessionResults.find(
      (sr) => sr.sessionId === outcome.sessionId,
    );

    if (!sessionResult) {
      sessionResult = {
        sessionId: outcome.sessionId,
        attempts: 0,
        successes: 0,
        errorRate: 0,
        timestamp: outcome.timestamp,
      };
      record.sessionResults.push(sessionResult);
    }

    sessionResult.attempts += 1;
    if (outcome.success) {
      sessionResult.successes += 1;
    }
    sessionResult.errorRate =
      sessionResult.attempts > 0
        ? (sessionResult.attempts - sessionResult.successes) / sessionResult.attempts
        : 0;
    sessionResult.timestamp = Math.max(sessionResult.timestamp, outcome.timestamp);

    this.notifyListeners(playerId);
  }

  /**
   * Suggest control transfers based on learned performance data.
   *
   * Requirement 12.2 — suggest "to_player" when player succeeded in 3
   * consecutive sessions for a mechanic previously handled by companion.
   *
   * Requirement 12.3 — suggest "to_companion" when error rate >60% over
   * last 5 attempts.
   */
  suggestTransfer(playerId: string): TransferSuggestion[] {
    const model = this.players.get(playerId);
    if (!model) return [];

    const suggestions: TransferSuggestion[] = [];

    for (const record of model.mechanicPerformance) {
      // Check for "to_player" transfer: companion-controlled mechanic with
      // 3 consecutive session successes
      if (record.controlledBy === 'companion') {
        const consecutiveSuccesses = this.countConsecutiveSessionSuccesses(record);
        if (consecutiveSuccesses >= CONSECUTIVE_SUCCESS_THRESHOLD) {
          suggestions.push({
            mechanicId: record.mechanicId,
            direction: 'to_player',
            consecutiveSuccesses,
            confidence: Math.min(consecutiveSuccesses / (CONSECUTIVE_SUCCESS_THRESHOLD + 2), 1),
          });
        }
      }

      // Check for "to_companion" transfer: player-controlled mechanic with
      // error rate >60% over last 5 attempts
      if (record.controlledBy === 'player') {
        const struggling = this.computeStruggling(record);
        if (struggling.isStruggling) {
          suggestions.push({
            mechanicId: record.mechanicId,
            direction: 'to_companion',
            errorRate: struggling.errorRate,
            confidence: Math.min(struggling.errorRate, 1),
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Detect if a player is struggling with a specific mechanic.
   *
   * Requirement 12.3 — error rate above 60% over 5 attempts.
   */
  detectStruggling(
    playerId: string,
    mechanicId: string,
  ): StrugglingDetection {
    const model = this.players.get(playerId);
    if (!model) {
      return {
        mechanicId,
        isStruggling: false,
        errorRate: 0,
        recentAttempts: 0,
        recommendation: 'No performance data available',
      };
    }

    const record = model.mechanicPerformance.find(
      (r) => r.mechanicId === mechanicId,
    );

    if (!record) {
      return {
        mechanicId,
        isStruggling: false,
        errorRate: 0,
        recentAttempts: 0,
        recommendation: 'No performance data available for this mechanic',
      };
    }

    return this.computeStruggling(record);
  }

  /**
   * Synchronize the companion's learned player model with the Profile Learner.
   *
   * Requirement 12.5 — ability changes detected by either subsystem are
   * reflected across the Platform.
   */
  async syncWithProfileLearner(playerId: string): Promise<void> {
    const preferences = this.getCompanionPreferences(playerId);
    for (const listener of this.modelListeners) {
      listener(playerId, preferences);
    }
  }

  // ── Communication style adaptation ──────────────────────────────

  /**
   * Determine the appropriate communication channel based on the player's
   * AccessibilityProfile.
   *
   * Requirement 12.4 — adapt communication style:
   * - audio-only for blind players (hearingCapability != 'none' and
   *   preferredInstructionFormat == 'audio')
   * - shorter text for cognitive accessibility (slow pacing or low
   *   maxSimultaneousElements)
   * - player's preferred channel otherwise
   */
  adaptCommunicationStyle(
    profile: AccessibilityProfile,
    preferredChannel: CommunicationChannel,
  ): { channel: CommunicationChannel; useShortMessages: boolean } {
    // Blind players: use audio-only (speech) when they can hear
    if (
      profile.preferredInstructionFormat === 'audio' &&
      profile.hearingCapability !== 'none'
    ) {
      return { channel: 'speech', useShortMessages: false };
    }

    // Cognitive accessibility: shorter text messages
    const needsShorterText =
      profile.preferredPacing === 'slow' ||
      profile.maxSimultaneousElements <= 3;

    return {
      channel: preferredChannel,
      useShortMessages: needsShorterText,
    };
  }

  // ── Query helpers ───────────────────────────────────────────────

  /** Get the companion player model for a player. */
  getPlayerModel(playerId: string): CompanionPlayerModel | null {
    return this.players.get(playerId) ?? null;
  }

  /** Set the controlledBy field for a mechanic. */
  setMechanicControl(
    playerId: string,
    mechanicId: string,
    controlledBy: 'player' | 'companion',
  ): void {
    const model = this.getOrCreatePlayerModel(playerId);
    let record = model.mechanicPerformance.find(
      (r) => r.mechanicId === mechanicId,
    );

    if (!record) {
      record = {
        mechanicId,
        controlledBy,
        sessionResults: [],
      };
      model.mechanicPerformance.push(record);
    } else {
      record.controlledBy = controlledBy;
    }

    this.notifyListeners(playerId);
  }

  /**
   * Build companion preferences as a plain record suitable for merging
   * into an AccessibilityProfile's `learnedPreferences`.
   *
   * Requirement 12.5
   */
  getCompanionPreferences(playerId: string): Record<string, unknown> {
    const model = this.players.get(playerId);
    if (!model) return {};

    const preferences: Record<string, unknown> = {};
    for (const record of model.mechanicPerformance) {
      const key = `companion:${record.mechanicId}`;
      const recentResults = this.getRecentAttempts(record);
      preferences[key] = {
        controlledBy: record.controlledBy,
        totalSessions: record.sessionResults.length,
        recentErrorRate: recentResults.errorRate,
        recentAttempts: recentResults.totalAttempts,
      };
    }
    return preferences;
  }

  // ── Private helpers ─────────────────────────────────────────────

  private getOrCreatePlayerModel(playerId: string): CompanionPlayerModel {
    let model = this.players.get(playerId);
    if (!model) {
      model = {
        playerId,
        mechanicPerformance: [],
        lastSyncedWithProfileLearner: 0,
      };
      this.players.set(playerId, model);
    }
    return model;
  }

  /**
   * Count consecutive session successes (error rate = 0) from the most
   * recent sessions backwards.
   */
  private countConsecutiveSessionSuccesses(
    record: MechanicPerformanceRecord,
  ): number {
    if (record.sessionResults.length === 0) return 0;

    // Sort by timestamp descending to check most recent first
    const sorted = [...record.sessionResults].sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    let count = 0;
    for (const result of sorted) {
      if (result.attempts > 0 && result.errorRate === 0) {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Compute struggling detection for a mechanic performance record.
   * Looks at the last STRUGGLING_ATTEMPT_WINDOW attempts across sessions.
   */
  private computeStruggling(
    record: MechanicPerformanceRecord,
  ): StrugglingDetection {
    const recent = this.getRecentAttempts(record);

    if (recent.totalAttempts < STRUGGLING_ATTEMPT_WINDOW) {
      return {
        mechanicId: record.mechanicId,
        isStruggling: false,
        errorRate: recent.errorRate,
        recentAttempts: recent.totalAttempts,
        recommendation:
          `Not enough data yet (${recent.totalAttempts}/${STRUGGLING_ATTEMPT_WINDOW} attempts)`,
      };
    }

    const isStruggling = recent.errorRate > STRUGGLING_ERROR_RATE_THRESHOLD;

    return {
      mechanicId: record.mechanicId,
      isStruggling,
      errorRate: recent.errorRate,
      recentAttempts: recent.totalAttempts,
      recommendation: isStruggling
        ? 'AI Companion should offer to take over this mechanic'
        : 'Player is performing adequately',
    };
  }

  /**
   * Get aggregated recent attempts across the last sessions, up to
   * STRUGGLING_ATTEMPT_WINDOW total attempts.
   */
  private getRecentAttempts(
    record: MechanicPerformanceRecord,
  ): { totalAttempts: number; totalSuccesses: number; errorRate: number } {
    if (record.sessionResults.length === 0) {
      return { totalAttempts: 0, totalSuccesses: 0, errorRate: 0 };
    }

    // Sort by timestamp descending (most recent first)
    const sorted = [...record.sessionResults].sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    let totalAttempts = 0;
    let totalSuccesses = 0;

    for (const result of sorted) {
      const remaining = STRUGGLING_ATTEMPT_WINDOW - totalAttempts;
      if (remaining <= 0) break;

      const take = Math.min(result.attempts, remaining);
      // Proportionally take successes
      const successRate = result.attempts > 0 ? result.successes / result.attempts : 0;
      const takenSuccesses = Math.round(successRate * take);

      totalAttempts += take;
      totalSuccesses += takenSuccesses;
    }

    const errorRate =
      totalAttempts > 0 ? (totalAttempts - totalSuccesses) / totalAttempts : 0;

    return { totalAttempts, totalSuccesses, errorRate };
  }

  /**
   * Notify all registered model listeners of updated preferences.
   */
  private notifyListeners(playerId: string): void {
    const preferences = this.getCompanionPreferences(playerId);
    for (const listener of this.modelListeners) {
      listener(playerId, preferences);
    }
  }
}
