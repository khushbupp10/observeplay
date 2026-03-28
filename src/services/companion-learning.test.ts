import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompanionLearningService } from './companion-learning';
import type { MechanicOutcome } from '../types/learning';
import type { AccessibilityProfile } from '../types/player';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeOutcome(overrides?: Partial<MechanicOutcome>): MechanicOutcome {
  return {
    mechanicId: 'mech-1',
    success: true,
    sessionId: 'session-1',
    timestamp: 1000,
    ...overrides,
  };
}

function makeProfile(overrides?: Partial<AccessibilityProfile>): AccessibilityProfile {
  return {
    playerId: 'player-1',
    version: 1,
    lastUpdated: Date.now(),
    inputMethods: ['keyboard', 'mouse'],
    responseTimeMs: 500,
    inputAccuracy: 0.9,
    minReadableTextSize: 16,
    minContrastRatio: 4.5,
    colorBlindnessType: null,
    visualFieldRestriction: null,
    hearingCapability: 'full',
    preferredAudioChannel: 'stereo',
    reachableScreenZone: {
      topLeft: { x: 0, y: 0 },
      bottomRight: { x: 1920, y: 1080 },
    },
    clickPrecision: 5,
    holdDuration: 1000,
    preferredPacing: 'moderate',
    maxSimultaneousElements: 5,
    preferredInstructionFormat: 'multimodal',
    learnedPreferences: {},
    manualOverrides: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompanionLearningService', () => {
  let service: CompanionLearningService;

  beforeEach(() => {
    service = new CompanionLearningService();
  });

  // ── trackPerformance ────────────────────────────────────────────

  describe('trackPerformance', () => {
    it('creates a new mechanic record on first tracking', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome());

      const model = service.getPlayerModel('player-1');
      expect(model).not.toBeNull();
      expect(model!.mechanicPerformance).toHaveLength(1);
      expect(model!.mechanicPerformance[0].mechanicId).toBe('mech-1');
    });

    it('tracks success correctly', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ success: true }));

      const model = service.getPlayerModel('player-1');
      const record = model!.mechanicPerformance[0];
      expect(record.sessionResults[0].successes).toBe(1);
      expect(record.sessionResults[0].attempts).toBe(1);
      expect(record.sessionResults[0].errorRate).toBe(0);
    });

    it('tracks failure correctly', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ success: false }));

      const model = service.getPlayerModel('player-1');
      const record = model!.mechanicPerformance[0];
      expect(record.sessionResults[0].successes).toBe(0);
      expect(record.sessionResults[0].attempts).toBe(1);
      expect(record.sessionResults[0].errorRate).toBe(1);
    });

    it('aggregates outcomes within the same session', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ success: true, timestamp: 100 }));
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ success: false, timestamp: 200 }));
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ success: true, timestamp: 300 }));

      const model = service.getPlayerModel('player-1');
      const record = model!.mechanicPerformance[0];
      expect(record.sessionResults).toHaveLength(1);
      expect(record.sessionResults[0].attempts).toBe(3);
      expect(record.sessionResults[0].successes).toBe(2);
      expect(record.sessionResults[0].errorRate).toBeCloseTo(1 / 3);
    });

    it('creates separate session results for different sessions', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ sessionId: 's1' }));
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ sessionId: 's2' }));

      const model = service.getPlayerModel('player-1');
      const record = model!.mechanicPerformance[0];
      expect(record.sessionResults).toHaveLength(2);
    });

    it('tracks different mechanics independently', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome({ mechanicId: 'mech-1' }));
      service.trackPerformance('player-1', 'mech-2', makeOutcome({ mechanicId: 'mech-2' }));

      const model = service.getPlayerModel('player-1');
      expect(model!.mechanicPerformance).toHaveLength(2);
    });

    it('tracks different players independently', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome());
      service.trackPerformance('player-2', 'mech-1', makeOutcome());

      expect(service.getPlayerModel('player-1')).not.toBeNull();
      expect(service.getPlayerModel('player-2')).not.toBeNull();
    });
  });

  // ── suggestTransfer ─────────────────────────────────────────────

  describe('suggestTransfer', () => {
    it('returns empty array for unknown player', () => {
      expect(service.suggestTransfer('unknown')).toEqual([]);
    });

    it('suggests "to_player" when companion-controlled mechanic has 3 consecutive session successes', () => {
      service.setMechanicControl('player-1', 'mech-1', 'companion');

      for (let i = 0; i < 3; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: `session-${i}`,
          success: true,
          timestamp: 1000 + i * 100,
        }));
      }

      const suggestions = service.suggestTransfer('player-1');
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].mechanicId).toBe('mech-1');
      expect(suggestions[0].direction).toBe('to_player');
      expect(suggestions[0].consecutiveSuccesses).toBe(3);
    });

    it('does not suggest "to_player" with fewer than 3 consecutive successes', () => {
      service.setMechanicControl('player-1', 'mech-1', 'companion');

      for (let i = 0; i < 2; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: `session-${i}`,
          success: true,
          timestamp: 1000 + i * 100,
        }));
      }

      const suggestions = service.suggestTransfer('player-1');
      expect(suggestions).toHaveLength(0);
    });

    it('does not suggest "to_player" when a recent session has failures', () => {
      service.setMechanicControl('player-1', 'mech-1', 'companion');

      // 2 successes, then a failure, then a success
      service.trackPerformance('player-1', 'mech-1', makeOutcome({
        sessionId: 's1', success: true, timestamp: 100,
      }));
      service.trackPerformance('player-1', 'mech-1', makeOutcome({
        sessionId: 's2', success: true, timestamp: 200,
      }));
      service.trackPerformance('player-1', 'mech-1', makeOutcome({
        sessionId: 's3', success: false, timestamp: 300,
      }));
      service.trackPerformance('player-1', 'mech-1', makeOutcome({
        sessionId: 's4', success: true, timestamp: 400,
      }));

      const suggestions = service.suggestTransfer('player-1');
      // Only 1 consecutive success from the most recent session
      expect(suggestions.filter(s => s.direction === 'to_player')).toHaveLength(0);
    });

    it('suggests "to_companion" when player-controlled mechanic has >60% error rate over 5 attempts', () => {
      service.setMechanicControl('player-1', 'mech-1', 'player');

      // 4 failures, 1 success = 80% error rate
      for (let i = 0; i < 4; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: false, timestamp: 100 + i,
        }));
      }
      service.trackPerformance('player-1', 'mech-1', makeOutcome({
        sessionId: 's1', success: true, timestamp: 200,
      }));

      const suggestions = service.suggestTransfer('player-1');
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].mechanicId).toBe('mech-1');
      expect(suggestions[0].direction).toBe('to_companion');
      expect(suggestions[0].errorRate).toBeGreaterThan(0.6);
    });

    it('does not suggest "to_companion" when error rate is ≤60%', () => {
      service.setMechanicControl('player-1', 'mech-1', 'player');

      // 3 successes, 2 failures = 40% error rate
      for (let i = 0; i < 3; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: true, timestamp: 100 + i,
        }));
      }
      for (let i = 0; i < 2; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: false, timestamp: 200 + i,
        }));
      }

      const suggestions = service.suggestTransfer('player-1');
      expect(suggestions.filter(s => s.direction === 'to_companion')).toHaveLength(0);
    });

    it('does not suggest "to_companion" with fewer than 5 attempts', () => {
      service.setMechanicControl('player-1', 'mech-1', 'player');

      // 4 failures (not enough attempts)
      for (let i = 0; i < 4; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: false, timestamp: 100 + i,
        }));
      }

      const suggestions = service.suggestTransfer('player-1');
      expect(suggestions.filter(s => s.direction === 'to_companion')).toHaveLength(0);
    });
  });

  // ── detectStruggling ────────────────────────────────────────────

  describe('detectStruggling', () => {
    it('returns not struggling for unknown player', () => {
      const result = service.detectStruggling('unknown', 'mech-1');
      expect(result.isStruggling).toBe(false);
      expect(result.recentAttempts).toBe(0);
    });

    it('returns not struggling for unknown mechanic', () => {
      service.trackPerformance('player-1', 'mech-1', makeOutcome());
      const result = service.detectStruggling('player-1', 'mech-other');
      expect(result.isStruggling).toBe(false);
    });

    it('returns not struggling when fewer than 5 attempts', () => {
      for (let i = 0; i < 4; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: false, timestamp: 100 + i,
        }));
      }

      const result = service.detectStruggling('player-1', 'mech-1');
      expect(result.isStruggling).toBe(false);
      expect(result.recentAttempts).toBe(4);
    });

    it('detects struggling when error rate >60% over 5 attempts', () => {
      // 4 failures + 1 success = 80% error rate
      for (let i = 0; i < 4; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: false, timestamp: 100 + i,
        }));
      }
      service.trackPerformance('player-1', 'mech-1', makeOutcome({
        sessionId: 's1', success: true, timestamp: 200,
      }));

      const result = service.detectStruggling('player-1', 'mech-1');
      expect(result.isStruggling).toBe(true);
      expect(result.errorRate).toBeGreaterThan(0.6);
      expect(result.recentAttempts).toBe(5);
    });

    it('does not detect struggling when error rate ≤60%', () => {
      // 3 successes + 2 failures = 40% error rate
      for (let i = 0; i < 3; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: true, timestamp: 100 + i,
        }));
      }
      for (let i = 0; i < 2; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: false, timestamp: 200 + i,
        }));
      }

      const result = service.detectStruggling('player-1', 'mech-1');
      expect(result.isStruggling).toBe(false);
    });

    it('includes a recommendation when struggling', () => {
      for (let i = 0; i < 5; i++) {
        service.trackPerformance('player-1', 'mech-1', makeOutcome({
          sessionId: 's1', success: false, timestamp: 100 + i,
        }));
      }

      const result = service.detectStruggling('player-1', 'mech-1');
      expect(result.recommendation).toContain('take over');
    });
  });

  // ── syncWithProfileLearner ──────────────────────────────────────

  describe('syncWithProfileLearner', () => {
    it('notifies registered listeners with companion preferences', async () => {
      const listener = vi.fn();
      service.onModelChange(listener);

      service.trackPerformance('player-1', 'mech-1', makeOutcome());

      // Reset mock to only capture the sync call
      listener.mockClear();

      await service.syncWithProfileLearner('player-1');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('player-1', expect.any(Object));
    });

    it('provides preferences in a format suitable for AccessibilityProfile', async () => {
      const listener = vi.fn();
      service.onModelChange(listener);

      service.trackPerformance('player-1', 'mech-1', makeOutcome());
      listener.mockClear();

      await service.syncWithProfileLearner('player-1');

      const prefs = listener.mock.calls[0][1] as Record<string, unknown>;
      const key = 'companion:mech-1';
      expect(prefs[key]).toBeDefined();
      const pref = prefs[key] as Record<string, unknown>;
      expect(pref.controlledBy).toBe('player');
      expect(pref.totalSessions).toBe(1);
    });

    it('returns empty preferences for unknown player', async () => {
      const listener = vi.fn();
      service.onModelChange(listener);

      await service.syncWithProfileLearner('unknown');

      expect(listener).toHaveBeenCalledWith('unknown', {});
    });
  });

  // ── onModelChange listener ──────────────────────────────────────

  describe('onModelChange listener', () => {
    it('notifies listeners when performance is tracked', () => {
      const listener = vi.fn();
      service.onModelChange(listener);

      service.trackPerformance('player-1', 'mech-1', makeOutcome());

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('player-1', expect.any(Object));
    });

    it('notifies listeners when mechanic control is set', () => {
      const listener = vi.fn();
      service.onModelChange(listener);

      service.setMechanicControl('player-1', 'mech-1', 'companion');

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      service.onModelChange(listener1);
      service.onModelChange(listener2);

      service.trackPerformance('player-1', 'mech-1', makeOutcome());

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  // ── adaptCommunicationStyle ─────────────────────────────────────

  describe('adaptCommunicationStyle', () => {
    it('returns audio-only (speech) for blind players who can hear', () => {
      const profile = makeProfile({
        preferredInstructionFormat: 'audio',
        hearingCapability: 'full',
      });

      const result = service.adaptCommunicationStyle(profile, 'text');
      expect(result.channel).toBe('speech');
      expect(result.useShortMessages).toBe(false);
    });

    it('does not force speech for audio-preferring players who cannot hear', () => {
      const profile = makeProfile({
        preferredInstructionFormat: 'audio',
        hearingCapability: 'none',
      });

      const result = service.adaptCommunicationStyle(profile, 'text');
      expect(result.channel).toBe('text');
    });

    it('uses shorter text for slow pacing cognitive accessibility', () => {
      const profile = makeProfile({
        preferredPacing: 'slow',
        preferredInstructionFormat: 'text',
      });

      const result = service.adaptCommunicationStyle(profile, 'text');
      expect(result.useShortMessages).toBe(true);
    });

    it('uses shorter text for low maxSimultaneousElements', () => {
      const profile = makeProfile({
        maxSimultaneousElements: 2,
        preferredInstructionFormat: 'text',
      });

      const result = service.adaptCommunicationStyle(profile, 'text');
      expect(result.useShortMessages).toBe(true);
    });

    it('uses preferred channel for standard profiles', () => {
      const profile = makeProfile({
        preferredPacing: 'moderate',
        maxSimultaneousElements: 5,
        preferredInstructionFormat: 'multimodal',
      });

      const result = service.adaptCommunicationStyle(profile, 'audio_cue');
      expect(result.channel).toBe('audio_cue');
      expect(result.useShortMessages).toBe(false);
    });

    it('returns speech with partial hearing for audio-preferring players', () => {
      const profile = makeProfile({
        preferredInstructionFormat: 'audio',
        hearingCapability: 'partial',
      });

      const result = service.adaptCommunicationStyle(profile, 'text');
      expect(result.channel).toBe('speech');
    });
  });

  // ── setMechanicControl ──────────────────────────────────────────

  describe('setMechanicControl', () => {
    it('creates a new record if mechanic does not exist', () => {
      service.setMechanicControl('player-1', 'mech-1', 'companion');

      const model = service.getPlayerModel('player-1');
      expect(model!.mechanicPerformance).toHaveLength(1);
      expect(model!.mechanicPerformance[0].controlledBy).toBe('companion');
    });

    it('updates existing record controlledBy', () => {
      service.setMechanicControl('player-1', 'mech-1', 'companion');
      service.setMechanicControl('player-1', 'mech-1', 'player');

      const model = service.getPlayerModel('player-1');
      expect(model!.mechanicPerformance).toHaveLength(1);
      expect(model!.mechanicPerformance[0].controlledBy).toBe('player');
    });
  });

  // ── getPlayerModel ──────────────────────────────────────────────

  describe('getPlayerModel', () => {
    it('returns null for unknown player', () => {
      expect(service.getPlayerModel('unknown')).toBeNull();
    });
  });
});
