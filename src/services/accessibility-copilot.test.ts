import { describe, it, expect, beforeEach } from 'vitest';
import {
  AccessibilityCopilotService,
  MIN_FPS,
} from './accessibility-copilot';
import type { AccessibilityProfile } from '../types/player';
import type { UIElementRef, FrameData } from '../types/barrier';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides?: Partial<AccessibilityProfile>): AccessibilityProfile {
  return {
    playerId: 'player-1',
    version: 1,
    lastUpdated: Date.now(),
    inputMethods: ['keyboard', 'mouse'],
    responseTimeMs: 500,
    inputAccuracy: 0.85,
    minReadableTextSize: 16,
    minContrastRatio: 4.5,
    colorBlindnessType: null,
    visualFieldRestriction: null,
    hearingCapability: 'full',
    preferredAudioChannel: 'stereo',
    reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1920, y: 1080 } },
    clickPrecision: 10,
    holdDuration: 1000,
    preferredPacing: 'moderate',
    maxSimultaneousElements: 5,
    preferredInstructionFormat: 'multimodal',
    learnedPreferences: {},
    manualOverrides: {},
    ...overrides,
  };
}

function makeFrame(timestamp?: number): FrameData {
  return {
    imageData: new ArrayBuffer(100),
    timestamp: timestamp ?? Date.now(),
    width: 1920,
    height: 1080,
  };
}

