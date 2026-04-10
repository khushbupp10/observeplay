import type { InputMethod } from '../types/common';
import type { AccessibilityProfile, AccessibilityProfileExport } from '../types/player';
import type { PlayerRepository } from '../db/repositories/player-repository';
import {
  serializeAccessibilityProfile,
  deserializeAccessibilityProfile,
  verifyChecksum,
} from '../utils/serialization';

// ---------------------------------------------------------------------------
// Onboarding & Interaction Data Types
// ---------------------------------------------------------------------------

export interface OnboardingSession {
  sessionId: string;
  playerId: string;
  startedAt: number;
  status: 'active' | 'completed' | 'cancelled';
  observations: OnboardingObservations;
}

export interface OnboardingObservations {
  detectedInputMethods: InputMethod[];
  responseTimeSamples: number[];
  inputAccuracySamples: number[];
  visualTrackingResults: VisualTrackingResult;
  audioResponsivenessResults: AudioResponsivenessResult;
  motorAssessment: MotorAssessment;
  cognitiveAssessment: CognitiveAssessment;
}

export interface VisualTrackingResult {
  minReadableTextSize: number;
  minContrastRatio: number;
  colorBlindnessType: AccessibilityProfile['colorBlindnessType'];
  visualFieldRestriction: AccessibilityProfile['visualFieldRestriction'];
}

export interface AudioResponsivenessResult {
  hearingCapability: AccessibilityProfile['hearingCapability'];
  preferredAudioChannel: AccessibilityProfile['preferredAudioChannel'];
}

export interface MotorAssessment {
  reachableScreenZone: AccessibilityProfile['reachableScreenZone'];
  clickPrecision: number;
  holdDuration: number;
}

export interface CognitiveAssessment {
  preferredPacing: AccessibilityProfile['preferredPacing'];
  maxSimultaneousElements: number;
  preferredInstructionFormat: AccessibilityProfile['preferredInstructionFormat'];
}

export interface OnboardingData {
  sessionId: string;
  playerId: string;
  completedAt: number;
  observations: OnboardingObservations;
}

export interface InteractionData {
  timestamp: number;
  inputMethodsUsed: InputMethod[];
  responseTimeMs: number;
  inputAccuracy: number;
  sessionId: string;
}

export interface ProfileUpdate {
  changes: ProfileChange[];
  requiresPlayerApproval: boolean;
}

export interface ProfileChange {
  attribute: string;
  previousValue: unknown;
  newValue: unknown;
  confidence: number;
  reason: string;
}

export interface AbilityChangeDetection {
  playerId: string;
  detectedChanges: AbilityChange[];
  analysisTimestamp: number;
}

export interface AbilityChange {
  attribute: string;
  previousValue: unknown;
  currentValue: unknown;
  changeType: 'fatigue' | 'progressive_condition' | 'improvement';
  confidence: number;
  evidence: string;
}


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default screen zone covering the full viewport. */
const DEFAULT_SCREEN_ZONE: AccessibilityProfile['reachableScreenZone'] = {
  topLeft: { x: 0, y: 0 },
  bottomRight: { x: 1920, y: 1080 },
};

/** Threshold for detecting fatigue — response time increase percentage. */
const FATIGUE_RESPONSE_TIME_THRESHOLD = 0.25; // 25% increase

/** Threshold for detecting progressive condition — accuracy decrease. */
const PROGRESSIVE_CONDITION_ACCURACY_THRESHOLD = 0.15; // 15% decrease

/** Minimum number of interaction data points for ability change detection. */
const MIN_DATA_POINTS_FOR_CHANGE_DETECTION = 3;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ProfileLearnerDeps {
  playerRepo: PlayerRepository;
}

// ---------------------------------------------------------------------------
// ProfileLearnerService
// ---------------------------------------------------------------------------

export class ProfileLearnerService {
  private deps: ProfileLearnerDeps;
  private activeSessions: Map<string, OnboardingSession> = new Map();

