import * as fc from 'fast-check';
import type { EmotionState, EmotionStateEntry, EmotionStateLog } from '@/types';
import type { EmotionCategory } from '@/types';

const emotionCategoryArb: fc.Arbitrary<EmotionCategory> = fc.constantFrom(
  'engaged', 'frustrated', 'confused', 'disengaged', 'neutral',
);

const sourceArb = fc.constantFrom('webcam' as const, 'input_pattern' as const, 'fused' as const);

const interventionArb = fc.record({
  type: fc.constantFrom(
    'hint' as const, 'difficulty_reduction' as const, 'pacing_adjustment' as const,
    'objective_explanation' as const, 'break_suggestion' as const, 'activity_change' as const,
  ),
  message: fc.string({ minLength: 1, maxLength: 100 }),
  priority: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
});

const emotionStateEntryArb: fc.Arbitrary<EmotionStateEntry> = fc.record({
  timestamp: fc.integer({ min: 0 }),
  category: emotionCategoryArb,
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  source: sourceArb,
  intervention: fc.option(interventionArb, { nil: undefined }),
  postInterventionState: fc.option(emotionCategoryArb, { nil: undefined }),
});

/**
 * Generates an EmotionState snapshot.
 */
export const emotionStateArb: fc.Arbitrary<EmotionState> = fc.record({
  current: emotionCategoryArb,
  previous: emotionCategoryArb,
  durationMs: fc.integer({ min: 0, max: 300000 }),
  lastUpdated: fc.integer({ min: 0 }),
  webcamEnabled: fc.boolean(),
});

/**
 * Generates a time-series of emotion state entries with configurable length.
 */
export const emotionStateLogArb = (
  minEntries = 1,
  maxEntries = 20,
): fc.Arbitrary<EmotionStateLog> =>
  fc.record({
    sessionId: fc.uuid(),
    playerId: fc.uuid(),
    entries: fc.array(emotionStateEntryArb, { minLength: minEntries, maxLength: maxEntries }),
  });

export { emotionCategoryArb, emotionStateEntryArb, interventionArb };