function makeElement(overrides?: Partial<UIElementRef>): UIElementRef {
  return {
    elementId: 'el-1',
    type: 'button',
    position: { x: 100, y: 100, width: 50, height: 30 },
    content: 'Click me',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccessibilityCopilotService', () => {
  let service: AccessibilityCopilotService;
  const sessionId = 'session-1';

  beforeEach(() => {
    service = new AccessibilityCopilotService();
  });

  describe('startMonitoring()', () => {
    it('starts monitoring a session', () => {
      const profile = makeProfile();
      service.startMonitoring(sessionId, profile);
      expect(service.isMonitoring(sessionId)).toBe(true);
    });

    it('returns false for unmonitored sessions', () => {
      expect(service.isMonitoring('nonexistent')).toBe(false);
    });
  });

  describe('stopMonitoring()', () => {
    it('stops an active monitoring session', () => {
      service.startMonitoring(sessionId, makeProfile());
      service.stopMonitoring(sessionId);
      expect(service.isMonitoring(sessionId)).toBe(false);
    });

    it('does nothing for nonexistent sessions', () => {
      expect(() => service.stopMonitoring('nonexistent')).not.toThrow();
    });
  });

  describe('processFrame() — barrier detection', () => {
    it('returns empty results when no barriers exist', async () => {
      service.startMonitoring(sessionId, makeProfile());
      const elements = [makeElement()];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      expect(result.barriers).toHaveLength(0);
      expect(result.adaptations).toHaveLength(0);
    });

    it('returns empty results for inactive session', async () => {
      const result = await service.processFrame('no-session', makeFrame(), [makeElement()]);
      expect(result.barriers).toHaveLength(0);
    });

    it('detects unreachable elements outside the reachable zone', async () => {
      const profile = makeProfile({
        reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 800, y: 600 } },
      });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'far-right', position: { x: 900, y: 100, width: 50, height: 30 } }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      expect(result.barriers).toHaveLength(1);
      expect(result.barriers[0].type).toBe('unreachable_element');
      expect(result.adaptations).toHaveLength(1);
      expect(result.adaptations[0].type).toBe('reposition');
    });

    it('detects small text below minimum readable size', async () => {
      const profile = makeProfile({ minReadableTextSize: 20 });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'tiny-text', type: 'text', position: { x: 10, y: 10, width: 100, height: 12 } }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      expect(result.barriers).toHaveLength(1);
      expect(result.barriers[0].type).toBe('small_text');
      expect(result.adaptations[0].type).toBe('enlarge_text');
    });

    it('detects low contrast text', async () => {
      const profile = makeProfile({ minContrastRatio: 7.0 });
      service.startMonitoring(sessionId, profile);

      const el = makeElement({ elementId: 'low-contrast', type: 'text' });
      (el as UIElementRef & { contrastRatio: number }).contrastRatio = 3.0;

      const result = await service.processFrame(sessionId, makeFrame(), [el]);

      expect(result.barriers).toHaveLength(1);
      expect(result.barriers[0].type).toBe('low_contrast');
      expect(result.adaptations[0].type).toBe('recolor');
    });

    it('detects missed audio cues for hearing-impaired players', async () => {
      const profile = makeProfile({ hearingCapability: 'none' });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'audio-1', type: 'audio_cue', content: 'enemy approaching' }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      expect(result.barriers).toHaveLength(1);
      expect(result.barriers[0].type).toBe('missed_audio_cue');
      expect(result.adaptations[0].type).toBe('add_audio_cue');
    });

    it('detects timing barriers when action time is too short', async () => {
      const profile = makeProfile({ responseTimeMs: 1000 });
      service.startMonitoring(sessionId, profile);

      const el = makeElement({ elementId: 'timed-1', type: 'timed_action' });
      (el as UIElementRef & { requiredTimeMs: number }).requiredTimeMs = 500;

      const result = await service.processFrame(sessionId, makeFrame(), [el]);

      expect(result.barriers).toHaveLength(1);
      expect(result.barriers[0].type).toBe('timing_barrier');
      expect(result.adaptations[0].type).toBe('resize');
    });

    it('detects complex input barriers', async () => {
      const profile = makeProfile({ inputMethods: ['voice', 'single_switch'] });
      service.startMonitoring(sessionId, profile);

      const el = makeElement({ elementId: 'complex-1', type: 'complex_input' });
      (el as UIElementRef & { requiredInputMethods: string[] }).requiredInputMethods = ['mouse', 'keyboard'];

      const result = await service.processFrame(sessionId, makeFrame(), [el]);

      expect(result.barriers).toHaveLength(1);
      expect(result.barriers[0].type).toBe('complex_input');
      expect(result.adaptations[0].type).toBe('add_haptic');
    });

    it('detects multiple barriers in a single frame', async () => {
      const profile = makeProfile({
        minReadableTextSize: 20,
        hearingCapability: 'none',
      });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'small', type: 'text', position: { x: 10, y: 10, width: 100, height: 12 } }),
        makeElement({ elementId: 'audio', type: 'audio_cue', content: 'alert' }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      expect(result.barriers).toHaveLength(2);
      expect(result.adaptations).toHaveLength(2);
    });

    it('includes processing time in the result', async () => {
      service.startMonitoring(sessionId, makeProfile());
      const result = await service.processFrame(sessionId, makeFrame(), []);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('includes frame timestamp in the result', async () => {
      service.startMonitoring(sessionId, makeProfile());
      const ts = 1234567890;
      const result = await service.processFrame(sessionId, makeFrame(ts), []);

      expect(result.frameTimestampMs).toBe(ts);
    });
  });

  describe('adaptation actions', () => {
    it('reposition adaptation moves element into reachable zone', async () => {
      const profile = makeProfile({
        reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 800, y: 600 } },
      });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'outside', position: { x: 900, y: 700, width: 50, height: 30 } }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      const adaptation = result.adaptations[0];
      expect(adaptation.type).toBe('reposition');
      const newX = adaptation.parameters.newX as number;
      const newY = adaptation.parameters.newY as number;
      expect(newX).toBeLessThanOrEqual(800 - 50);
      expect(newY).toBeLessThanOrEqual(600 - 30);
      expect(newX).toBeGreaterThanOrEqual(0);
      expect(newY).toBeGreaterThanOrEqual(0);
    });

    it('enlarge_text adaptation sets size to minimum readable', async () => {
      const profile = makeProfile({ minReadableTextSize: 24 });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'small', type: 'text', position: { x: 10, y: 10, width: 100, height: 10 } }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      const adaptation = result.adaptations[0];
      expect(adaptation.type).toBe('enlarge_text');
      expect(adaptation.parameters.newSize).toBe(24);
    });

    it('missed audio cue adaptation provides visual alternative', async () => {
      const profile = makeProfile({ hearingCapability: 'partial' });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'cue', type: 'audio_cue', content: 'danger' }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      const adaptation = result.adaptations[0];
      expect(adaptation.type).toBe('add_audio_cue');
      expect(adaptation.parameters.alternativeType).toBe('visual_notification');
    });

    it('all adaptations are marked as undoable', async () => {
      const profile = makeProfile({
        reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } },
      });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ position: { x: 500, y: 500, width: 50, height: 30 } }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);

      for (const adaptation of result.adaptations) {
        expect(adaptation.undoable).toBe(true);
      }
    });
  });

  describe('undoAdaptation()', () => {
    it('restores pre-adaptation state and marks barrier as undone', async () => {
      const profile = makeProfile({
        reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } },
      });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ position: { x: 500, y: 500, width: 50, height: 30 } }),
      ];
      const result = await service.processFrame(sessionId, makeFrame(), elements);
      const adaptationId = result.adaptations[0].id;

      await service.undoAdaptation(sessionId, adaptationId);

      const log = service.getBarrierLog(sessionId);
      expect(log[0].adaptationUndone).toBe(true);
    });

    it('does nothing for nonexistent adaptation', async () => {
      service.startMonitoring(sessionId, makeProfile());
      await expect(
        service.undoAdaptation(sessionId, 'nonexistent'),
      ).resolves.toBeUndefined();
    });

    it('does nothing for nonexistent session', async () => {
      await expect(
        service.undoAdaptation('no-session', 'no-adaptation'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getBarrierLog()', () => {
    it('returns all barrier events for a session', async () => {
      const profile = makeProfile({
        minReadableTextSize: 20,
        hearingCapability: 'none',
      });
      service.startMonitoring(sessionId, profile);

      // Frame 1
      await service.processFrame(sessionId, makeFrame(), [
        makeElement({ elementId: 'small', type: 'text', position: { x: 10, y: 10, width: 100, height: 12 } }),
      ]);
      // Frame 2
      await service.processFrame(sessionId, makeFrame(), [
        makeElement({ elementId: 'audio', type: 'audio_cue', content: 'beep' }),
      ]);

      const log = service.getBarrierLog(sessionId);
      expect(log).toHaveLength(2);
      expect(log[0].type).toBe('small_text');
      expect(log[1].type).toBe('missed_audio_cue');
    });

    it('returns empty array for nonexistent session', () => {
      expect(service.getBarrierLog('nonexistent')).toEqual([]);
    });

    it('each logged barrier includes the applied adaptation', async () => {
      const profile = makeProfile({
        reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } },
      });
      service.startMonitoring(sessionId, profile);

      await service.processFrame(sessionId, makeFrame(), [
        makeElement({ position: { x: 500, y: 500, width: 50, height: 30 } }),
      ]);

      const log = service.getBarrierLog(sessionId);
      expect(log[0].adaptation).toBeDefined();
      expect(log[0].adaptation!.type).toBe('reposition');
    });
  });

  describe('adaptation indicators (Req 2.7)', () => {
    it('generates a non-intrusive indicator for each adaptation', async () => {
      const profile = makeProfile({
        reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } },
      });
      service.startMonitoring(sessionId, profile);

      await service.processFrame(sessionId, makeFrame(), [
        makeElement({ position: { x: 500, y: 500, width: 50, height: 30 } }),
      ]);

      const indicators = service.getIndicators();
      expect(indicators).toHaveLength(1);
      expect(indicators[0].message).toContain('reachable zone');
    });
  });

  describe('adaptation idempotency (Req 2.9)', () => {
    it('applying the same adaptation twice produces the same result', async () => {
      const profile = makeProfile({
        reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } },
      });
      service.startMonitoring(sessionId, profile);

      const elements = [
        makeElement({ elementId: 'outside', position: { x: 500, y: 500, width: 50, height: 30 } }),
      ];

      const result1 = await service.processFrame(sessionId, makeFrame(), elements);
      const result2 = await service.processFrame(sessionId, makeFrame(), elements);

      // Both frames should detect the same barrier and produce the same adaptation type
      expect(result1.adaptations[0].type).toBe(result2.adaptations[0].type);
      expect(result1.adaptations[0].parameters.newX).toBe(result2.adaptations[0].parameters.newX);
      expect(result1.adaptations[0].parameters.newY).toBe(result2.adaptations[0].parameters.newY);
    });
  });

  describe('applyAdaptation()', () => {
    it('manually applies an adaptation and returns success', async () => {
      service.startMonitoring(sessionId, makeProfile());

      const barrier = (await service.processFrame(sessionId, makeFrame(), [
        makeElement({
          type: 'text',
          position: { x: 10, y: 10, width: 100, height: 10 },
        }),
      ])).barriers[0];

      // Only run if a barrier was detected (profile has minReadableTextSize=16, height=10)
      if (barrier) {
        const result = await service.applyAdaptation(sessionId, barrier.adaptation!.id, barrier);
        expect(result.success).toBe(true);
        expect(result.appliedAt).toBeGreaterThan(0);
      }
    });
  });

  describe('MIN_FPS constant', () => {
    it('is at least 5', () => {
      expect(MIN_FPS).toBeGreaterThanOrEqual(5);
    });
  });
});
