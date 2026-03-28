import * as fc from 'fast-check';
import type {
  GameSpec,
  GameRule,
  WinCondition,
  GameMechanic,
  InteractionMapping,
  AssetReference,
  AccessibilityAdaptation,
} from '@/types';
import type { Genre, InputMethod, SpatialPosition } from '@/types';

const genreArb: fc.Arbitrary<Genre> = fc.constantFrom(
  'puzzle', 'adventure', 'strategy', 'simulation', 'narrative',
);

const inputMethodArb: fc.Arbitrary<InputMethod> = fc.constantFrom(
  'keyboard', 'mouse', 'touch', 'voice', 'single_switch',
  'eye_tracking', 'head_tracking', 'sip_puff', 'gamepad',
);

const spatialPositionArb: fc.Arbitrary<SpatialPosition> = fc.record({
  azimuth: fc.double({ min: -180, max: 180, noNaN: true }),
  elevation: fc.double({ min: -90, max: 90, noNaN: true }),
  distance: fc.double({ min: 0, max: 1, noNaN: true }),
});

const gameRuleArb: fc.Arbitrary<GameRule> = fc.record({
  id: fc.uuid(),
  description: fc.string({ minLength: 1, maxLength: 100 }),
  condition: fc.string({ minLength: 1, maxLength: 50 }),
  effect: fc.string({ minLength: 1, maxLength: 50 }),
});

const winConditionArb: fc.Arbitrary<WinCondition> = fc.record({
  id: fc.uuid(),
  description: fc.string({ minLength: 1, maxLength: 100 }),
  condition: fc.string({ minLength: 1, maxLength: 50 }),
});

const gameMechanicArb: fc.Arbitrary<GameMechanic> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  description: fc.string({ minLength: 1, maxLength: 100 }),
  requiredInputMethods: fc.array(inputMethodArb, { minLength: 1, maxLength: 3 }),
  alternativeInputMethods: fc.array(inputMethodArb, { maxLength: 3 }),
  difficulty: fc.double({ min: 0, max: 1, noNaN: true }),
});

const assetReferenceArb: fc.Arbitrary<AssetReference> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('image' as const, 'audio' as const, 'animation' as const, 'soundscape' as const),
  url: fc.webUrl(),
  altText: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  spatialPosition: fc.option(spatialPositionArb, { nil: undefined }),
});

const accessibilityAdaptationArb: fc.Arbitrary<AccessibilityAdaptation> = fc.record({
  mechanicId: fc.uuid(),
  adaptationType: fc.constantFrom('reposition', 'resize', 'recolor', 'add_audio_cue', 'enlarge_text'),
  parameters: fc.constant({} as Record<string, unknown>),
});

/**
 * Generates a valid GameSpec with random rules, mechanics, interaction mappings, and assets.
 * Interaction mappings reference mechanics by id and use valid input methods.
 */
export const gameSpecArb: fc.Arbitrary<GameSpec> = fc
  .tuple(
    fc.uuid(),
    genreArb,
    fc.string({ minLength: 1, maxLength: 50 }),
    fc.string({ minLength: 1, maxLength: 200 }),
    fc.string({ minLength: 1, maxLength: 200 }),
    fc.array(gameRuleArb, { minLength: 1, maxLength: 5 }),
    fc.array(winConditionArb, { minLength: 1, maxLength: 3 }),
    fc.array(gameMechanicArb, { minLength: 1, maxLength: 5 }),
    fc.array(assetReferenceArb, { minLength: 1, maxLength: 5 }),
    fc.array(assetReferenceArb, { minLength: 1, maxLength: 5 }),
    fc.array(accessibilityAdaptationArb, { maxLength: 3 }),
    fc.integer({ min: 1, max: 120 }),
    fc.constantFrom('easy' as const, 'medium' as const, 'hard' as const, 'adaptive' as const),
  )
  .map(([id, genre, title, description, playerDescription, rules, winConditions, mechanics, visualAssets, audioAssets, adaptations, playTime, difficulty]) => {
    // Build interaction mappings that reference actual mechanic ids
    const interactionMappings: InteractionMapping[] = mechanics.map((m) => ({
      mechanicId: m.id,
      inputMethod: m.requiredInputMethods[0],
      binding: `key:action_${m.id.slice(0, 8)}`,
    }));

    return {
      id,
      genre,
      title,
      description,
      createdAt: Date.now(),
      playerDescription,
      rules,
      winConditions,
      mechanics,
      interactionMappings,
      visualAssets,
      audioAssets,
      accessibilityAdaptations: adaptations,
      estimatedPlayTimeMinutes: playTime,
      difficultyLevel: difficulty,
    } satisfies GameSpec;
  });

export { genreArb, inputMethodArb, spatialPositionArb, gameMechanicArb, gameRuleArb, winConditionArb, assetReferenceArb };
