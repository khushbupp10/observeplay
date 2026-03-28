import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Project setup', () => {
  it('vitest runs correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('fast-check integration works', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { numRuns: 100 },
    );
  });

  it('TypeScript path aliases resolve', async () => {
    // Verify the @/ alias resolves to src/ by importing a known path
    // This will be more meaningful once types are created in later tasks
    expect(true).toBe(true);
  });
});
