import * as fc from 'fast-check';
import type { ConsentState, ConsentRecord, ConsentConfigurationExport } from '@/types';
import type { ConsentCategory } from '@/types';

const consentCategories: ConsentCategory[] = [
  'webcam', 'interaction_patterns', 'profile_learning', 'voice_input',
];

const consentRecordArb: fc.Arbitrary<ConsentRecord> = fc
  .record({
    granted: fc.boolean(),
    grantedAt: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
    revokedAt: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
  })
  .map((rec) => {
    // Ensure logical consistency: revokedAt only when not granted
    if (rec.granted) {
      return { granted: true, grantedAt: rec.grantedAt ?? Date.now(), revokedAt: undefined };
    }
    return { granted: false, grantedAt: rec.grantedAt, revokedAt: rec.revokedAt ?? Date.now() };
  });

/**
 * Generates consent states with random opt-in/opt-out combinations for all categories.
 */
export const consentStateArb: fc.Arbitrary<ConsentState> = fc
  .tuple(fc.uuid(), fc.integer({ min: 0 }), ...consentCategories.map(() => consentRecordArb))
  .map(([playerId, lastUpdated, webcam, interaction, profile, voice]) => ({
    playerId: playerId as string,
    consents: {
      webcam: webcam as ConsentRecord,
      interaction_patterns: interaction as ConsentRecord,
      profile_learning: profile as ConsentRecord,
      voice_input: voice as ConsentRecord,
    },
    lastUpdated: lastUpdated as number,
  }));

/**
 * Generates a consent configuration export with random opt-in/opt-out booleans.
 */
export const consentConfigExportArb: fc.Arbitrary<ConsentConfigurationExport> = fc.record({
  exportedAt: fc.integer({ min: 0 }),
  consents: fc.record({
    webcam: fc.boolean(),
    interaction_patterns: fc.boolean(),
    profile_learning: fc.boolean(),
    voice_input: fc.boolean(),
  }),
  checksum: fc.stringMatching(/^[0-9a-f]{32}$/),
});

export { consentRecordArb };
