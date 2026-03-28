import { describe, it, expect } from 'vitest';
import {
  generateChecksum,
  verifyChecksum,
  serializeGameSpec,
  deserializeGameSpec,
  serializeAccessibilityProfile,
  deserializeAccessibilityProfile,
  serializePaperMetadata,
  deserializePaperMetadata,
  serializeConsentConfig,
  deserializeConsentConfig,
} from './serialization';
import type { GameSpec } from '../types/game';
import type { AccessibilityProfile } from '../types/player';
import type { PaperMetadata } from '../types/research';
import type { ConsentConfigurationExport } from '../types/consent';
import type { ConsentCategory } from '../types/common';

// ── Test fixtures ───────────────────────────────────────────────────

const sampleGameSpec: GameSpec = {
  id: 'game-1',
  genre: 'puzzle',
  title: 'Space Puzzle',
  description: 'A puzzle game in space',
  createdAt: 1700000000000,
  playerDescription: 'a puzzle game I can play with voice',
  rules: [{ id: 'r1', description: 'Match tiles', condition: 'tiles_match', effect: 'score+1' }],
  winConditions: [{ id: 'w1', description: 'Score 10', condition: 'score>=10' }],
  mechanics: [{
    id: 'm1', name: 'tile-select', description: 'Select a tile',
    requiredInputMethods: ['voice'], alternativeInputMethods: ['keyboard'], difficulty: 0.3,
  }],
  interactionMappings: [{ mechanicId: 'm1', inputMethod: 'voice', binding: 'voice:select {tile}' }],
  visualAssets: [{ id: 'a1', type: 'image', url: '/assets/tile.png', altText: 'Tile' }],
  audioAssets: [{ id: 'a2', type: 'audio', url: '/assets/click.mp3' }],
  accessibilityAdaptations: [{ mechanicId: 'm1', adaptationType: 'voice_control', parameters: {} }],
  estimatedPlayTimeMinutes: 15,
  difficultyLevel: 'easy',
};

const sampleProfile: AccessibilityProfile = {
  playerId: 'player-1',
  version: 1,
  lastUpdated: 1700000000000,
  inputMethods: ['voice', 'keyboard'],
  responseTimeMs: 500,
  inputAccuracy: 0.85,
  minReadableTextSize: 16,
  minContrastRatio: 4.5,
  colorBlindnessType: null,
  visualFieldRestriction: null,
  hearingCapability: 'full',
  preferredAudioChannel: 'stereo',
  reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1920, y: 1080 } },
  clickPrecision: 10,
  holdDuration: 2000,
  preferredPacing: 'moderate',
  maxSimultaneousElements: 5,
  preferredInstructionFormat: 'multimodal',
  learnedPreferences: {},
  manualOverrides: {},
};

const samplePaperMetadata: PaperMetadata = {
  title: 'Accessible Gaming for All',
  authors: ['Alice Smith', 'Bob Jones'],
  abstract: 'This paper explores accessible gaming techniques.',
  publicationDate: '2024-01-15',
  journal: 'Journal of Accessibility',
  doi: '10.1234/example',
  references: ['ref-1', 'ref-2'],
};

const sampleConsents: Record<ConsentCategory, boolean> = {
  webcam: true,
  interaction_patterns: true,
  profile_learning: false,
  voice_input: true,
};

// ── Checksum tests ──────────────────────────────────────────────────

describe('generateChecksum', () => {
  it('produces a 64-character hex string (SHA-256)', () => {
    const checksum = generateChecksum('hello');
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same checksum for the same input', () => {
    expect(generateChecksum('test')).toBe(generateChecksum('test'));
  });

  it('produces different checksums for different inputs', () => {
    expect(generateChecksum('a')).not.toBe(generateChecksum('b'));
  });
});

describe('verifyChecksum', () => {
  it('returns true for matching data and checksum', () => {
    const data = 'some data';
    const checksum = generateChecksum(data);
    expect(verifyChecksum(data, checksum)).toBe(true);
  });

  it('returns false for mismatched data and checksum', () => {
    const checksum = generateChecksum('original');
    expect(verifyChecksum('tampered', checksum)).toBe(false);
  });
});

// ── GameSpec serialization tests ────────────────────────────────────

