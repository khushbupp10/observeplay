import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ProfileLearnerService,
  computeMedian,
  average,
  clamp,
  deduplicateAndSort,
  type ProfileLearnerDeps,
  type OnboardingData,
  type InteractionData,
} from './profile-learner';
import type { AccessibilityProfile, AccessibilityProfileExport } from '../types/player';
import type { InputMethod } from '../types/common';
import {
  serializeAccessibilityProfile,
} from '../utils/serialization';

// ---------------------------------------------------------------------------
// Stub player repository
// ---------------------------------------------------------------------------

function makeStubPlayerRepo() {
  const profiles = new Map<string, AccessibilityProfile>();

  return {
    getPlayerById: vi.fn(async () => null),
    deletePlayer: vi.fn(),
    getProfile: vi.fn(async (playerId: string) => profiles.get(playerId) ?? null),
    upsertProfile: vi.fn(async (profile: AccessibilityProfile) => {
      profiles.set(profile.playerId, { ...profile });
    }),
    deleteProfile: vi.fn(async (playerId: string) => {
      profiles.delete(playerId);
    }),
    createPlayer: vi.fn(),
    updatePlayer: vi.fn(),
    // test helpers
    _setProfile: (id: string, profile: AccessibilityProfile) => profiles.set(id, profile),
    _getProfile: (id: string) => profiles.get(id),
  };
}

