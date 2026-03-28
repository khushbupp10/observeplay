import * as fc from 'fast-check';
import type { BarrierEvent, UIElementRef, AdaptationAction } from '@/types';

const barrierTypeArb = fc.constantFrom(
  'unreachable_element' as const,
  'missed_audio_cue' as const,
  'small_text' as const,
  'low_contrast' as const,
  'timing_barrier' as const,
  'complex_input' as const,
);

const severityArb = fc.constantFrom(
  'low' as const, 'medium' as const, 'high' as const, 'critical' as const,
);

const uiElementRefArb: fc.Arbitrary<UIElementRef> = fc.record({
  elementId: fc.uuid(),
  type: fc.constantFrom('button', 'text', 'image', 'input', 'container'),
  position: fc.record({
    x: fc.integer({ min: 0, max: 1920 }),
    y: fc.integer({ min: 0, max: 1080 }),
    width: fc.integer({ min: 10, max: 500 }),
    height: fc.integer({ min: 10, max: 500 }),
  }),
  content: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const adaptationActionArb: fc.Arbitrary<AdaptationAction> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom(
    'reposition' as const, 'resize' as const, 'recolor' as const,
    'add_audio_cue' as const, 'add_haptic' as const, 'enlarge_text' as const,
  ),
  targetElement: uiElementRefArb,
  parameters: fc.constant({} as Record<string, unknown>),
  isProactive: fc.boolean(),
  undoable: fc.boolean(),
});

/**
 * Generates barrier events of various types with random positions and thresholds.
 */
export const barrierEventArb: fc.Arbitrary<BarrierEvent> = fc.record({
  id: fc.uuid(),
  sessionId: fc.uuid(),
  playerId: fc.uuid(),
  timestamp: fc.integer({ min: 0 }),
  type: barrierTypeArb,
  severity: severityArb,
  detectedElement: uiElementRefArb,
  detectedValue: fc.double({ min: 0, max: 100, noNaN: true }),
  thresholdValue: fc.double({ min: 0, max: 100, noNaN: true }),
  adaptation: fc.option(adaptationActionArb, { nil: undefined }),
  adaptationAppliedAt: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
  adaptationUndone: fc.boolean(),
});

export { barrierTypeArb, severityArb, uiElementRefArb, adaptationActionArb };
