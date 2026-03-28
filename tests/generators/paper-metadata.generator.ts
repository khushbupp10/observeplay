import * as fc from 'fast-check';
import type { PaperMetadata, PaperSummary } from '@/types';

const authorArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 15 }),
  fc.string({ minLength: 1, maxLength: 20 }),
).map(([first, last]) => `${first} ${last}`);

/**
 * Generates paper metadata with random titles, authors, abstracts, and optional fields.
 */
export const paperMetadataArb: fc.Arbitrary<PaperMetadata> = fc.record({
  title: fc.string({ minLength: 5, maxLength: 150 }),
  authors: fc.array(authorArb, { minLength: 1, maxLength: 6 }),
  abstract: fc.string({ minLength: 10, maxLength: 500 }),
  publicationDate: fc.option(
    fc.integer({ min: 1990, max: 2025 }).chain((year) =>
      fc.tuple(
        fc.constant(year),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
      ).map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
    ),
    { nil: undefined },
  ),
  journal: fc.option(fc.string({ minLength: 3, maxLength: 60 }), { nil: undefined }),
  doi: fc.option(
    fc.tuple(fc.string({ minLength: 4, maxLength: 10 }), fc.string({ minLength: 4, maxLength: 10 }))
      .map(([a, b]) => `10.${a}/${b}`),
    { nil: undefined },
  ),
  references: fc.array(fc.uuid(), { maxLength: 10 }),
});

/**
 * Generates a paper summary with objective, methodology, findings, and limitations.
 */
export const paperSummaryArb: fc.Arbitrary<PaperSummary> = fc.record({
  objective: fc.string({ minLength: 5, maxLength: 200 }),
  methodology: fc.string({ minLength: 5, maxLength: 200 }),
  keyFindings: fc.array(fc.string({ minLength: 5, maxLength: 100 }), { minLength: 1, maxLength: 5 }),
  limitations: fc.array(fc.string({ minLength: 5, maxLength: 100 }), { maxLength: 3 }),
});

export { authorArb };