  constructor(deps: ProfileLearnerDeps) {
    this.deps = deps;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Start an interactive onboarding observation session.
   *
   * Requirement 7.1 — initiate an interactive onboarding game session
   * designed to observe input methods, response times, visual tracking,
   * and audio responsiveness.
   */
  async startOnboarding(playerId: string): Promise<OnboardingSession> {
    const sessionId = `onboarding-${playerId}-${Date.now()}`;
    const session: OnboardingSession = {
      sessionId,
      playerId,
      startedAt: Date.now(),
      status: 'active',
      observations: {
        detectedInputMethods: [],
        responseTimeSamples: [],
        inputAccuracySamples: [],
        visualTrackingResults: {
          minReadableTextSize: 16,
          minContrastRatio: 4.5,
          colorBlindnessType: null,
          visualFieldRestriction: null,
        },
        audioResponsivenessResults: {
          hearingCapability: 'full',
          preferredAudioChannel: 'stereo',
        },
        motorAssessment: {
          reachableScreenZone: { ...DEFAULT_SCREEN_ZONE },
          clickPrecision: 10,
          holdDuration: 1000,
        },
        cognitiveAssessment: {
          preferredPacing: 'moderate',
          maxSimultaneousElements: 5,
          preferredInstructionFormat: 'multimodal',
        },
      },
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Generate an initial AccessibilityProfile from completed onboarding data.
   *
   * Requirement 7.2 — generate an initial profile within 10 seconds.
   * Requirement 7.8 — store no raw interaction recordings.
   * Requirement 7.9 — deterministic: same input → same output.
   */
  async generateInitialProfile(sessionData: OnboardingData): Promise<AccessibilityProfile> {
    const { playerId, observations } = sessionData;

    const profile = buildProfileFromOnboardingObservations(observations, playerId);
    profile.lastUpdated = sessionData.completedAt;

    // Persist the profile
    await this.deps.playerRepo.upsertProfile(profile);

    // Mark session as completed
    const session = this.activeSessions.get(sessionData.sessionId);
    if (session) {
      session.status = 'completed';
    }

    return profile;
  }

  /**
   * Refine an existing profile from ongoing interaction data.
   *
   * Requirement 7.3 — continuously refine the profile.
   * Requirement 7.5 — notify the player of changes (accept/reject per change).
   * Requirement 7.6 — preserve manual overrides.
   * Requirement 7.8 — store no raw interaction recordings.
   */
  async refineProfile(
    playerId: string,
    interactionData: InteractionData,
  ): Promise<ProfileUpdate> {
    const existingProfile = await this.deps.playerRepo.getProfile(playerId);
    if (!existingProfile) {
      throw new Error(`No profile found for player: ${playerId}`);
    }

    const changes: ProfileChange[] = [];

    // Check response time changes — only if not manually overridden
    if (!existingProfile.manualOverrides['responseTimeMs']) {
      const newResponseTime = interactionData.responseTimeMs;
      if (
        newResponseTime > 0 &&
        Math.abs(newResponseTime - existingProfile.responseTimeMs) >
          existingProfile.responseTimeMs * 0.1
      ) {
        changes.push({
          attribute: 'responseTimeMs',
          previousValue: existingProfile.responseTimeMs,
          newValue: newResponseTime,
          confidence: 0.7,
          reason: `Observed response time changed from ${existingProfile.responseTimeMs}ms to ${newResponseTime}ms`,
        });
      }
    }

    // Check input accuracy changes — only if not manually overridden
    if (!existingProfile.manualOverrides['inputAccuracy']) {
      const newAccuracy = interactionData.inputAccuracy;
      if (
        newAccuracy > 0 &&
        Math.abs(newAccuracy - existingProfile.inputAccuracy) > 0.05
      ) {
        changes.push({
          attribute: 'inputAccuracy',
          previousValue: existingProfile.inputAccuracy,
          newValue: newAccuracy,
          confidence: 0.65,
          reason: `Observed input accuracy changed from ${existingProfile.inputAccuracy} to ${newAccuracy}`,
        });
      }
    }

    // Check for new input methods — only if not manually overridden
    if (!existingProfile.manualOverrides['inputMethods']) {
      const newMethods = interactionData.inputMethodsUsed.filter(
        (m) => !existingProfile.inputMethods.includes(m),
      );
      if (newMethods.length > 0) {
        const combined = deduplicateAndSort([
          ...existingProfile.inputMethods,
          ...newMethods,
        ]);
        changes.push({
          attribute: 'inputMethods',
          previousValue: existingProfile.inputMethods,
          newValue: combined,
          confidence: 0.8,
          reason: `New input methods detected: ${newMethods.join(', ')}`,
        });
      }
    }

    return {
      changes,
      requiresPlayerApproval: changes.length > 0,
    };
  }

  /**
   * Apply accepted profile changes after player approval.
   *
   * Requirement 7.5 — player accepts or rejects each change.
   * Requirement 7.6 — preserve manual overrides.
   */
  async applyProfileChanges(
    playerId: string,
    acceptedChanges: ProfileChange[],
  ): Promise<AccessibilityProfile> {
    const profile = await this.deps.playerRepo.getProfile(playerId);
    if (!profile) {
      throw new Error(`No profile found for player: ${playerId}`);
    }

    for (const change of acceptedChanges) {
      // Skip if manually overridden
      if (profile.manualOverrides[change.attribute]) {
        continue;
      }
      (profile as unknown as Record<string, unknown>)[change.attribute] = change.newValue;
    }

    profile.version += 1;
    profile.lastUpdated = Date.now();

    await this.deps.playerRepo.upsertProfile(profile);
    return profile;
  }

  /**
   * Set a manual override for a profile attribute.
   *
   * Requirement 7.6 — allow players to manually override any learned
   * preference at any time.
   */
  async setManualOverride(
    playerId: string,
    attribute: string,
    value: unknown,
  ): Promise<AccessibilityProfile> {
    const profile = await this.deps.playerRepo.getProfile(playerId);
    if (!profile) {
      throw new Error(`No profile found for player: ${playerId}`);
    }

    (profile as unknown as Record<string, unknown>)[attribute] = value;
    profile.manualOverrides[attribute] = value;
    profile.version += 1;
    profile.lastUpdated = Date.now();

    await this.deps.playerRepo.upsertProfile(profile);
    return profile;
  }

  /**
   * Detect ability changes over time (fatigue, progressive conditions).
   *
   * Requirement 7.4 — detect changes in abilities over time.
   */
  detectAbilityChanges(
    playerId: string,
    recentData: InteractionData[],
  ): AbilityChangeDetection {
    if (recentData.length < MIN_DATA_POINTS_FOR_CHANGE_DETECTION) {
      return {
        playerId,
        detectedChanges: [],
        analysisTimestamp: Date.now(),
      };
    }

    const changes: AbilityChange[] = [];

    // Sort by timestamp for consistent analysis
    const sorted = [...recentData].sort((a, b) => a.timestamp - b.timestamp);
    const midpoint = Math.floor(sorted.length / 2);
    const earlier = sorted.slice(0, midpoint);
    const later = sorted.slice(midpoint);

    // Detect fatigue: response time increasing over time
    const earlierAvgResponseTime = average(earlier.map((d) => d.responseTimeMs));
    const laterAvgResponseTime = average(later.map((d) => d.responseTimeMs));

    if (earlierAvgResponseTime > 0) {
      const responseTimeIncrease =
        (laterAvgResponseTime - earlierAvgResponseTime) / earlierAvgResponseTime;

      if (responseTimeIncrease > FATIGUE_RESPONSE_TIME_THRESHOLD) {
        changes.push({
          attribute: 'responseTimeMs',
          previousValue: earlierAvgResponseTime,
          currentValue: laterAvgResponseTime,
          changeType: 'fatigue',
          confidence: Math.min(responseTimeIncrease / 0.5, 1.0),
          evidence: `Response time increased by ${(responseTimeIncrease * 100).toFixed(1)}% over recent interactions`,
        });
      }
    }

    // Detect progressive condition: accuracy decreasing over time
    const earlierAvgAccuracy = average(earlier.map((d) => d.inputAccuracy));
    const laterAvgAccuracy = average(later.map((d) => d.inputAccuracy));

    if (earlierAvgAccuracy > 0) {
      const accuracyDecrease =
        (earlierAvgAccuracy - laterAvgAccuracy) / earlierAvgAccuracy;

      if (accuracyDecrease > PROGRESSIVE_CONDITION_ACCURACY_THRESHOLD) {
        changes.push({
          attribute: 'inputAccuracy',
          previousValue: earlierAvgAccuracy,
          currentValue: laterAvgAccuracy,
          changeType: 'progressive_condition',
          confidence: Math.min(accuracyDecrease / 0.3, 1.0),
          evidence: `Input accuracy decreased by ${(accuracyDecrease * 100).toFixed(1)}% over recent interactions`,
        });
      }
    }

    // Detect improvement: accuracy increasing or response time decreasing
    if (earlierAvgResponseTime > 0) {
      const responseTimeDecrease =
        (earlierAvgResponseTime - laterAvgResponseTime) / earlierAvgResponseTime;

      if (responseTimeDecrease > FATIGUE_RESPONSE_TIME_THRESHOLD) {
        changes.push({
          attribute: 'responseTimeMs',
          previousValue: earlierAvgResponseTime,
          currentValue: laterAvgResponseTime,
          changeType: 'improvement',
          confidence: Math.min(responseTimeDecrease / 0.5, 1.0),
          evidence: `Response time decreased by ${(responseTimeDecrease * 100).toFixed(1)}% over recent interactions`,
        });
      }
    }

    return {
      playerId,
      detectedChanges: changes,
      analysisTimestamp: Date.now(),
    };
  }

  /**
   * Export a player's profile in a portable format with checksum.
   *
   * Requirement 7.7 — round-trip export/import.
   */
  async exportProfile(playerId: string): Promise<AccessibilityProfileExport> {
    const profile = await this.deps.playerRepo.getProfile(playerId);
    if (!profile) {
      throw new Error(`No profile found for player: ${playerId}`);
    }

    return serializeAccessibilityProfile(profile);
  }

  /**
   * Import a profile from a portable format with checksum verification.
   *
   * Requirement 7.7 — round-trip export/import with checksum verification.
   */
  async importProfile(
    data: AccessibilityProfileExport,
  ): Promise<AccessibilityProfile> {
    // Verify checksum — deserializeAccessibilityProfile throws on mismatch
    const profileData = deserializeAccessibilityProfile(data);

    // We need a playerId to store the profile — use a placeholder that the
    // caller can update, or derive from context.
    const profile: AccessibilityProfile = {
      ...profileData,
      playerId: '', // caller must set this after import
    };

    return profile;
  }

  /**
   * Import a profile and assign it to a specific player.
   */
  async importProfileForPlayer(
    playerId: string,
    data: AccessibilityProfileExport,
  ): Promise<AccessibilityProfile> {
    const profile = await this.importProfile(data);
    profile.playerId = playerId;

    await this.deps.playerRepo.upsertProfile(profile);
    return profile;
  }

  /**
   * Get an active onboarding session by ID.
   */
  getSession(sessionId: string): OnboardingSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Cancel an active onboarding session.
   */
  cancelSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helper functions (deterministic)
// ---------------------------------------------------------------------------

/**
 * Compute the median of a sorted array of numbers.
 * Returns 0 for empty arrays.
 */
export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute the arithmetic mean of an array of numbers.
 * Returns 0 for empty arrays.
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Deduplicate and sort an array of input methods for deterministic output.
 */
export function deduplicateAndSort(methods: InputMethod[]): InputMethod[] {
  return [...new Set(methods)].sort();
}

/**
 * Build an accessibility profile from onboarding observations without persisting.
 * Matches {@link ProfileLearnerService.generateInitialProfile} logic (median, sorted
 * input methods, safe defaults) for client-side onboarding flows.
 */
export function buildProfileFromOnboardingObservations(
  observations: OnboardingObservations,
  playerId: string,
): AccessibilityProfile {
  const responseTimeMs = computeMedian(observations.responseTimeSamples);
  const inputAccuracy = clamp(computeMedian(observations.inputAccuracySamples), 0, 1);
  const inputMethods = deduplicateAndSort(observations.detectedInputMethods);

  return {
    playerId,
    version: 1,
    lastUpdated: Date.now(),

    inputMethods: inputMethods.length > 0 ? inputMethods : ['keyboard'],
    responseTimeMs: responseTimeMs > 0 ? responseTimeMs : 500,
    inputAccuracy: inputAccuracy > 0 ? inputAccuracy : 0.8,

    minReadableTextSize: observations.visualTrackingResults.minReadableTextSize,
    minContrastRatio: observations.visualTrackingResults.minContrastRatio,
    colorBlindnessType: observations.visualTrackingResults.colorBlindnessType,
    visualFieldRestriction: observations.visualTrackingResults.visualFieldRestriction,

    hearingCapability: observations.audioResponsivenessResults.hearingCapability,
    preferredAudioChannel: observations.audioResponsivenessResults.preferredAudioChannel,

    reachableScreenZone: observations.motorAssessment.reachableScreenZone,
    clickPrecision: observations.motorAssessment.clickPrecision,
    holdDuration: observations.motorAssessment.holdDuration,

    preferredPacing: observations.cognitiveAssessment.preferredPacing,
    maxSimultaneousElements: observations.cognitiveAssessment.maxSimultaneousElements,
    preferredInstructionFormat: observations.cognitiveAssessment.preferredInstructionFormat,

    learnedPreferences: {},
    manualOverrides: {},
  };
}