describe('serializeGameSpec / deserializeGameSpec', () => {
  it('round-trips a valid GameSpec', () => {
    const json = serializeGameSpec(sampleGameSpec);
    const result = deserializeGameSpec(json);
    expect(result).toEqual(sampleGameSpec);
  });

  it('throws on invalid JSON', () => {
    expect(() => deserializeGameSpec('not json')).toThrow('Invalid JSON');
  });

  it('throws on non-object JSON', () => {
    expect(() => deserializeGameSpec('"string"')).toThrow('expected an object');
  });

  it('throws on missing required string field', () => {
    const partial = { ...sampleGameSpec, id: undefined };
    const json = JSON.stringify(partial);
    expect(() => deserializeGameSpec(json)).toThrow('"id"');
  });

  it('throws on missing createdAt', () => {
    const partial = { ...sampleGameSpec, createdAt: undefined };
    const json = JSON.stringify(partial);
    expect(() => deserializeGameSpec(json)).toThrow('"createdAt"');
  });

  it('throws on missing array field', () => {
    const partial = { ...sampleGameSpec, rules: 'not-array' };
    const json = JSON.stringify(partial);
    expect(() => deserializeGameSpec(json)).toThrow('"rules"');
  });
});

// ── AccessibilityProfile serialization tests ────────────────────────

describe('serializeAccessibilityProfile / deserializeAccessibilityProfile', () => {
  it('round-trips a valid profile (excluding playerId)', () => {
    const exported = serializeAccessibilityProfile(sampleProfile);
    const result = deserializeAccessibilityProfile(exported);
    const { playerId: _, ...expectedProfile } = sampleProfile;
    expect(result).toEqual(expectedProfile);
  });

  it('export includes a valid checksum', () => {
    const exported = serializeAccessibilityProfile(sampleProfile);
    expect(exported.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('export omits playerId from profile', () => {
    const exported = serializeAccessibilityProfile(sampleProfile);
    expect((exported.profile as Record<string, unknown>).playerId).toBeUndefined();
  });

  it('throws on tampered checksum', () => {
    const exported = serializeAccessibilityProfile(sampleProfile);
    exported.checksum = 'bad'.repeat(16) + 'badd';
    expect(() => deserializeAccessibilityProfile(exported)).toThrow('checksum mismatch');
  });

  it('throws on tampered data', () => {
    const exported = serializeAccessibilityProfile(sampleProfile);
    exported.profile.version = 999;
    expect(() => deserializeAccessibilityProfile(exported)).toThrow('checksum mismatch');
  });
});

// ── PaperMetadata serialization tests ───────────────────────────────

describe('serializePaperMetadata / deserializePaperMetadata', () => {
  it('round-trips valid PaperMetadata', () => {
    const json = serializePaperMetadata(samplePaperMetadata);
    const result = deserializePaperMetadata(json);
    expect(result).toEqual(samplePaperMetadata);
  });

  it('round-trips PaperMetadata with optional fields omitted', () => {
    const minimal: PaperMetadata = {
      title: 'Test', authors: ['A'], abstract: 'Abstract', references: [],
    };
    const json = serializePaperMetadata(minimal);
    const result = deserializePaperMetadata(json);
    expect(result).toEqual(minimal);
  });

  it('throws on invalid JSON', () => {
    expect(() => deserializePaperMetadata('{bad')).toThrow('Invalid JSON');
  });

  it('throws on missing title', () => {
    const json = JSON.stringify({ authors: [], abstract: '', references: [] });
    expect(() => deserializePaperMetadata(json)).toThrow('"title"');
  });

  it('throws on missing authors', () => {
    const json = JSON.stringify({ title: 'T', abstract: '', references: [] });
    expect(() => deserializePaperMetadata(json)).toThrow('"authors"');
  });
});

// ── ConsentConfiguration serialization tests ────────────────────────

describe('serializeConsentConfig / deserializeConsentConfig', () => {
  it('round-trips a valid consent configuration', () => {
    const exported = serializeConsentConfig(sampleConsents);
    const result = deserializeConsentConfig(exported);
    expect(result).toEqual(sampleConsents);
  });

  it('export includes a valid checksum', () => {
    const exported = serializeConsentConfig(sampleConsents);
    expect(exported.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws on tampered checksum', () => {
    const exported = serializeConsentConfig(sampleConsents);
    exported.checksum = '0'.repeat(64);
    expect(() => deserializeConsentConfig(exported)).toThrow('checksum mismatch');
  });

  it('throws on tampered consent values', () => {
    const exported = serializeConsentConfig(sampleConsents);
    exported.consents.webcam = false;
    expect(() => deserializeConsentConfig(exported)).toThrow('checksum mismatch');
  });

  it('throws on missing consent category', () => {
    const exported = serializeConsentConfig(sampleConsents);
    // Bypass checksum by reconstructing with a missing category
    const partial = { ...exported.consents } as Record<string, unknown>;
    delete partial.voice_input;
    const dataWithoutChecksum = {
      exportedAt: exported.exportedAt,
      consents: partial as Record<ConsentCategory, boolean>,
    };
    const checksum = generateChecksum(JSON.stringify(dataWithoutChecksum));
    const tampered = { ...dataWithoutChecksum, checksum };
    expect(() => deserializeConsentConfig(tampered as ConsentConfigurationExport)).toThrow('"voice_input"');
  });
});