function createService(repoOverride?: ReturnType<typeof makeStubPlayerRepo>) {
  const playerRepo = repoOverride ?? makeStubPlayerRepo();
  const deps: ProfileLearnerDeps = {
    playerRepo: playerRepo as unknown as ProfileLearnerDeps['playerRepo'],
  };
  const service = new ProfileLearnerService(deps);
  return { service, playerRepo };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOnboardingData(overrides?: Partial<OnboardingData>): OnboardingData {
  return {
    sessionId: 'onboarding-player1-1000',
    playerId: 'player1',
    completedAt: 2000,
    observations: {
      detectedInputMethods: ['keyboard', 'mouse'] as InputMethod[],
      responseTimeSamples: [300, 400, 350],
      inputAccuracySamples: [0.9, 0.85, 0.88],
      visualTrackingResults: {
        minReadableTextSize: 18,
        minContrastRatio: 5.0,
        colorBlindnessType: null,
        visualFieldRestriction: null,
      },
      audioResponsivenessResults: {
        hearingCapability: 'full',
        preferredAudioChannel: 'stereo',
      },
      motorAssessment: {
        reachableScreenZone: {
          topLeft: { x: 0, y: 0 },
          bottomRight: { x: 1920, y: 1080 },
        },
        clickPrecision: 8,
        holdDuration: 1200,
      },
      cognitiveAssessment: {
        preferredPacing: 'moderate',
        maxSimultaneousElements: 4,
        preferredInstructionFormat: 'multimodal',
      },
    },
    ...overrides,
  };
}

function makeBaseProfile(overrides?: Partial<AccessibilityProfile>): AccessibilityProfile {
  return {
    playerId: 'player1',
    version: 1,
    lastUpdated: 1000,
    inputMethods: ['keyboard', 'mouse'],
    responseTimeMs: 350,
    inputAccuracy: 0.88,
    minReadableTextSize: 18,
    minContrastRatio: 5.0,
    colorBlindnessType: null,
    visualFieldRestriction: null,
    hearingCapability: 'full',
    preferredAudioChannel: 'stereo',
    reachableScreenZone: {
      topLeft: { x: 0, y: 0 },
      bottomRight: { x: 1920, y: 1080 },
    },
    clickPrecision: 8,
    holdDuration: 1200,
    preferredPacing: 'moderate',
    maxSimultaneousElements: 4,
    preferredInstructionFormat: 'multimodal',
    learnedPreferences: {},
    manualOverrides: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProfileLearnerService', () => {
  describe('startOnboarding()', () => {
    it('creates an active onboarding session', async () => {
      const { service } = createService();
      const session = await service.startOnboarding('player1');

      expect(session.playerId).toBe('player1');
      expect(session.status).toBe('active');
      expect(session.sessionId).toContain('onboarding-player1');
      expect(session.startedAt).toBeGreaterThan(0);
    });

    it('initializes default observations', async () => {
      const { service } = createService();
      const session = await service.startOnboarding('player1');

      expect(session.observations.detectedInputMethods).toEqual([]);
      expect(session.observations.responseTimeSamples).toEqual([]);
      expect(session.observations.inputAccuracySamples).toEqual([]);
    });

    it('session is retrievable by ID', async () => {
      const { service } = createService();
      const session = await service.startOnboarding('player1');
      const retrieved = service.getSession(session.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    });

    it('can cancel an active session', async () => {
      const { service } = createService();
      const session = await service.startOnboarding('player1');
      service.cancelSession(session.sessionId);

      const retrieved = service.getSession(session.sessionId);
      expect(retrieved!.status).toBe('cancelled');
    });
  });

  describe('generateInitialProfile()', () => {
    it('generates a profile with all required fields populated', async () => {
      const { service } = createService();
      const data = makeOnboardingData();
      const profile = await service.generateInitialProfile(data);

      expect(profile.playerId).toBe('player1');
      expect(profile.version).toBe(1);
      expect(profile.inputMethods.length).toBeGreaterThan(0);
      expect(profile.responseTimeMs).toBeGreaterThan(0);
      expect(profile.inputAccuracy).toBeGreaterThan(0);
      expect(profile.inputAccuracy).toBeLessThanOrEqual(1);
      expect(profile.minReadableTextSize).toBe(18);
      expect(profile.minContrastRatio).toBe(5.0);
      expect(profile.hearingCapability).toBe('full');
      expect(profile.preferredAudioChannel).toBe('stereo');
      expect(profile.reachableScreenZone).toBeDefined();
      expect(profile.clickPrecision).toBe(8);
      expect(profile.holdDuration).toBe(1200);
      expect(profile.preferredPacing).toBe('moderate');
      expect(profile.maxSimultaneousElements).toBe(4);
      expect(profile.preferredInstructionFormat).toBe('multimodal');
      expect(profile.learnedPreferences).toEqual({});
      expect(profile.manualOverrides).toEqual({});
    });

    it('computes response time as median of samples', async () => {
      const { service } = createService();
      const data = makeOnboardingData({
        observations: {
          ...makeOnboardingData().observations,
          responseTimeSamples: [100, 500, 200],
        },
      });
      const profile = await service.generateInitialProfile(data);
      // Sorted: [100, 200, 500] → median = 200
      expect(profile.responseTimeMs).toBe(200);
    });

    it('computes input accuracy as median of samples', async () => {
      const { service } = createService();
      const data = makeOnboardingData({
        observations: {
          ...makeOnboardingData().observations,
          inputAccuracySamples: [0.7, 0.9, 0.8],
        },
      });
      const profile = await service.generateInitialProfile(data);
      // Sorted: [0.7, 0.8, 0.9] → median = 0.8
      expect(profile.inputAccuracy).toBe(0.8);
    });

    it('defaults to keyboard when no input methods detected', async () => {
      const { service } = createService();
      const data = makeOnboardingData({
        observations: {
          ...makeOnboardingData().observations,
          detectedInputMethods: [],
        },
      });
      const profile = await service.generateInitialProfile(data);
      expect(profile.inputMethods).toEqual(['keyboard']);
    });

    it('deduplicates and sorts input methods', async () => {
      const { service } = createService();
      const data = makeOnboardingData({
        observations: {
          ...makeOnboardingData().observations,
          detectedInputMethods: ['mouse', 'keyboard', 'mouse', 'voice', 'keyboard'],
        },
      });
      const profile = await service.generateInitialProfile(data);
      expect(profile.inputMethods).toEqual(['keyboard', 'mouse', 'voice']);
    });

    it('is deterministic — same input produces same output', async () => {
      const { service } = createService();
      const data = makeOnboardingData({ completedAt: 5000 });
      const profile1 = await service.generateInitialProfile(data);
      const profile2 = await service.generateInitialProfile(data);

      // Compare all derived fields (lastUpdated is set from completedAt, so deterministic)
      expect(profile1.inputMethods).toEqual(profile2.inputMethods);
      expect(profile1.responseTimeMs).toBe(profile2.responseTimeMs);
      expect(profile1.inputAccuracy).toBe(profile2.inputAccuracy);
      expect(profile1.minReadableTextSize).toBe(profile2.minReadableTextSize);
      expect(profile1.minContrastRatio).toBe(profile2.minContrastRatio);
      expect(profile1.hearingCapability).toBe(profile2.hearingCapability);
      expect(profile1.preferredPacing).toBe(profile2.preferredPacing);
    });

    it('persists the profile to the repository', async () => {
      const { service, playerRepo } = createService();
      const data = makeOnboardingData();
      await service.generateInitialProfile(data);

      expect(playerRepo.upsertProfile).toHaveBeenCalledTimes(1);
    });

    it('marks the onboarding session as completed', async () => {
      const { service } = createService();
      const session = await service.startOnboarding('player1');
      const data = makeOnboardingData({ sessionId: session.sessionId });
      await service.generateInitialProfile(data);

      const retrieved = service.getSession(session.sessionId);
      expect(retrieved!.status).toBe('completed');
    });

    it('handles empty response time samples with default', async () => {
      const { service } = createService();
      const data = makeOnboardingData({
        observations: {
          ...makeOnboardingData().observations,
          responseTimeSamples: [],
        },
      });
      const profile = await service.generateInitialProfile(data);
      expect(profile.responseTimeMs).toBe(500); // default
    });

    it('handles empty accuracy samples with default', async () => {
      const { service } = createService();
      const data = makeOnboardingData({
        observations: {
          ...makeOnboardingData().observations,
          inputAccuracySamples: [],
        },
      });
      const profile = await service.generateInitialProfile(data);
      expect(profile.inputAccuracy).toBe(0.8); // default
    });
  });

  describe('refineProfile()', () => {
    it('detects response time changes', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({ responseTimeMs: 350 }));
      const { service } = createService(playerRepo);

      const interaction: InteractionData = {
        timestamp: 3000,
        inputMethodsUsed: ['keyboard'],
        responseTimeMs: 500,
        inputAccuracy: 0.88,
        sessionId: 'session1',
      };

      const update = await service.refineProfile('player1', interaction);
      expect(update.requiresPlayerApproval).toBe(true);
      const rtChange = update.changes.find((c) => c.attribute === 'responseTimeMs');
      expect(rtChange).toBeDefined();
      expect(rtChange!.previousValue).toBe(350);
      expect(rtChange!.newValue).toBe(500);
    });

    it('detects input accuracy changes', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({ inputAccuracy: 0.88 }));
      const { service } = createService(playerRepo);

      const interaction: InteractionData = {
        timestamp: 3000,
        inputMethodsUsed: ['keyboard'],
        responseTimeMs: 350,
        inputAccuracy: 0.6,
        sessionId: 'session1',
      };

      const update = await service.refineProfile('player1', interaction);
      const accChange = update.changes.find((c) => c.attribute === 'inputAccuracy');
      expect(accChange).toBeDefined();
      expect(accChange!.previousValue).toBe(0.88);
      expect(accChange!.newValue).toBe(0.6);
    });

    it('detects new input methods', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({ inputMethods: ['keyboard'] }));
      const { service } = createService(playerRepo);

      const interaction: InteractionData = {
        timestamp: 3000,
        inputMethodsUsed: ['keyboard', 'voice'],
        responseTimeMs: 350,
        inputAccuracy: 0.88,
        sessionId: 'session1',
      };

      const update = await service.refineProfile('player1', interaction);
      const methodChange = update.changes.find((c) => c.attribute === 'inputMethods');
      expect(methodChange).toBeDefined();
      expect(methodChange!.newValue).toEqual(['keyboard', 'voice']);
    });

    it('preserves manual overrides during refinement', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({
        responseTimeMs: 350,
        manualOverrides: { responseTimeMs: 350 },
      }));
      const { service } = createService(playerRepo);

      const interaction: InteractionData = {
        timestamp: 3000,
        inputMethodsUsed: ['keyboard'],
        responseTimeMs: 600,
        inputAccuracy: 0.88,
        sessionId: 'session1',
      };

      const update = await service.refineProfile('player1', interaction);
      const rtChange = update.changes.find((c) => c.attribute === 'responseTimeMs');
      expect(rtChange).toBeUndefined();
    });

    it('returns no changes when values are within threshold', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({ responseTimeMs: 350, inputAccuracy: 0.88 }));
      const { service } = createService(playerRepo);

      const interaction: InteractionData = {
        timestamp: 3000,
        inputMethodsUsed: ['keyboard', 'mouse'],
        responseTimeMs: 355, // within 10% of 350
        inputAccuracy: 0.87, // within 0.05 of 0.88
        sessionId: 'session1',
      };

      const update = await service.refineProfile('player1', interaction);
      expect(update.changes).toHaveLength(0);
      expect(update.requiresPlayerApproval).toBe(false);
    });

    it('throws when no profile exists', async () => {
      const { service } = createService();
      const interaction: InteractionData = {
        timestamp: 3000,
        inputMethodsUsed: ['keyboard'],
        responseTimeMs: 350,
        inputAccuracy: 0.88,
        sessionId: 'session1',
      };

      await expect(service.refineProfile('nonexistent', interaction)).rejects.toThrow(
        'No profile found',
      );
    });

    it('all changes require player approval', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({ responseTimeMs: 350 }));
      const { service } = createService(playerRepo);

      const interaction: InteractionData = {
        timestamp: 3000,
        inputMethodsUsed: ['keyboard'],
        responseTimeMs: 600,
        inputAccuracy: 0.88,
        sessionId: 'session1',
      };

      const update = await service.refineProfile('player1', interaction);
      expect(update.requiresPlayerApproval).toBe(true);
    });
  });

  describe('applyProfileChanges()', () => {
    it('applies accepted changes and increments version', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({ version: 1, responseTimeMs: 350 }));
      const { service } = createService(playerRepo);

      await service.applyProfileChanges('player1', [
        {
          attribute: 'responseTimeMs',
          previousValue: 350,
          newValue: 500,
          confidence: 0.7,
          reason: 'test',
        },
      ]);

      const updated = playerRepo._getProfile('player1')!;
      expect(updated.responseTimeMs).toBe(500);
      expect(updated.version).toBe(2);
    });

    it('skips changes for manually overridden attributes', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({
        responseTimeMs: 350,
        manualOverrides: { responseTimeMs: 350 },
      }));
      const { service } = createService(playerRepo);

      await service.applyProfileChanges('player1', [
        {
          attribute: 'responseTimeMs',
          previousValue: 350,
          newValue: 500,
          confidence: 0.7,
          reason: 'test',
        },
      ]);

      const updated = playerRepo._getProfile('player1')!;
      expect(updated.responseTimeMs).toBe(350); // unchanged
    });

    it('throws when no profile exists', async () => {
      const { service } = createService();
      await expect(
        service.applyProfileChanges('nonexistent', []),
      ).rejects.toThrow('No profile found');
    });
  });

  describe('setManualOverride()', () => {
    it('sets the attribute value and records the override', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile());
      const { service } = createService(playerRepo);

      const updated = await service.setManualOverride('player1', 'responseTimeMs', 200);
      expect(updated.responseTimeMs).toBe(200);
      expect(updated.manualOverrides['responseTimeMs']).toBe(200);
    });

    it('increments version on override', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile({ version: 3 }));
      const { service } = createService(playerRepo);

      const updated = await service.setManualOverride('player1', 'responseTimeMs', 200);
      expect(updated.version).toBe(4);
    });

    it('throws when no profile exists', async () => {
      const { service } = createService();
      await expect(
        service.setManualOverride('nonexistent', 'responseTimeMs', 200),
      ).rejects.toThrow('No profile found');
    });
  });

  describe('detectAbilityChanges()', () => {
    it('detects fatigue when response time increases significantly', () => {
      const { service } = createService();
      const data: InteractionData[] = [
        { timestamp: 1000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 2000, inputMethodsUsed: ['keyboard'], responseTimeMs: 310, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 3000, inputMethodsUsed: ['keyboard'], responseTimeMs: 320, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 4000, inputMethodsUsed: ['keyboard'], responseTimeMs: 500, inputAccuracy: 0.9, sessionId: 's2' },
        { timestamp: 5000, inputMethodsUsed: ['keyboard'], responseTimeMs: 520, inputAccuracy: 0.9, sessionId: 's2' },
        { timestamp: 6000, inputMethodsUsed: ['keyboard'], responseTimeMs: 550, inputAccuracy: 0.9, sessionId: 's2' },
      ];

      const result = service.detectAbilityChanges('player1', data);
      const fatigueChange = result.detectedChanges.find((c) => c.changeType === 'fatigue');
      expect(fatigueChange).toBeDefined();
      expect(fatigueChange!.attribute).toBe('responseTimeMs');
    });

    it('detects progressive condition when accuracy decreases', () => {
      const { service } = createService();
      const data: InteractionData[] = [
        { timestamp: 1000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 2000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.88, sessionId: 's1' },
        { timestamp: 3000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.85, sessionId: 's1' },
        { timestamp: 4000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.6, sessionId: 's2' },
        { timestamp: 5000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.55, sessionId: 's2' },
        { timestamp: 6000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.5, sessionId: 's2' },
      ];

      const result = service.detectAbilityChanges('player1', data);
      const progressiveChange = result.detectedChanges.find(
        (c) => c.changeType === 'progressive_condition',
      );
      expect(progressiveChange).toBeDefined();
      expect(progressiveChange!.attribute).toBe('inputAccuracy');
    });

    it('detects improvement when response time decreases', () => {
      const { service } = createService();
      const data: InteractionData[] = [
        { timestamp: 1000, inputMethodsUsed: ['keyboard'], responseTimeMs: 600, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 2000, inputMethodsUsed: ['keyboard'], responseTimeMs: 580, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 3000, inputMethodsUsed: ['keyboard'], responseTimeMs: 550, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 4000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.9, sessionId: 's2' },
        { timestamp: 5000, inputMethodsUsed: ['keyboard'], responseTimeMs: 280, inputAccuracy: 0.9, sessionId: 's2' },
        { timestamp: 6000, inputMethodsUsed: ['keyboard'], responseTimeMs: 260, inputAccuracy: 0.9, sessionId: 's2' },
      ];

      const result = service.detectAbilityChanges('player1', data);
      const improvement = result.detectedChanges.find((c) => c.changeType === 'improvement');
      expect(improvement).toBeDefined();
      expect(improvement!.attribute).toBe('responseTimeMs');
    });

    it('returns no changes with insufficient data', () => {
      const { service } = createService();
      const data: InteractionData[] = [
        { timestamp: 1000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 2000, inputMethodsUsed: ['keyboard'], responseTimeMs: 600, inputAccuracy: 0.5, sessionId: 's1' },
      ];

      const result = service.detectAbilityChanges('player1', data);
      expect(result.detectedChanges).toHaveLength(0);
    });

    it('returns no changes when values are stable', () => {
      const { service } = createService();
      const data: InteractionData[] = [
        { timestamp: 1000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.9, sessionId: 's1' },
        { timestamp: 2000, inputMethodsUsed: ['keyboard'], responseTimeMs: 305, inputAccuracy: 0.89, sessionId: 's1' },
        { timestamp: 3000, inputMethodsUsed: ['keyboard'], responseTimeMs: 310, inputAccuracy: 0.88, sessionId: 's1' },
        { timestamp: 4000, inputMethodsUsed: ['keyboard'], responseTimeMs: 300, inputAccuracy: 0.9, sessionId: 's2' },
        { timestamp: 5000, inputMethodsUsed: ['keyboard'], responseTimeMs: 305, inputAccuracy: 0.89, sessionId: 's2' },
        { timestamp: 6000, inputMethodsUsed: ['keyboard'], responseTimeMs: 310, inputAccuracy: 0.88, sessionId: 's2' },
      ];

      const result = service.detectAbilityChanges('player1', data);
      expect(result.detectedChanges).toHaveLength(0);
    });
  });

  describe('exportProfile()', () => {
    it('exports a profile with checksum', async () => {
      const playerRepo = makeStubPlayerRepo();
      playerRepo._setProfile('player1', makeBaseProfile());
      const { service } = createService(playerRepo);

      const exported = await service.exportProfile('player1');
      expect(exported.version).toBe(1);
      expect(exported.checksum).toBeTruthy();
      expect(exported.profile).toBeDefined();
      expect((exported.profile as Record<string, unknown>).playerId).toBeUndefined();
    });

    it('throws when no profile exists', async () => {
      const { service } = createService();
      await expect(service.exportProfile('nonexistent')).rejects.toThrow('No profile found');
    });
  });

  describe('importProfile()', () => {
    it('imports a valid exported profile', async () => {
      const baseProfile = makeBaseProfile();
      const exported = serializeAccessibilityProfile(baseProfile);

      const { service } = createService();
      const imported = await service.importProfile(exported);

      expect(imported.version).toBe(baseProfile.version);
      expect(imported.responseTimeMs).toBe(baseProfile.responseTimeMs);
      expect(imported.inputMethods).toEqual(baseProfile.inputMethods);
    });

    it('throws on checksum mismatch', async () => {
      const baseProfile = makeBaseProfile();
      const exported = serializeAccessibilityProfile(baseProfile);
      exported.checksum = 'invalid-checksum';

      const { service } = createService();
      await expect(service.importProfile(exported)).rejects.toThrow('checksum mismatch');
    });
  });

  describe('importProfileForPlayer()', () => {
    it('imports and assigns to a specific player', async () => {
      const baseProfile = makeBaseProfile();
      const exported = serializeAccessibilityProfile(baseProfile);

      const playerRepo = makeStubPlayerRepo();
      const { service } = createService(playerRepo);

      const imported = await service.importProfileForPlayer('player2', exported);
      expect(imported.playerId).toBe('player2');
      expect(playerRepo.upsertProfile).toHaveBeenCalled();
    });
  });

  describe('stores no raw interaction recordings', () => {
    it('profile contains only derived attributes, not raw samples', async () => {
      const { service } = createService();
      const data = makeOnboardingData();
      const profile = await service.generateInitialProfile(data);

      // The profile should not contain raw samples
      const profileJson = JSON.stringify(profile);
      expect(profileJson).not.toContain('responseTimeSamples');
      expect(profileJson).not.toContain('inputAccuracySamples');
    });
  });
});

// ---------------------------------------------------------------------------
// Pure helper function tests
// ---------------------------------------------------------------------------

describe('computeMedian()', () => {
  it('returns 0 for empty array', () => {
    expect(computeMedian([])).toBe(0);
  });

  it('returns the single element for length-1 array', () => {
    expect(computeMedian([42])).toBe(42);
  });

  it('returns the middle element for odd-length array', () => {
    expect(computeMedian([3, 1, 2])).toBe(2);
  });

  it('returns the average of two middle elements for even-length array', () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles unsorted input', () => {
    expect(computeMedian([5, 1, 3])).toBe(3);
  });
});

describe('average()', () => {
  it('returns 0 for empty array', () => {
    expect(average([])).toBe(0);
  });

  it('returns the single element for length-1 array', () => {
    expect(average([10])).toBe(10);
  });

  it('computes the arithmetic mean', () => {
    expect(average([10, 20, 30])).toBe(20);
  });
});

describe('clamp()', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('deduplicateAndSort()', () => {
  it('removes duplicates and sorts', () => {
    expect(deduplicateAndSort(['mouse', 'keyboard', 'mouse', 'voice'])).toEqual([
      'keyboard',
      'mouse',
      'voice',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateAndSort([])).toEqual([]);
  });
});
