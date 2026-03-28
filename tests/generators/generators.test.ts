import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { gameSpecArb } from './game-spec.generator';
import { accessibilityProfileArb } from './accessibility-profile.generator';
import { barrierEventArb } from './barrier-event.generator';
import { emotionStateArb, emotionStateLogArb } from './emotion-state.generator';
import { paperMetadataArb, paperSummaryArb } from './paper-metadata.generator';
import { consentStateArb, consentConfigExportArb } from './consent-config.generator';
import { dialogueContextArb } from './dialogue-context.generator';

describe('fast-check generators', () => {
  it('gameSpecArb produces valid GameSpec instances', () => {
    fc.assert(
      fc.property(gameSpecArb, (spec) => {
        expect(spec.id).toBeTruthy();
        expect(spec.rules.length).toBeGreaterThan(0);
        expect(spec.winConditions.length).toBeGreaterThan(0);
        expect(spec.mechanics.length).toBeGreaterThan(0);
        expect(spec.interactionMappings.length).toBeGreaterThan(0);
        expect(spec.visualAssets.length).toBeGreaterThan(0);
        expect(spec.audioAssets.length).toBeGreaterThan(0);
        // Every interaction mapping references a real mechanic
        const mechanicIds = new Set(spec.mechanics.map((m) => m.id));
        for (const mapping of spec.interactionMappings) {
          expect(mechanicIds.has(mapping.mechanicId)).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('accessibilityProfileArb produces valid profiles', () => {
    fc.assert(
      fc.property(accessibilityProfileArb, (profile) => {
        expect(profile.playerId).toBeTruthy();
        expect(profile.inputMethods.length).toBeGreaterThan(0);
        expect(profile.inputAccuracy).toBeGreaterThanOrEqual(0);
        expect(profile.inputAccuracy).toBeLessThanOrEqual(1);
        expect(profile.minContrastRatio).toBeGreaterThanOrEqual(1);
        expect(profile.reachableScreenZone.bottomRight.x).toBeGreaterThan(
          profile.reachableScreenZone.topLeft.x,
        );
        expect(profile.reachableScreenZone.bottomRight.y).toBeGreaterThan(
          profile.reachableScreenZone.topLeft.y,
        );
      }),
      { numRuns: 50 },
    );
  });

  it('barrierEventArb produces valid barrier events', () => {
    fc.assert(
      fc.property(barrierEventArb, (event) => {
        expect(event.id).toBeTruthy();
        expect(event.sessionId).toBeTruthy();
        expect(event.playerId).toBeTruthy();
        expect([
          'unreachable_element', 'missed_audio_cue', 'small_text',
          'low_contrast', 'timing_barrier', 'complex_input',
        ]).toContain(event.type);
        expect(['low', 'medium', 'high', 'critical']).toContain(event.severity);
        expect(event.detectedElement.position.width).toBeGreaterThan(0);
        expect(event.detectedElement.position.height).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  it('emotionStateArb produces valid emotion states', () => {
    fc.assert(
      fc.property(emotionStateArb, (state) => {
        const validCategories = ['engaged', 'frustrated', 'confused', 'disengaged', 'neutral'];
        expect(validCategories).toContain(state.current);
        expect(validCategories).toContain(state.previous);
        expect(state.durationMs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 50 },
    );
  });

  it('emotionStateLogArb produces valid time-series logs', () => {
    fc.assert(
      fc.property(emotionStateLogArb(2, 10), (log) => {
        expect(log.sessionId).toBeTruthy();
        expect(log.playerId).toBeTruthy();
        expect(log.entries.length).toBeGreaterThanOrEqual(2);
        for (const entry of log.entries) {
          expect(entry.confidence).toBeGreaterThanOrEqual(0);
          expect(entry.confidence).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('paperMetadataArb produces valid paper metadata', () => {
    fc.assert(
      fc.property(paperMetadataArb, (meta) => {
        expect(meta.title.length).toBeGreaterThan(0);
        expect(meta.authors.length).toBeGreaterThan(0);
        expect(meta.abstract.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  it('paperSummaryArb produces valid paper summaries', () => {
    fc.assert(
      fc.property(paperSummaryArb, (summary) => {
        expect(summary.objective.length).toBeGreaterThan(0);
        expect(summary.methodology.length).toBeGreaterThan(0);
        expect(summary.keyFindings.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  it('consentStateArb produces valid consent states', () => {
    fc.assert(
      fc.property(consentStateArb, (state) => {
        expect(state.playerId).toBeTruthy();
        const categories = ['webcam', 'interaction_patterns', 'profile_learning', 'voice_input'] as const;
        for (const cat of categories) {
          expect(typeof state.consents[cat].granted).toBe('boolean');
        }
      }),
      { numRuns: 50 },
    );
  });

  it('consentConfigExportArb produces valid exports', () => {
    fc.assert(
      fc.property(consentConfigExportArb, (exp) => {
        expect(exp.exportedAt).toBeGreaterThanOrEqual(0);
        expect(typeof exp.consents.webcam).toBe('boolean');
        expect(exp.checksum.length).toBe(32);
      }),
      { numRuns: 50 },
    );
  });

  it('dialogueContextArb produces valid dialogue contexts', () => {
    fc.assert(
      fc.property(dialogueContextArb(1, 5), (ctx) => {
        expect(ctx.sessionId).toBeTruthy();
        expect(ctx.history.length).toBeGreaterThanOrEqual(1);
        expect(ctx.referenceMap).toBeInstanceOf(Map);
        expect(['en', 'es', 'fr', 'de', 'ja']).toContain(ctx.language);
        for (const turn of ctx.history) {
          expect(['player', 'system']).toContain(turn.speaker);
          expect(turn.utterance.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 50 },
    );
  });
});
