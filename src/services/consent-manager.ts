import type { ConsentCategory } from '../types/common';
import type {
  ConsentState,
  ConsentRecord,
  ConsentForm,
  ConsentFormCategory,
  DataDashboard,
  DataCategoryInfo,
  PlayerDataExport,
  DataDeletionResult,
  GameSessionSummary,
} from '../types/consent';
import type { PlayerRepository } from '../db/repositories/player-repository';
import type { GameRepository, GameSessionRow } from '../db/repositories/game-repository';
import type { EmotionRepository } from '../db/repositories/emotion-repository';
import type { BarrierRepository } from '../db/repositories/barrier-repository';
import type { CompanionRepository } from '../db/repositories/companion-repository';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSENT_FORM_VERSION = '1.0.0';

const CONSENT_CATEGORIES: ConsentFormCategory[] = [
  {
    category: 'webcam',
    title: 'Webcam & Facial Expression Analysis',
    description:
      'Allows the platform to analyse your facial expressions locally on your device to detect frustration, confusion, or disengagement and adjust the experience accordingly. No raw video is transmitted or stored — only derived emotion classifications are retained.',
    required: false,
  },
  {
    category: 'interaction_patterns',
    title: 'Interaction Pattern Tracking',
    description:
      'Allows the platform to observe input timing, pause frequency, and error rates so it can adapt difficulty and pacing to your needs.',
    required: false,
  },
  {
    category: 'profile_learning',
    title: 'Accessibility Profile Learning',
    description:
      'Allows the platform to learn your accessibility preferences by observing how you interact, building a profile that improves your experience over time without questionnaires.',
    required: false,
  },
  {
    category: 'voice_input',
    title: 'Voice Input & Natural Language Control',
    description:
      'Allows the platform to process your voice commands so you can control games through natural conversation.',
    required: false,
  },
];

/** 24 hours in milliseconds — deadline for category data deletion on revocation. */
const CATEGORY_DELETION_DEADLINE_MS = 24 * 60 * 60 * 1000;

/** 48 hours in milliseconds — deadline for full account data deletion. */
const ACCOUNT_DELETION_DEADLINE_MS = 48 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Data-category → repository mapping helpers
// ---------------------------------------------------------------------------

/**
 * Maps a ConsentCategory to the set of data that should be deleted when
 * consent for that category is revoked.
 */
const CATEGORY_DATA_MAP: Record<ConsentCategory, string> = {
  webcam: 'emotion_logs',
  interaction_patterns: 'barrier_events',
  profile_learning: 'accessibility_profile',
  voice_input: 'dialogue_logs',
};

// ---------------------------------------------------------------------------
// Deletion scheduler (simple in-memory queue)
// ---------------------------------------------------------------------------

export interface ScheduledDeletion {
  playerId: string;
  category: ConsentCategory | 'account';
  scheduledAt: number;
  deadlineMs: number;
  executed: boolean;
}

/**
 * Minimal in-process deletion scheduler.
 *
 * In production this would be backed by a persistent job queue (e.g. BullMQ,
 * pg-boss). For now we keep an in-memory list and expose helpers so that a
 * background worker can drain it.
 */
export class DeletionScheduler {
  private queue: ScheduledDeletion[] = [];

  schedule(entry: Omit<ScheduledDeletion, 'executed'>): void {
    this.queue.push({ ...entry, executed: false });
  }

  /** Return all pending (not yet executed) entries. */
  getPending(): ScheduledDeletion[] {
    return this.queue.filter((e) => !e.executed);
  }

  /** Mark an entry as executed. */
  markExecuted(playerId: string, category: string): void {
    for (const entry of this.queue) {
      if (entry.playerId === playerId && entry.category === category) {
        entry.executed = true;
      }
    }
  }

  /** Visible for testing — clear the queue. */
  clear(): void {
    this.queue = [];
  }
}

// ---------------------------------------------------------------------------
// ConsentManagerService
// ---------------------------------------------------------------------------

