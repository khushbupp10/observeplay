import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CopilotAdaptationLearner } from './copilot-adaptation-learner';
import type { BarrierEvent, AdaptationAction } from '../types/barrier';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBarrierEvent(overrides?: Partial<BarrierEvent>): BarrierEvent {
  return {
    id: 'barrier-1',
    sessionId: 'session-1',
    playerId: 'player-1',
    timestamp: 1000,
    type: 'small_text',
    severity: 'medium',
    detectedElement: {
      elementId: 'el-1',
      type: 'text',
      position: { x: 10, y: 10, width: 100, height: 20 },
    },
    detectedValue: 12,
    thresholdValue: 18,
    adaptationUndone: false,
    ...overrides,
  };
}

function makeAdaptation(overrides?: Partial<AdaptationAction>): AdaptationAction {
  return {
    id: 'adapt-1',
    type: 'enlarge_text',
    targetElement: {
      elementId: 'el-1',
      type: 'text',
      position: { x: 10, y: 10, width: 100, height: 20 },
    },
    parameters: { newSize: 18 },
    isProactive: false,
    undoable: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CopilotAdaptationLearner', () => {
  let learner: CopilotAdaptationLearner;

  beforeEach(() => {
    learner = new CopilotAdaptationLearner();
  });

  // ── recordOutcome ─────────────────────────────────────────────

  describe('recordOutcome', () => {
    it('tracks accepted adaptations', () => {
      const event = makeBarrierEvent();
      const adaptation = makeAdaptation();

      learner.recordOutcome('player-1', event, adaptation, true);

      const entries = learner.getEntries('player-1');
      expect(entries).toHaveLength(1);
      expect(entries[0].barrierType).toBe('small_text');
      expect(entries[0].adaptationType).toBe('enlarge_text');
      expect(entries[0].accepted).toBe(true);
    });

    it('tracks undone adaptations', () => {
      const event = makeBarrierEvent();
      const adaptation = makeAdaptation();

      learner.recordOutcome('player-1', event, adaptation, false);

      const entries = learner.getEntries('player-1');
      expect(entries).toHaveLength(1);
      expect(entries[0].accepted).toBe(false);
    });

    it('tracks outcomes per player independently', () => {
      const event = makeBarrierEvent();
      const adaptation = makeAdaptation();

      learner.recordOutcome('player-1', event, adaptation, true);
      learner.recordOutcome('player-2', event, adaptation, false);

      expect(learner.getEntries('player-1')).toHaveLength(1);
      expect(learner.getEntries('player-2')).toHaveLength(1);
      expect(learner.getEntries('player-1')[0].accepted).toBe(true);
      expect(learner.getEntries('player-2')[0].accepted).toBe(false);
    });

    it('records session id from the barrier event', () => {
      const event = makeBarrierEvent({ sessionId: 'sess-42' });
      const adaptation = makeAdaptation();

      learner.recordOutcome('player-1', event, adaptation, true);

      expect(learner.getEntries('player-1')[0].sessionId).toBe('sess-42');
    });
  });

  // ── shouldApplyProactively ────────────────────────────────────

  describe('shouldApplyProactively', () => {
    it('returns false when no data exists for the player', () => {
      const decision = learner.shouldApplyProactively('unknown', 'small_text', 'enlarge_text');
      expect(decision.apply).toBe(false);
      expect(decision.sessionsObserved).toBe(0);
    });

    it('returns false when fewer than 3 sessions have acceptance', () => {
      // 2 sessions with acceptance
      for (let i = 0; i < 2; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}` }),
          makeAdaptation(),
          true,
        );
      }

      const decision = learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text');
      expect(decision.apply).toBe(false);
      expect(decision.sessionsObserved).toBe(2);
    });

    it('returns true when ≥3 distinct sessions have acceptance', () => {
      for (let i = 0; i < 3; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}` }),
          makeAdaptation(),
          true,
        );
      }

      const decision = learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text');
      expect(decision.apply).toBe(true);
      expect(decision.sessionsObserved).toBe(3);
      expect(decision.acceptanceRate).toBe(1);
    });

    it('does not count multiple acceptances in the same session as multiple sessions', () => {
      // 3 acceptances but all in the same session
      for (let i = 0; i < 3; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: 'same-session', timestamp: 1000 + i }),
          makeAdaptation(),
          true,
        );
      }

      const decision = learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text');
      expect(decision.apply).toBe(false);
      expect(decision.sessionsObserved).toBe(1);
    });

    it('distinguishes between different barrier types', () => {
      // 3 sessions for small_text
      for (let i = 0; i < 3; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}`, type: 'small_text' }),
          makeAdaptation({ type: 'enlarge_text' }),
          true,
        );
      }

      // Only 1 session for unreachable_element
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'session-0', type: 'unreachable_element' }),
        makeAdaptation({ type: 'reposition' }),
        true,
      );

      expect(
        learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text').apply,
      ).toBe(true);
      expect(
        learner.shouldApplyProactively('player-1', 'unreachable_element', 'reposition').apply,
      ).toBe(false);
    });

    it('counts a session as accepted only if majority of outcomes were accepted', () => {
      // Session 0: 2 accepted, 1 undone → accepted (majority)
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'session-0', timestamp: 100 }),
        makeAdaptation(),
        true,
      );
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'session-0', timestamp: 200 }),
        makeAdaptation(),
        true,
      );
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'session-0', timestamp: 300 }),
        makeAdaptation(),
        false,
      );

      // Session 1 and 2: accepted
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'session-1' }),
        makeAdaptation(),
        true,
      );
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'session-2' }),
        makeAdaptation(),
        true,
      );

      const decision = learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text');
      expect(decision.apply).toBe(true);
      expect(decision.sessionsObserved).toBe(3);
    });

    it('computes acceptance rate correctly', () => {
      // 4 sessions: 3 accepted, 1 rejected
      for (let i = 0; i < 3; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}` }),
          makeAdaptation(),
          true,
        );
      }
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'session-3' }),
        makeAdaptation(),
        false,
      );

      const decision = learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text');
      expect(decision.apply).toBe(true);
      expect(decision.acceptanceRate).toBe(0.75);
      expect(decision.confidence).toBe(0.75);
    });
  });

  // ── disableProactive ──────────────────────────────────────────

  describe('disableProactive', () => {
    it('prevents proactive application even when threshold is met', () => {
      for (let i = 0; i < 5; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}` }),
          makeAdaptation(),
          true,
        );
      }

      // Verify it would be proactive
      expect(
        learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text').apply,
      ).toBe(true);

      // Disable
      learner.disableProactive('player-1', 'enlarge_text');

      const decision = learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text');
      expect(decision.apply).toBe(false);
      // Sessions are still observed
      expect(decision.sessionsObserved).toBe(5);
    });

    it('only disables the specified adaptation type', () => {
      // Set up proactive for two adaptation types
      for (let i = 0; i < 3; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}`, type: 'small_text' }),
          makeAdaptation({ type: 'enlarge_text' }),
          true,
        );
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}`, type: 'unreachable_element' }),
          makeAdaptation({ type: 'reposition' }),
          true,
        );
      }

      learner.disableProactive('player-1', 'enlarge_text');

      expect(
        learner.shouldApplyProactively('player-1', 'small_text', 'enlarge_text').apply,
      ).toBe(false);
      expect(
        learner.shouldApplyProactively('player-1', 'unreachable_element', 'reposition').apply,
      ).toBe(true);
    });

    it('tracks disabled types per player', () => {
      learner.disableProactive('player-1', 'enlarge_text');
      learner.disableProactive('player-2', 'reposition');

      expect(learner.getDisabledTypes('player-1')).toEqual(['enlarge_text']);
      expect(learner.getDisabledTypes('player-2')).toEqual(['reposition']);
    });
  });

  // ── retrain ───────────────────────────────────────────────────

  describe('retrain', () => {
    it('produces a deterministic model from historical data', () => {
      const history = [
        {
          playerId: 'player-1',
          entries: [
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's1', timestamp: 100, accepted: true },
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's2', timestamp: 200, accepted: true },
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's3', timestamp: 300, accepted: true },
          ],
        },
      ];

      const model1 = learner.retrain('player-1', history);
      const model2 = learner.retrain('player-1', history);

      // Same rules (ignoring trainedAt which is a timestamp)
      expect(model1.rules).toEqual(model2.rules);
      expect(model1.playerId).toBe(model2.playerId);
    });

    it('replaces existing entries with historical data', () => {
      // Record some initial data
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 'old-session' }),
        makeAdaptation(),
        false,
      );

      expect(learner.getEntries('player-1')).toHaveLength(1);

      // Retrain with new historical data
      const history = [
        {
          playerId: 'player-1',
          entries: [
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's1', timestamp: 100, accepted: true },
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's2', timestamp: 200, accepted: true },
          ],
        },
      ];

      learner.retrain('player-1', history);

      expect(learner.getEntries('player-1')).toHaveLength(2);
      expect(learner.getEntries('player-1').every((e) => e.accepted)).toBe(true);
    });

    it('merges entries from multiple history objects', () => {
      const history = [
        {
          playerId: 'player-1',
          entries: [
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's1', timestamp: 100, accepted: true },
          ],
        },
        {
          playerId: 'player-1',
          entries: [
            { barrierType: 'unreachable_element', adaptationType: 'reposition', sessionId: 's2', timestamp: 200, accepted: true },
          ],
        },
      ];

      const model = learner.retrain('player-1', history);

      expect(model.rules).toHaveLength(2);
      expect(learner.getEntries('player-1')).toHaveLength(2);
    });

    it('builds correct proactive rules from historical data', () => {
      const history = [
        {
          playerId: 'player-1',
          entries: [
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's1', timestamp: 100, accepted: true },
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's2', timestamp: 200, accepted: true },
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's3', timestamp: 300, accepted: true },
            { barrierType: 'low_contrast', adaptationType: 'recolor', sessionId: 's1', timestamp: 150, accepted: false },
          ],
        },
      ];

      const model = learner.retrain('player-1', history);

      const textRule = model.rules.find(
        (r) => r.barrierType === 'small_text' && r.adaptationType === 'enlarge_text',
      );
      expect(textRule).toBeDefined();
      expect(textRule!.isProactive).toBe(true);
      expect(textRule!.sessionsObserved).toBe(3);
      expect(textRule!.acceptanceRate).toBe(1);

      const contrastRule = model.rules.find(
        (r) => r.barrierType === 'low_contrast' && r.adaptationType === 'recolor',
      );
      expect(contrastRule).toBeDefined();
      expect(contrastRule!.isProactive).toBe(false);
      expect(contrastRule!.sessionsObserved).toBe(1);
    });

    it('respects disabled adaptation types in retrained model', () => {
      learner.disableProactive('player-1', 'enlarge_text');

      const history = [
        {
          playerId: 'player-1',
          entries: [
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's1', timestamp: 100, accepted: true },
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's2', timestamp: 200, accepted: true },
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's3', timestamp: 300, accepted: true },
          ],
        },
      ];

      const model = learner.retrain('player-1', history);
      const rule = model.rules[0];

      expect(rule.isProactive).toBe(false);
      expect(rule.disabledByPlayer).toBe(true);
    });
  });

  // ── Profile Learner integration ───────────────────────────────

  describe('Profile Learner integration', () => {
    it('notifies listeners when an outcome is recorded', () => {
      const listener = vi.fn();
      learner.onPreferenceChange(listener);

      learner.recordOutcome(
        'player-1',
        makeBarrierEvent(),
        makeAdaptation(),
        true,
      );

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('player-1', expect.any(Object));
    });

    it('notifies listeners when proactive is disabled', () => {
      const listener = vi.fn();
      learner.onPreferenceChange(listener);

      learner.disableProactive('player-1', 'enlarge_text');

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies listeners on retrain', () => {
      const listener = vi.fn();
      learner.onPreferenceChange(listener);

      learner.retrain('player-1', [
        {
          playerId: 'player-1',
          entries: [
            { barrierType: 'small_text', adaptationType: 'enlarge_text', sessionId: 's1', timestamp: 100, accepted: true },
          ],
        },
      ]);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('provides adaptation preferences in a format suitable for AccessibilityProfile', () => {
      for (let i = 0; i < 3; i++) {
        learner.recordOutcome(
          'player-1',
          makeBarrierEvent({ sessionId: `session-${i}` }),
          makeAdaptation(),
          true,
        );
      }

      const prefs = learner.getAdaptationPreferences('player-1');
      const key = 'adaptation:small_text:enlarge_text';

      expect(prefs[key]).toBeDefined();
      const pref = prefs[key] as Record<string, unknown>;
      expect(pref.isProactive).toBe(true);
      expect(pref.acceptanceRate).toBe(1);
      expect(pref.sessionsObserved).toBe(3);
      expect(pref.disabledByPlayer).toBe(false);
    });

    it('returns empty preferences for unknown player', () => {
      expect(learner.getAdaptationPreferences('unknown')).toEqual({});
    });
  });

  // ── getModel ──────────────────────────────────────────────────

  describe('getModel', () => {
    it('returns null for unknown player', () => {
      expect(learner.getModel('unknown')).toBeNull();
    });

    it('builds model lazily on first access', () => {
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent(),
        makeAdaptation(),
        true,
      );

      const model = learner.getModel('player-1');
      expect(model).not.toBeNull();
      expect(model!.playerId).toBe('player-1');
      expect(model!.rules).toHaveLength(1);
    });

    it('caches model and returns same instance on repeated calls', () => {
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent(),
        makeAdaptation(),
        true,
      );

      const model1 = learner.getModel('player-1');
      const model2 = learner.getModel('player-1');
      expect(model1).toBe(model2);
    });

    it('invalidates cache after new outcome', () => {
      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 's1' }),
        makeAdaptation(),
        true,
      );

      const model1 = learner.getModel('player-1');

      learner.recordOutcome(
        'player-1',
        makeBarrierEvent({ sessionId: 's2' }),
        makeAdaptation(),
        true,
      );

      const model2 = learner.getModel('player-1');
      expect(model2).not.toBe(model1);
    });
  });
});
