import * as fc from 'fast-check';
import type { DialogueContext, DialogueTurn } from '@/types';
import type { GameEntityRef } from '@/types';
import type { SupportedLanguage } from '@/types';

const supportedLanguageArb: fc.Arbitrary<SupportedLanguage> = fc.constantFrom(
  'en', 'es', 'fr', 'de', 'ja',
);

const gameEntityRefArb: fc.Arbitrary<GameEntityRef> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('character', 'item', 'location', 'obstacle'),
  name: fc.string({ minLength: 1, maxLength: 30 }),
});

const dialogueTurnArb: fc.Arbitrary<DialogueTurn> = fc.record({
  speaker: fc.constantFrom('player' as const, 'system' as const),
  utterance: fc.string({ minLength: 1, maxLength: 200 }),
  timestamp: fc.integer({ min: 0 }),
  referencedEntities: fc.array(gameEntityRefArb, { maxLength: 3 }),
});

/**
 * Generates dialogue histories with entity references and pronoun patterns.
 * The referenceMap maps pronouns/references to game entities.
 */
export const dialogueContextArb = (
  minTurns = 0,
  maxTurns = 10,
): fc.Arbitrary<DialogueContext> =>
  fc
    .tuple(
      fc.uuid(),
      fc.array(dialogueTurnArb, { minLength: minTurns, maxLength: maxTurns }),
      fc.array(
        fc.tuple(
          fc.constantFrom('it', 'that', 'there', 'this', 'them', 'here'),
          gameEntityRefArb,
        ),
        { maxLength: 5 },
      ),
      supportedLanguageArb,
    )
    .map(([sessionId, history, refs, language]) => ({
      sessionId,
      history,
      referenceMap: new Map(refs),
      language,
    }));

export { gameEntityRefArb, dialogueTurnArb, supportedLanguageArb };
