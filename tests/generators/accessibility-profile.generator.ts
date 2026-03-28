import * as fc from 'fast-check';
import type { AccessibilityProfile } from '@/types';
import type { InputMethod, ColorBlindnessType, ScreenZone, VisualFieldRestriction } from '@/types';

const inputMethodArb: fc.Arbitrary<InputMethod> = fc.constantFrom(
  'keyboard', 'mouse', 'touch', 'voice', 'single_switch',
  'eye_tracking', 'head_tracking', 'sip_puff', 'gamepad',
);

const colorBlindnessTypeArb: fc.Arbitrary<ColorBlindnessType | null> = fc.constantFrom(
  null, 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia',
);

const screenZoneArb: fc.Arbitrary<ScreenZone> = fc
  .tuple(
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 100, max: 1920 }),
    fc.integer({ min: 100, max: 1080 }),
  )
  .map(([x, y, w, h]) => ({
    topLeft: { x, y },
    bottomRight: { x: x + w, y: y + h },
  }));

const visualFieldRestrictionArb: fc.Arbitrary<VisualFieldRestriction | null> = fc.option(
  fc.record({
    type: fc.constantFrom('tunnel' as const, 'hemianopia_left' as const, 'hemianopia_right' as const, 'scotoma' as const),
    severityPercent: fc.double({ min: 0, max: 100, noNaN: true }),
  }),
  { nil: null },
);

/**
 * Generates a valid AccessibilityProfile with random input methods,
 * visual/audio/motor capabilities, and cognitive preferences.
 */
export const accessibilityProfileArb: fc.Arbitrary<AccessibilityProfile> = fc.record({
  playerId: fc.uuid(),
  version: fc.integer({ min: 1, max: 100 }),
  lastUpdated: fc.integer({ min: 0 }),

  inputMethods: fc.array(inputMethodArb, { minLength: 1, maxLength: 4 }),
  responseTimeMs: fc.integer({ min: 50, max: 10000 }),
  inputAccuracy: fc.double({ min: 0, max: 1, noNaN: true }),

  minReadableTextSize: fc.integer({ min: 8, max: 72 }),
  minContrastRatio: fc.double({ min: 1, max: 21, noNaN: true }),
  colorBlindnessType: colorBlindnessTypeArb,
  visualFieldRestriction: visualFieldRestrictionArb,

  hearingCapability: fc.constantFrom('full' as const, 'partial' as const, 'none' as const),
  preferredAudioChannel: fc.constantFrom('stereo' as const, 'mono' as const),

  reachableScreenZone: screenZoneArb,
  clickPrecision: fc.integer({ min: 1, max: 100 }),
  holdDuration: fc.integer({ min: 100, max: 10000 }),

  preferredPacing: fc.constantFrom('slow' as const, 'moderate' as const, 'fast' as const),
  maxSimultaneousElements: fc.integer({ min: 1, max: 20 }),
  preferredInstructionFormat: fc.constantFrom('text' as const, 'audio' as const, 'visual' as const, 'multimodal' as const),

  learnedPreferences: fc.constant({} as Record<string, unknown>),
  manualOverrides: fc.constant({} as Record<string, unknown>),
});

export { inputMethodArb, screenZoneArb, colorBlindnessTypeArb, visualFieldRestrictionArb };
