import { describe, it, expect, vi } from 'vitest';
import {
  EmotionEngine,
  type FacialExpressionAnalyzer,
  StubFacialExpressionAnalyzer,
} from './emotion-engine';
import type { ConsentState } from '../types/consent';
import type { EmotionClassification, InputPatternWindow } from '../types/emotion';
import type { GameContext } from '../types/game';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConsentState(webcamGranted: boolean): ConsentState {
  return {
    playerId: 'player-1',
    consents: {
      webcam: {
        granted: webcamGranted,
        ...(webcamGranted ? { grantedAt: Date.now() } : { revokedAt: Date.now() }),
      },
      interaction_patterns: { granted: true, grantedAt: Date.now() },
      profile_learning: { granted: true, grantedAt: Date.now() },
      voice_input: { granted: false },
    },
    lastUpdated: Date.now(),
  };
}

function makeGameContext(): GameContext {
  return {
    sessionId: 'session-1',
    playerId: 'player-1',
    gameState: {
      sessionId: 'session-1',
      gameSpecId: 'game-1',
      currentSegment: 'level-1',
      entities: [],
      variables: {},
      timestamp: Date.now(),
    },
  };
}

function makeFakeImageData(): ImageData {
  // Minimal ImageData-like object for testing
  return { width: 1, height: 1, data: new Uint8ClampedArray(4), colorSpace: 'srgb' } as ImageData;
}