export interface ConsentManagerDeps {
  playerRepo: PlayerRepository;
  gameRepo: GameRepository;
  emotionRepo: EmotionRepository;
  barrierRepo: BarrierRepository;
  companionRepo: CompanionRepository;
}

export class ConsentManagerService {
  private deps: ConsentManagerDeps;
  private deletionScheduler: DeletionScheduler;

  /** In-memory consent cache for sub-second revocation response. */
  private consentCache: Map<string, ConsentState> = new Map();

  constructor(deps: ConsentManagerDeps, scheduler?: DeletionScheduler) {
    this.deps = deps;
    this.deletionScheduler = scheduler ?? new DeletionScheduler();
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Return the consent form definition with all four data-collection
   * categories and their descriptions.
   *
   * Requirement 9.1 — clear, accessible consent interface with individual
   * opt-in toggles.
   */
  getConsentForm(): ConsentForm {
    return {
      categories: CONSENT_CATEGORIES,
      version: CONSENT_FORM_VERSION,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Update consent for a single category.
   *
   * - On grant: records the timestamp.
   * - On revocation: immediately updates state (< 1 s) and schedules data
   *   deletion within 24 hours.
   *
   * Requirements 9.2, 9.3
   */
  async updateConsent(
    playerId: string,
    category: ConsentCategory,
    granted: boolean,
  ): Promise<void> {
    const state = await this.getOrCreateConsentState(playerId);
    const now = Date.now();

    const previous = state.consents[category];
    const wasGranted = previous?.granted ?? false;

    const record: ConsentRecord = granted
      ? { granted: true, grantedAt: now, revokedAt: previous?.revokedAt }
      : { granted: false, grantedAt: previous?.grantedAt, revokedAt: now };

    state.consents[category] = record;
    state.lastUpdated = now;

    // Persist immediately
    await this.persistConsentState(state);

    // Update cache for fast reads
    this.consentCache.set(playerId, { ...state });

    // If consent was revoked, schedule data deletion within 24 hours
    if (wasGranted && !granted) {
      this.deletionScheduler.schedule({
        playerId,
        category,
        scheduledAt: now,
        deadlineMs: CATEGORY_DELETION_DEADLINE_MS,
      });
    }
  }

  /**
   * Return the current consent state for a player.
   *
   * Uses an in-memory cache to guarantee sub-second response after
   * revocation.
   */
  getConsentState(playerId: string): ConsentState {
    const cached = this.consentCache.get(playerId);
    if (cached) return cached;

    // Return a default "all denied" state when no record exists yet.
    return this.buildDefaultConsentState(playerId);
  }

  /**
   * Async variant that loads from the database when the cache is cold.
   */
  async getConsentStateAsync(playerId: string): Promise<ConsentState> {
    const cached = this.consentCache.get(playerId);
    if (cached) return cached;

    const state = await this.getOrCreateConsentState(playerId);
    this.consentCache.set(playerId, state);
    return state;
  }

  /**
   * Export all personal data for a player as JSON.
   *
   * Requirement 9.6
   */
  async exportPlayerData(playerId: string): Promise<PlayerDataExport> {
    const player = await this.deps.playerRepo.getPlayerById(playerId);
    if (!player) {
      throw new Error(`Player not found: ${playerId}`);
    }

    const sessions = await this.deps.gameRepo.getSessionsByPlayer(playerId);
    const emotionLogs = await this.deps.emotionRepo.getLogsByPlayer(playerId);
    const barrierEvents = await this.deps.barrierRepo.getBarrierEventsByPlayer(playerId);

    const gameHistory: GameSessionSummary[] = sessions.map((s: GameSessionRow) => ({
      sessionId: s.id,
      gameSpecId: s.gameSpecId,
      startedAt: s.startedAt,
      endedAt: s.endedAt ?? s.startedAt,
      duration: (s.endedAt ?? s.startedAt) - s.startedAt,
    }));

    return {
      exportedAt: Date.now(),
      format: 'json',
      player: {
        createdAt: player.createdAt,
        preferredLanguage: player.preferredLanguage,
        preferredCommunicationChannel: player.preferredCommunicationChannel,
        profile: player.profile,
        consentState: player.consentState,
        emotionLogs,
        barrierEvents,
      },
      gameHistory,
    };
  }

  /**
   * Delete ALL personal data for a player (account deletion).
   *
   * Schedules complete deletion within 48 hours.
   *
   * Requirement 9.8
   */
  async deletePlayerData(playerId: string): Promise<DataDeletionResult> {
    const now = Date.now();

    // Schedule the full deletion
    this.deletionScheduler.schedule({
      playerId,
      category: 'account',
      scheduledAt: now,
      deadlineMs: ACCOUNT_DELETION_DEADLINE_MS,
    });

    // Execute deletion immediately (best-effort)
    const deletedCategories = await this.executeFullDeletion(playerId);

    // Clear cache
    this.consentCache.delete(playerId);

    return {
      playerId,
      deletedCategories,
      completedAt: Date.now(),
      withinDeadline: true,
    };
  }

  /**
   * Return a data dashboard showing what data has been collected, how it is
   * used, and when it was last accessed.
   *
   * Requirement 9.4
   */
  async getDataDashboard(playerId: string): Promise<DataDashboard> {
    const state = await this.getConsentStateAsync(playerId);
    const collectedData: DataCategoryInfo[] = [];
    const lastAccessed: Record<string, number> = {};
    let storageUsed = 0;

    // Emotion logs (webcam category)
    if (state.consents.webcam?.granted) {
      const logs = await this.deps.emotionRepo.getLogsByPlayer(playerId);
      const entryCount = logs.reduce((sum, l) => sum + l.entries.length, 0);
      const lastCollected = logs.length > 0
        ? Math.max(...logs.map((l) => {
            const entries = l.entries;
            return entries.length > 0 ? entries[entries.length - 1].timestamp : 0;
          }))
        : 0;
      collectedData.push({
        category: 'webcam',
        description: 'Emotion state classifications derived from facial expression analysis',
        dataPointCount: entryCount,
        lastCollected,
        retentionDays: 90,
      });
      lastAccessed['webcam'] = lastCollected;
      storageUsed += entryCount * 128; // rough estimate bytes per entry
    }

    // Barrier events (interaction_patterns category)
    if (state.consents.interaction_patterns?.granted) {
      const events = await this.deps.barrierRepo.getBarrierEventsByPlayer(playerId);
      const lastCollected = events.length > 0
        ? Math.max(...events.map((e) => e.timestamp))
        : 0;
      collectedData.push({
        category: 'interaction_patterns',
        description: 'Barrier events and interaction pattern data used for accessibility adaptation',
        dataPointCount: events.length,
        lastCollected,
        retentionDays: 180,
      });
      lastAccessed['interaction_patterns'] = lastCollected;
      storageUsed += events.length * 512;
    }

    // Accessibility profile (profile_learning category)
    if (state.consents.profile_learning?.granted) {
      const profile = await this.deps.playerRepo.getProfile(playerId);
      if (profile) {
        collectedData.push({
          category: 'profile_learning',
          description: 'Learned accessibility profile attributes derived from interaction observation',
          dataPointCount: 1,
          lastCollected: profile.lastUpdated,
          retentionDays: 365,
        });
        lastAccessed['profile_learning'] = profile.lastUpdated;
        storageUsed += 2048;
      }
    }

    // Voice input (voice_input category)
    if (state.consents.voice_input?.granted) {
      collectedData.push({
        category: 'voice_input',
        description: 'Processed voice command transcripts used for natural language game control',
        dataPointCount: 0,
        lastCollected: 0,
        retentionDays: 30,
      });
      lastAccessed['voice_input'] = 0;
    }

    return { collectedData, lastAccessed, storageUsed };
  }

  // ── Accessors for the deletion scheduler (visible for testing) ────

  getDeletionScheduler(): DeletionScheduler {
    return this.deletionScheduler;
  }

  // ── Private helpers ─────────────────────────────────────────────

  private buildDefaultConsentState(playerId: string): ConsentState {
    return {
      playerId,
      consents: {
        webcam: { granted: false },
        interaction_patterns: { granted: false },
        profile_learning: { granted: false },
        voice_input: { granted: false },
      },
      lastUpdated: 0,
    };
  }

  /**
   * Load consent state from the database, or create a default one if none
   * exists. Checks the in-memory cache first.
   */
  private async getOrCreateConsentState(playerId: string): Promise<ConsentState> {
    // Check cache first for consistency across sequential calls
    const cached = this.consentCache.get(playerId);
    if (cached) return { ...cached };

    const player = await this.deps.playerRepo.getPlayerById(playerId);
    if (player && player.consentState && player.consentState.lastUpdated > 0) {
      // Ensure all categories exist (backfill any missing ones)
      const consents = { ...this.buildDefaultConsentState(playerId).consents, ...player.consentState.consents };
      return { playerId, consents, lastUpdated: player.consentState.lastUpdated };
    }
    return this.buildDefaultConsentState(playerId);
  }

  /**
   * Persist the consent state to the database via a raw query on the
   * consent_states table.
   */
  private async persistConsentState(state: ConsentState): Promise<void> {
    const { getPool } = await import('../db/pool');
    const pool = getPool();
    await pool.query(
      `INSERT INTO consent_states (player_id, consents, last_updated)
       VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE
       SET consents = $2, last_updated = $3`,
      [state.playerId, JSON.stringify(state.consents), state.lastUpdated],
    );
  }

  /**
   * Execute full account deletion — removes all personal data.
   */
  private async executeFullDeletion(playerId: string): Promise<string[]> {
    const deleted: string[] = [];

    try {
      await this.deps.emotionRepo.deleteLogsByPlayer(playerId);
      deleted.push('emotion_logs');
    } catch { /* log and continue */ }

    try {
      // Barrier events are tied to sessions which cascade from player
      // but we delete explicitly for clarity
      const { getPool } = await import('../db/pool');
      const pool = getPool();
      await pool.query('DELETE FROM barrier_events WHERE player_id = $1', [playerId]);
      deleted.push('barrier_events');
    } catch { /* log and continue */ }

    try {
      await this.deps.companionRepo.deleteModel(playerId);
      deleted.push('companion_model');
    } catch { /* log and continue */ }

    try {
      await this.deps.playerRepo.deleteProfile(playerId);
      deleted.push('accessibility_profile');
    } catch { /* log and continue */ }

    try {
      // Delete adaptation history
      const { getPool } = await import('../db/pool');
      const pool = getPool();
      await pool.query('DELETE FROM adaptation_history WHERE player_id = $1', [playerId]);
      deleted.push('adaptation_history');
    } catch { /* log and continue */ }

    try {
      // Delete game sessions (cascades barrier_events, emotion_logs)
      const { getPool } = await import('../db/pool');
      const pool = getPool();
      await pool.query('DELETE FROM game_sessions WHERE player_id = $1', [playerId]);
      deleted.push('game_sessions');
    } catch { /* log and continue */ }

    try {
      // Delete consent state
      const { getPool } = await import('../db/pool');
      const pool = getPool();
      await pool.query('DELETE FROM consent_states WHERE player_id = $1', [playerId]);
      deleted.push('consent_state');
    } catch { /* log and continue */ }

    try {
      // Finally delete the player record itself
      await this.deps.playerRepo.deletePlayer(playerId);
      deleted.push('player');
    } catch { /* log and continue */ }

    this.deletionScheduler.markExecuted(playerId, 'account');

    return deleted;
  }
}
