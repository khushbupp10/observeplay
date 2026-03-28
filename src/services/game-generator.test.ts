import { describe, it, expect, vi } from 'vitest';
import {
  GameGeneratorService,
  TemplateBasedLLMProvider,
  type LLMProvider,
  type GameGenerationRequest,
} from './game-generator';
import type { Genre, InputMethod } from '../types/common';
import type { AccessibilityProfile } from '../types/player';
import type { GameSpec } from '../types/game';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides?: Partial<AccessibilityProfile>): AccessibilityProfile {
  return {
    playerId: 'test-player',
    version: 1,
    lastUpdated: Date.now(),
    inputMethods: ['keyboard', 'mouse'] as InputMethod[],
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
    holdDuration: 1000,
    preferredPacing: 'moderate',
    maxSimultaneousElements: 5,
    preferredInstructionFormat: 'multimodal',
    learnedPreferences: {},
    manualOverrides: {},
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<GameGenerationRequest>): GameGenerationRequest {
  return {
    playerDescription: 'a space adventure I can play with just my voice',
    profile: makeProfile(),
    sessionId: 'session-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameGeneratorService', () => {
  describe('generateGame()', () => {
    it('generates a valid GameSpec from a description', async () => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest());

      expect(result.success).toBe(true);
      expect(result.gameSpec).toBeDefined();
      expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('generated GameSpec has non-empty rules, win conditions, mechanics, and assets', async () => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest());

      const spec = result.gameSpec!;
      expect(spec.rules.length).toBeGreaterThan(0);
      expect(spec.winConditions.length).toBeGreaterThan(0);
      expect(spec.mechanics.length).toBeGreaterThan(0);
      expect(spec.interactionMappings.length).toBeGreaterThan(0);
      expect(spec.visualAssets.length).toBeGreaterThan(0);
      expect(spec.audioAssets.length).toBeGreaterThan(0);
    });

    it('returns failure for empty description', async () => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest({ playerDescription: '' }));

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);
    });

    it('returns failure for whitespace-only description', async () => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest({ playerDescription: '   ' }));

      expect(result.success).toBe(false);
    });

    it('returns failure when profile has no input methods', async () => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(
        makeRequest({ profile: makeProfile({ inputMethods: [] }) }),
      );

      expect(result.success).toBe(false);
      expect(result.conflicts![0].explanation).toContain('input method');
    });

    it('detects conflicts and returns them without generating', async () => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(
        makeRequest({ playerDescription: 'a fast-paced game with no time pressure' }),
      );

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);
      expect(result.conflicts![0].explanation).toContain('conflict');
    });

    it('stores the original player description in the GameSpec', async () => {
      const desc = 'a puzzle game about matching colors';
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest({ playerDescription: desc }));

      expect(result.gameSpec!.playerDescription).toBe(desc);
    });

    it('respects preferred genre when provided', async () => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(
        makeRequest({ preferredGenre: 'narrative' }),
      );

      expect(result.gameSpec!.genre).toBe('narrative');
    });

    it('handles LLM provider timeout gracefully', async () => {
      const slowProvider: LLMProvider = {
        generateGameSpec: () =>
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100)),
      };
      const service = new GameGeneratorService(slowProvider);
      const result = await service.generateGame(makeRequest());

      expect(result.success).toBe(false);
    });

    it('all interaction mappings use input methods from the player profile', async () => {
      const profile = makeProfile({ inputMethods: ['voice', 'single_switch'] });
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest({ profile }));

      expect(result.success).toBe(true);
      for (const mapping of result.gameSpec!.interactionMappings) {
        expect(profile.inputMethods).toContain(mapping.inputMethod);
      }
    });

    it('adds accessibility adaptations for slow pacing preference', async () => {
      const profile = makeProfile({ preferredPacing: 'slow' });
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest({ profile }));

      const pacingAdaptations = result.gameSpec!.accessibilityAdaptations.filter(
        (a) => a.adaptationType === 'pacing_adjustment',
      );
      expect(pacingAdaptations.length).toBeGreaterThan(0);
    });

    it('adds text enlargement adaptations for large text requirements', async () => {
      const profile = makeProfile({ minReadableTextSize: 24 });
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest({ profile }));

      const textAdaptations = result.gameSpec!.accessibilityAdaptations.filter(
        (a) => a.adaptationType === 'enlarge_text',
      );
      expect(textAdaptations.length).toBeGreaterThan(0);
    });
  });

  describe('genre detection', () => {
    const genres: [string, Genre][] = [
      ['a puzzle game with matching tiles', 'puzzle'],
      ['an adventure exploring a dungeon', 'adventure'],
      ['a strategy game where I defend my base', 'strategy'],
      ['a city building simulation', 'simulation'],
      ['a story-driven mystery narrative', 'narrative'],
    ];

    it.each(genres)('detects genre from description: "%s" → %s', async (desc, expectedGenre) => {
      const service = new GameGeneratorService();
      const result = await service.generateGame(makeRequest({ playerDescription: desc }));

      expect(result.success).toBe(true);
      expect(result.gameSpec!.genre).toBe(expectedGenre);
    });
  });

  describe('modifyGame()', () => {
    it('modifies an existing game and preserves the game ID', async () => {
      const service = new GameGeneratorService();
      const result = await service.modifyGame(
        'existing-game-id',
        'make the enemies slower and add audio cues',
        makeProfile(),
      );

      expect(result.success).toBe(true);
      expect(result.gameSpec!.id).toBe('existing-game-id');
    });

    it('returns failure for empty modification description', async () => {
      const service = new GameGeneratorService();
      const result = await service.modifyGame('game-1', '', makeProfile());

      expect(result.success).toBe(false);
    });

    it('generates valid assets for modified game', async () => {
      const service = new GameGeneratorService();
      const result = await service.modifyGame(
        'game-1',
        'add more puzzle elements',
        makeProfile(),
      );

      expect(result.gameSpec!.visualAssets.length).toBeGreaterThan(0);
      expect(result.gameSpec!.audioAssets.length).toBeGreaterThan(0);
    });

    it('interaction mappings in modified game use player input methods', async () => {
      const profile = makeProfile({ inputMethods: ['voice', 'eye_tracking'] });
      const service = new GameGeneratorService();
      const result = await service.modifyGame(
        'game-1',
        'make it a narrative adventure',
        profile,
      );

      expect(result.success).toBe(true);
      for (const mapping of result.gameSpec!.interactionMappings) {
        expect(profile.inputMethods).toContain(mapping.inputMethod);
      }
    });

    it('handles LLM provider failure gracefully', async () => {
      const failingProvider: LLMProvider = {
        generateGameSpec: () => Promise.reject(new Error('LLM unavailable')),
      };
      const service = new GameGeneratorService(failingProvider);
      const result = await service.modifyGame('game-1', 'add puzzles', makeProfile());

      expect(result.success).toBe(false);
      expect(result.conflicts![0].explanation).toContain('failed');
    });
  });

  describe('validateInteractions()', () => {
    it('returns valid when all mappings use player input methods', () => {
      const service = new GameGeneratorService();
      const spec: GameSpec = {
        id: 'test',
        genre: 'puzzle',
        title: 'Test',
        description: 'test',
        createdAt: Date.now(),
        playerDescription: 'test',
        rules: [],
        winConditions: [],
        mechanics: [
          { id: 'm1', name: 'select', description: 'select tile', requiredInputMethods: ['keyboard'], alternativeInputMethods: ['voice'], difficulty: 0.2 },
        ],
        interactionMappings: [
          { mechanicId: 'm1', inputMethod: 'keyboard', binding: 'key:select' },
        ],
        visualAssets: [],
        audioAssets: [],
        accessibilityAdaptations: [],
        estimatedPlayTimeMinutes: 10,
        difficultyLevel: 'easy',
      };

      const result = service.validateInteractions(spec, ['keyboard', 'mouse']);
      expect(result.valid).toBe(true);
      expect(result.invalidMappings).toHaveLength(0);
    });

    it('returns invalid when a mapping uses an unavailable input method', () => {
      const service = new GameGeneratorService();
      const spec: GameSpec = {
        id: 'test',
        genre: 'puzzle',
        title: 'Test',
        description: 'test',
        createdAt: Date.now(),
        playerDescription: 'test',
        rules: [],
        winConditions: [],
        mechanics: [
          { id: 'm1', name: 'select', description: 'select tile', requiredInputMethods: ['mouse'], alternativeInputMethods: [], difficulty: 0.2 },
        ],
        interactionMappings: [
          { mechanicId: 'm1', inputMethod: 'mouse', binding: 'mouse:click_select' },
        ],
        visualAssets: [],
        audioAssets: [],
        accessibilityAdaptations: [],
        estimatedPlayTimeMinutes: 10,
        difficultyLevel: 'easy',
      };

      const result = service.validateInteractions(spec, ['voice']);
      expect(result.valid).toBe(false);
      expect(result.invalidMappings).toHaveLength(1);
      expect(result.invalidMappings[0].mechanicId).toBe('m1');
    });

    it('detects mechanics with no mapping and no compatible input method', () => {
      const service = new GameGeneratorService();
      const spec: GameSpec = {
        id: 'test',
        genre: 'puzzle',
        title: 'Test',
        description: 'test',
        createdAt: Date.now(),
        playerDescription: 'test',
        rules: [],
        winConditions: [],
        mechanics: [
          { id: 'm1', name: 'drag', description: 'drag element', requiredInputMethods: ['mouse'], alternativeInputMethods: ['touch'], difficulty: 0.5 },
        ],
        interactionMappings: [],
        visualAssets: [],
        audioAssets: [],
        accessibilityAdaptations: [],
        estimatedPlayTimeMinutes: 10,
        difficultyLevel: 'easy',
      };

      const result = service.validateInteractions(spec, ['voice', 'single_switch']);
      expect(result.valid).toBe(false);
      expect(result.invalidMappings[0].reason).toContain('No compatible input method');
    });

    it('accepts mappings using alternative input methods', () => {
      const service = new GameGeneratorService();
      const spec: GameSpec = {
        id: 'test',
        genre: 'puzzle',
        title: 'Test',
        description: 'test',
        createdAt: Date.now(),
        playerDescription: 'test',
        rules: [],
        winConditions: [],
        mechanics: [
          { id: 'm1', name: 'select', description: 'select', requiredInputMethods: ['mouse'], alternativeInputMethods: ['voice'], difficulty: 0.2 },
        ],
        interactionMappings: [
          { mechanicId: 'm1', inputMethod: 'voice', binding: 'voice:select' },
        ],
        visualAssets: [],
        audioAssets: [],
        accessibilityAdaptations: [],
        estimatedPlayTimeMinutes: 10,
        difficultyLevel: 'easy',
      };

      const result = service.validateInteractions(spec, ['voice']);
      expect(result.valid).toBe(true);
    });
  });

  describe('detectConflicts()', () => {
    it('detects fast-paced + no time pressure conflict', () => {
      const service = new GameGeneratorService();
      const result = service.detectConflicts('I want a fast-paced game with no time pressure');

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('detects complex controls + simple controls conflict', () => {
      const service = new GameGeneratorService();
      const result = service.detectConflicts('a game with complex controls but simple controls');

      expect(result.hasConflicts).toBe(true);
    });

    it('detects multiplayer + single player conflict', () => {
      const service = new GameGeneratorService();
      const result = service.detectConflicts('a multiplayer game I can play solo');

      expect(result.hasConflicts).toBe(true);
    });

    it('detects text heavy + no reading conflict', () => {
      const service = new GameGeneratorService();
      const result = service.detectConflicts('a text heavy game with no reading');

      expect(result.hasConflicts).toBe(true);
    });

    it('returns no conflicts for a valid description', () => {
      const service = new GameGeneratorService();
      const result = service.detectConflicts('a relaxing puzzle game with colorful tiles');

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
    });

    it('returns no conflicts for an empty description', () => {
      const service = new GameGeneratorService();
      const result = service.detectConflicts('');

      expect(result.hasConflicts).toBe(false);
    });
  });

  describe('TemplateBasedLLMProvider', () => {
    const allGenres: Genre[] = ['puzzle', 'adventure', 'strategy', 'simulation', 'narrative'];

    it.each(allGenres)('generates a valid GameSpec for genre: %s', async (genre) => {
      const provider = new TemplateBasedLLMProvider();
      const spec = await provider.generateGameSpec('test game', genre);

      expect(spec.genre).toBe(genre);
      expect(spec.rules.length).toBeGreaterThan(0);
      expect(spec.winConditions.length).toBeGreaterThan(0);
      expect(spec.mechanics.length).toBeGreaterThan(0);
      expect(spec.title).toBeTruthy();
      expect(spec.id).toBeTruthy();
    });

    it('includes the description in the generated spec', async () => {
      const provider = new TemplateBasedLLMProvider();
      const desc = 'a fun puzzle about space';
      const spec = await provider.generateGameSpec(desc, 'puzzle');

      expect(spec.description).toBe(desc);
      expect(spec.playerDescription).toBe(desc);
    });
  });

  describe('custom LLM provider', () => {
    it('uses a custom LLM provider when provided', async () => {
      const customSpec: GameSpec = {
        id: 'custom-1',
        genre: 'narrative',
        title: 'Custom Game',
        description: 'custom',
        createdAt: Date.now(),
        playerDescription: 'custom',
        rules: [{ id: 'r1', description: 'custom rule', condition: 'true', effect: 'win' }],
        winConditions: [{ id: 'w1', description: 'custom win', condition: 'true' }],
        mechanics: [
          { id: 'm1', name: 'choose', description: 'make a choice', requiredInputMethods: ['keyboard'], alternativeInputMethods: ['voice'], difficulty: 0.1 },
        ],
        interactionMappings: [],
        visualAssets: [],
        audioAssets: [],
        accessibilityAdaptations: [],
        estimatedPlayTimeMinutes: 5,
        difficultyLevel: 'easy',
      };

      const customProvider: LLMProvider = {
        generateGameSpec: vi.fn(async () => customSpec),
      };

      const service = new GameGeneratorService(customProvider);
      const result = await service.generateGame(makeRequest());

      expect(result.success).toBe(true);
      expect(customProvider.generateGameSpec).toHaveBeenCalled();
      expect(result.gameSpec!.title).toBe('Custom Game');
    });
  });
});