function makeAnalyzer(category: EmotionClassification['category'], confidence: number): FacialExpressionAnalyzer {
  return {
    load: vi.fn(async () => {}),
    classify: vi.fn(() => ({ category, confidence, timestamp: Date.now() })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmotionEngine', () => {
  // -----------------------------------------------------------------------
  // initialize()
  // -----------------------------------------------------------------------
  describe('initialize()', () => {
    it('enables webcam when consent is granted', () => {
      const engine = new EmotionEngine();
      engine.initialize(makeConsentState(true));
      expect(engine.isWebcamEnabled()).toBe(true);
    });

    it('disables webcam when consent is not granted', () => {
      const engine = new EmotionEngine();
      engine.initialize(makeConsentState(false));
      expect(engine.isWebcamEnabled()).toBe(false);
    });

    it('loads the facial expression model when webcam consent is granted', () => {
      const analyzer = makeAnalyzer('neutral', 0.5);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(true));
      expect(analyzer.load).toHaveBeenCalled();
    });

    it('does not load the model when webcam consent is denied', () => {
      const analyzer = makeAnalyzer('neutral', 0.5);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(false));
      expect(analyzer.load).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // processWebcamFrame()
  // -----------------------------------------------------------------------
  describe('processWebcamFrame()', () => {
    it('returns classification when webcam consent is granted', () => {
      const analyzer = makeAnalyzer('engaged', 0.8);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(true));

      const result = engine.processWebcamFrame(makeFakeImageData());
      expect(result).not.toBeNull();
      expect(result!.category).toBe('engaged');
      expect(result!.confidence).toBe(0.8);
    });

    it('returns null when webcam consent is not granted', () => {
      const engine = new EmotionEngine();
      engine.initialize(makeConsentState(false));

      const result = engine.processWebcamFrame(makeFakeImageData());
      expect(result).toBeNull();
    });

    it('returns null after consent is revoked', () => {
      const analyzer = makeAnalyzer('engaged', 0.8);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(true));

      // Verify it works first
      expect(engine.processWebcamFrame(makeFakeImageData())).not.toBeNull();

      // Revoke consent
      engine.revokeWebcamConsent();
      expect(engine.processWebcamFrame(makeFakeImageData())).toBeNull();
    });

    it('does not store raw imagery — only returns classification', () => {
      const analyzer = makeAnalyzer('frustrated', 0.9);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(true));

      const result = engine.processWebcamFrame(makeFakeImageData());
      // The result is an EmotionClassification, not raw image data
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('timestamp');
      expect(result).not.toHaveProperty('data');
      expect(result).not.toHaveProperty('width');
    });
  });

  // -----------------------------------------------------------------------
  // analyzeInputPatterns()
  // -----------------------------------------------------------------------
  describe('analyzeInputPatterns()', () => {
    it('classifies high error rate + high hesitation as frustrated', () => {
      const engine = new EmotionEngine();
      const patterns: InputPatternWindow = {
        pauseFrequency: 0.3,
        errorRate: 0.7,
        inputHesitationMs: 3000,
        windowDurationMs: 10000,
      };
      const result = engine.analyzeInputPatterns(patterns);
      expect(result.category).toBe('frustrated');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('classifies high hesitation + low error rate as confused', () => {
      const engine = new EmotionEngine();
      const patterns: InputPatternWindow = {
        pauseFrequency: 0.3,
        errorRate: 0.2,
        inputHesitationMs: 3000,
        windowDurationMs: 10000,
      };
      const result = engine.analyzeInputPatterns(patterns);
      expect(result.category).toBe('confused');
    });

    it('classifies low input frequency + low error rate as disengaged', () => {
      const engine = new EmotionEngine();
      const patterns: InputPatternWindow = {
        pauseFrequency: 0.9,
        errorRate: 0.1,
        inputHesitationMs: 500,
        windowDurationMs: 10000,
      };
      const result = engine.analyzeInputPatterns(patterns);
      expect(result.category).toBe('disengaged');
    });

    it('classifies normal active patterns as engaged', () => {
      const engine = new EmotionEngine();
      const patterns: InputPatternWindow = {
        pauseFrequency: 0.1,
        errorRate: 0.1,
        inputHesitationMs: 500,
        windowDurationMs: 10000,
      };
      const result = engine.analyzeInputPatterns(patterns);
      expect(result.category).toBe('engaged');
    });

    it('classifies ambiguous patterns as neutral', () => {
      const engine = new EmotionEngine();
      const patterns: InputPatternWindow = {
        pauseFrequency: 0.5,
        errorRate: 0.4,
        inputHesitationMs: 1000,
        windowDurationMs: 10000,
      };
      const result = engine.analyzeInputPatterns(patterns);
      expect(result.category).toBe('neutral');
    });

    it('always returns confidence between 0 and 1', () => {
      const engine = new EmotionEngine();
      const extremePatterns: InputPatternWindow = {
        pauseFrequency: 1.0,
        errorRate: 1.0,
        inputHesitationMs: 100000,
        windowDurationMs: 100000,
      };
      const result = engine.analyzeInputPatterns(extremePatterns);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // fuseSignals()
  // -----------------------------------------------------------------------
  describe('fuseSignals()', () => {
    it('uses input pattern only when webcam is null', () => {
      const engine = new EmotionEngine();
      engine.initialize(makeConsentState(false));

      const input: EmotionClassification = {
        category: 'frustrated',
        confidence: 0.8,
        timestamp: Date.now(),
      };
      const state = engine.fuseSignals(null, input);
      expect(state.current).toBe('frustrated');
    });

    it('prefers higher-confidence webcam signal', () => {
      const engine = new EmotionEngine();
      engine.initialize(makeConsentState(true));

      const webcam: EmotionClassification = {
        category: 'engaged',
        confidence: 0.9,
        timestamp: Date.now(),
      };
      const input: EmotionClassification = {
        category: 'neutral',
        confidence: 0.5,
        timestamp: Date.now(),
      };
      const state = engine.fuseSignals(webcam, input);
      expect(state.current).toBe('engaged');
    });

    it('prefers higher-confidence input signal', () => {
      const engine = new EmotionEngine();
      engine.initialize(makeConsentState(true));

      const webcam: EmotionClassification = {
        category: 'neutral',
        confidence: 0.4,
        timestamp: Date.now(),
      };
      const input: EmotionClassification = {
        category: 'confused',
        confidence: 0.8,
        timestamp: Date.now(),
      };
      const state = engine.fuseSignals(webcam, input);
      expect(state.current).toBe('confused');
    });

    it('prefers input when confidence is equal', () => {
      const engine = new EmotionEngine();
      const webcam: EmotionClassification = {
        category: 'engaged',
        confidence: 0.7,
        timestamp: Date.now(),
      };
      const input: EmotionClassification = {
        category: 'frustrated',
        confidence: 0.7,
        timestamp: Date.now(),
      };
      const state = engine.fuseSignals(webcam, input);
      expect(state.current).toBe('frustrated');
    });

    it('tracks previous state on transition', () => {
      const engine = new EmotionEngine();

      // First signal → neutral to engaged
      const input1: EmotionClassification = {
        category: 'engaged',
        confidence: 0.8,
        timestamp: Date.now(),
      };
      engine.fuseSignals(null, input1);

      // Second signal → engaged to frustrated
      const input2: EmotionClassification = {
        category: 'frustrated',
        confidence: 0.8,
        timestamp: Date.now(),
      };
      const state = engine.fuseSignals(null, input2);
      expect(state.current).toBe('frustrated');
      expect(state.previous).toBe('engaged');
    });

    it('records entries in the state log', () => {
      const engine = new EmotionEngine();
      const input: EmotionClassification = {
        category: 'engaged',
        confidence: 0.8,
        timestamp: Date.now(),
      };
      engine.fuseSignals(null, input);

      const log = engine.getStateLog();
      expect(log.length).toBe(1);
      expect(log[0].category).toBe('engaged');
      expect(log[0].source).toBe('input_pattern');
    });

    it('records source as fused when both signals present', () => {
      const engine = new EmotionEngine();
      const webcam: EmotionClassification = {
        category: 'engaged',
        confidence: 0.9,
        timestamp: Date.now(),
      };
      const input: EmotionClassification = {
        category: 'neutral',
        confidence: 0.5,
        timestamp: Date.now(),
      };
      engine.fuseSignals(webcam, input);

      const log = engine.getStateLog();
      expect(log[0].source).toBe('fused');
    });

    it('reflects webcamEnabled in the returned state', () => {
      const engine = new EmotionEngine();
      engine.initialize(makeConsentState(false));

      const input: EmotionClassification = {
        category: 'neutral',
        confidence: 0.5,
        timestamp: Date.now(),
      };
      const state = engine.fuseSignals(null, input);
      expect(state.webcamEnabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // triggerIntervention()
  // -----------------------------------------------------------------------
  describe('triggerIntervention()', () => {
    it('triggers hint/difficulty/pacing for frustrated >10s', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'frustrated',
        confidence: 0.9,
        timestamp: Date.now(),
      });

      // Simulate >10s duration
      const longState = { ...state, durationMs: 15000 };
      const intervention = engine.triggerIntervention(longState, ctx);

      expect(intervention).not.toBeNull();
      expect(['hint', 'difficulty_reduction', 'pacing_adjustment']).toContain(
        intervention!.type,
      );
      expect(intervention!.priority).toBe('high');
    });

    it('does not trigger for frustrated ≤10s', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'frustrated',
        confidence: 0.9,
        timestamp: Date.now(),
      });

      const shortState = { ...state, durationMs: 5000 };
      const intervention = engine.triggerIntervention(shortState, ctx);
      expect(intervention).toBeNull();
    });

    it('triggers objective_explanation for confused', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'confused',
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const intervention = engine.triggerIntervention(state, ctx);
      expect(intervention).not.toBeNull();
      expect(intervention!.type).toBe('objective_explanation');
      expect(intervention!.priority).toBe('medium');
    });

    it('triggers activity_change/break for disengaged >20s', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'disengaged',
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const longState = { ...state, durationMs: 25000 };
      const intervention = engine.triggerIntervention(longState, ctx);

      expect(intervention).not.toBeNull();
      expect(['activity_change', 'break_suggestion']).toContain(intervention!.type);
    });

    it('does not trigger for disengaged ≤20s', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'disengaged',
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const shortState = { ...state, durationMs: 10000 };
      const intervention = engine.triggerIntervention(shortState, ctx);
      expect(intervention).toBeNull();
    });

    it('does not trigger for neutral state', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'neutral',
        confidence: 0.5,
        timestamp: Date.now(),
      });

      const intervention = engine.triggerIntervention(state, ctx);
      expect(intervention).toBeNull();
    });

    it('does not trigger for engaged state', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'engaged',
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const intervention = engine.triggerIntervention(state, ctx);
      expect(intervention).toBeNull();
    });

    it('records intervention in the log', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      engine.fuseSignals(null, {
        category: 'confused',
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const state = engine.getCurrentState();
      engine.triggerIntervention(state, ctx);

      const log = engine.getInterventionLog();
      expect(log.length).toBe(1);
      expect(log[0].intervention.type).toBe('objective_explanation');
      expect(log[0].emotionAtTrigger).toBe('confused');
    });

    it('triggers break_suggestion for very long disengagement (>40s)', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();
      const state = engine.fuseSignals(null, {
        category: 'disengaged',
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const veryLongState = { ...state, durationMs: 45000 };
      const intervention = engine.triggerIntervention(veryLongState, ctx);
      expect(intervention).not.toBeNull();
      expect(intervention!.type).toBe('break_suggestion');
    });
  });

  // -----------------------------------------------------------------------
  // Intervention recording (Req 3.9)
  // -----------------------------------------------------------------------
  describe('intervention recording', () => {
    it('records intervention type and subsequent emotion state change', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();

      // Trigger confused intervention
      engine.fuseSignals(null, {
        category: 'confused',
        confidence: 0.8,
        timestamp: Date.now(),
      });
      const state = engine.getCurrentState();
      engine.triggerIntervention(state, ctx);

      // Record post-intervention state
      engine.recordPostInterventionState('neutral');

      const log = engine.getInterventionLog();
      expect(log.length).toBe(1);
      expect(log[0].intervention.type).toBe('objective_explanation');
      expect(log[0].postInterventionState).toBe('neutral');
    });

    it('records multiple interventions independently', () => {
      const engine = new EmotionEngine();
      const ctx = makeGameContext();

      // First intervention: confused
      engine.fuseSignals(null, { category: 'confused', confidence: 0.8, timestamp: Date.now() });
      engine.triggerIntervention(engine.getCurrentState(), ctx);
      engine.recordPostInterventionState('neutral');

      // Second intervention: frustrated >10s
      engine.fuseSignals(null, { category: 'frustrated', confidence: 0.9, timestamp: Date.now() });
      const frustratedState = { ...engine.getCurrentState(), durationMs: 15000 };
      engine.triggerIntervention(frustratedState, ctx);
      engine.recordPostInterventionState('engaged');

      const log = engine.getInterventionLog();
      expect(log.length).toBe(2);
      expect(log[0].postInterventionState).toBe('neutral');
      expect(log[1].postInterventionState).toBe('engaged');
    });
  });

  // -----------------------------------------------------------------------
  // Consent revocation (Req 3.8)
  // -----------------------------------------------------------------------
  describe('consent revocation', () => {
    it('ceases webcam analysis immediately on revokeWebcamConsent()', () => {
      const analyzer = makeAnalyzer('engaged', 0.9);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(true));

      expect(engine.isWebcamEnabled()).toBe(true);
      engine.revokeWebcamConsent();
      expect(engine.isWebcamEnabled()).toBe(false);
      expect(engine.processWebcamFrame(makeFakeImageData())).toBeNull();
    });

    it('ceases webcam analysis when updateConsent revokes webcam', () => {
      const analyzer = makeAnalyzer('engaged', 0.9);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(true));

      expect(engine.isWebcamEnabled()).toBe(true);

      engine.updateConsent(makeConsentState(false));
      expect(engine.isWebcamEnabled()).toBe(false);
      expect(engine.processWebcamFrame(makeFakeImageData())).toBeNull();
    });

    it('re-enables webcam when consent is re-granted', () => {
      const analyzer = makeAnalyzer('engaged', 0.9);
      const engine = new EmotionEngine(analyzer);
      engine.initialize(makeConsentState(false));

      expect(engine.isWebcamEnabled()).toBe(false);

      engine.updateConsent(makeConsentState(true));
      expect(engine.isWebcamEnabled()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // StubFacialExpressionAnalyzer
  // -----------------------------------------------------------------------
  describe('StubFacialExpressionAnalyzer', () => {
    it('returns a neutral classification', () => {
      const stub = new StubFacialExpressionAnalyzer();
      const result = stub.classify(makeFakeImageData());
      expect(result).not.toBeNull();
      expect(result!.category).toBe('neutral');
    });

    it('load() resolves without error', async () => {
      const stub = new StubFacialExpressionAnalyzer();
      await expect(stub.load()).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Emotion state machine transitions
  // -----------------------------------------------------------------------
  describe('state machine', () => {
    it('starts in neutral state', () => {
      const engine = new EmotionEngine();
      const state = engine.getCurrentState();
      expect(state.current).toBe('neutral');
      expect(state.previous).toBe('neutral');
    });

    it('transitions neutral → engaged', () => {
      const engine = new EmotionEngine();
      const state = engine.fuseSignals(null, {
        category: 'engaged',
        confidence: 0.8,
        timestamp: Date.now(),
      });
      expect(state.current).toBe('engaged');
      expect(state.previous).toBe('neutral');
    });

    it('transitions engaged → frustrated', () => {
      const engine = new EmotionEngine();
      engine.fuseSignals(null, { category: 'engaged', confidence: 0.8, timestamp: Date.now() });
      const state = engine.fuseSignals(null, {
        category: 'frustrated',
        confidence: 0.9,
        timestamp: Date.now(),
      });
      expect(state.current).toBe('frustrated');
      expect(state.previous).toBe('engaged');
    });

    it('resets duration on state change', () => {
      const engine = new EmotionEngine();
      engine.fuseSignals(null, { category: 'engaged', confidence: 0.8, timestamp: Date.now() });
      const state = engine.fuseSignals(null, {
        category: 'frustrated',
        confidence: 0.9,
        timestamp: Date.now(),
      });
      // Duration should be very small since we just transitioned
      expect(state.durationMs).toBeLessThan(100);
    });

    it('accumulates duration when state stays the same', () => {
      const engine = new EmotionEngine();
      engine.fuseSignals(null, { category: 'engaged', confidence: 0.8, timestamp: Date.now() });

      // Same state again — duration should be >= 0
      const state = engine.fuseSignals(null, {
        category: 'engaged',
        confidence: 0.8,
        timestamp: Date.now(),
      });
      expect(state.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('works without calling initialize()', () => {
      const engine = new EmotionEngine();
      // Should default to webcam disabled
      expect(engine.isWebcamEnabled()).toBe(false);
      expect(engine.processWebcamFrame(makeFakeImageData())).toBeNull();

      // Input patterns should still work
      const result = engine.analyzeInputPatterns({
        pauseFrequency: 0.1,
        errorRate: 0.1,
        inputHesitationMs: 500,
        windowDurationMs: 10000,
      });
      expect(result.category).toBeDefined();
    });

    it('handles model load failure gracefully', async () => {
      const failingAnalyzer: FacialExpressionAnalyzer = {
        load: vi.fn(async () => { throw new Error('WASM failed'); }),
        classify: vi.fn(() => null),
      };
      const engine = new EmotionEngine(failingAnalyzer);
      engine.initialize(makeConsentState(true));

      // Wait for the async load to settle
      await new Promise((r) => setTimeout(r, 10));

      // Should have fallen back to disabled
      expect(engine.isWebcamEnabled()).toBe(false);
    });
  });
});
