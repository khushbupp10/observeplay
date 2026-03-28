import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Genre, InputMethod } from '../types/common';
import type { AccessibilityProfile } from '../types/player';
import type { GameSpec } from '../types/game';
import {
  GameGeneratorService,
  type GameGenerationResult,
  type ConflictDescription,
} from '../services/game-generator';

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

function makeGameSpec(overrides?: Partial<GameSpec>): GameSpec {
  return {
    id: 'game-1',
    genre: 'adventure',
    title: 'Adventure: space adventure',
    description: 'a space adventure I can play with just my voice',
    createdAt: Date.now(),
    playerDescription: 'a space adventure I can play with just my voice',
    rules: [{ id: 'r1', description: 'Explore areas', condition: 'enter_area', effect: 'reveal' }],
    winConditions: [{ id: 'w1', description: 'Reach destination', condition: 'reached' }],
    mechanics: [
      {
        id: 'm1',
        name: 'move',
        description: 'Move character',
        requiredInputMethods: ['keyboard'],
        alternativeInputMethods: ['voice', 'mouse'],
        difficulty: 0.2,
      },
    ],
    interactionMappings: [{ mechanicId: 'm1', inputMethod: 'keyboard', binding: 'key:move' }],
    visualAssets: [{ id: 'v1', type: 'image', url: '/bg.png', altText: 'Background' }],
    audioAssets: [{ id: 'a1', type: 'audio', url: '/music.mp3', altText: 'Music' }],
    accessibilityAdaptations: [],
    estimatedPlayTimeMinutes: 20,
    difficultyLevel: 'adaptive',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests for GameGeneratorService integration logic
// (Component rendering requires jsdom; here we test the service interactions
//  and the logic that the component relies on)
// ---------------------------------------------------------------------------

describe('GameGenerator component logic', () => {
  let service: GameGeneratorService;

  beforeEach(() => {
    service = new GameGeneratorService();
  });

  describe('game generation flow', () => {
    it('generates a game from a valid description', async () => {
      const result = await service.generateGame({
        playerDescription: 'a space adventure I can play with just my voice',
        profile: makeProfile(),
        sessionId: 'session-1',
      });

      expect(result.success).toBe(true);
      expect(result.gameSpec).toBeDefined();
      expect(result.gameSpec!.title).toBeTruthy();
      expect(result.gameSpec!.rules.length).toBeGreaterThan(0);
      expect(result.gameSpec!.winConditions.length).toBeGreaterThan(0);
      expect(result.gameSpec!.mechanics.length).toBeGreaterThan(0);
      expect(result.gameSpec!.interactionMappings.length).toBeGreaterThan(0);
      expect(result.gameSpec!.visualAssets.length).toBeGreaterThan(0);
      expect(result.gameSpec!.audioAssets.length).toBeGreaterThan(0);
    });

    it('rejects empty descriptions', async () => {
      const result = await service.generateGame({
        playerDescription: '',
        profile: makeProfile(),
        sessionId: 'session-1',
      });

      expect(result.success).toBe(false);
    });

    it('rejects profiles with no input methods', async () => {
      const result = await service.generateGame({
        playerDescription: 'a puzzle game',
        profile: makeProfile({ inputMethods: [] }),
        sessionId: 'session-1',
      });

      expect(result.success).toBe(false);
    });

    it('respects preferred genre selection', async () => {
      const result = await service.generateGame({
        playerDescription: 'a fun game',
        profile: makeProfile(),
        preferredGenre: 'puzzle',
        sessionId: 'session-1',
      });

      expect(result.success).toBe(true);
      expect(result.gameSpec!.genre).toBe('puzzle');
    });

    it('supports all five genres', async () => {
      const genres: Genre[] = ['puzzle', 'adventure', 'strategy', 'simulation', 'narrative'];

      for (const genre of genres) {
        const result = await service.generateGame({
          playerDescription: 'a game',
          profile: makeProfile(),
          preferredGenre: genre,
          sessionId: `session-${genre}`,
        });

        expect(result.success).toBe(true);
        expect(result.gameSpec!.genre).toBe(genre);
      }
    });
  });

  describe('conflict detection', () => {
    it('detects conflicting requirements', () => {
      const result = service.detectConflicts(
        'a fast-paced game with no time pressure',
      );

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].explanation).toBeTruthy();
    });

    it('returns no conflicts for valid descriptions', () => {
      const result = service.detectConflicts(
        'a relaxing puzzle game with colorful tiles',
      );

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
    });

    it('returns conflicts in generation result when description has conflicts', async () => {
      const result = await service.generateGame({
        playerDescription: 'a fast-paced game with no time pressure',
        profile: makeProfile(),
        sessionId: 'session-conflict',
      });

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);
    });
  });

  describe('game modification', () => {
    it('modifies an existing game', async () => {
      const genResult = await service.generateGame({
        playerDescription: 'a puzzle game',
        profile: makeProfile(),
        preferredGenre: 'puzzle',
        sessionId: 'session-1',
      });

      expect(genResult.success).toBe(true);
      const gameId = genResult.gameSpec!.id;

      const modResult = await service.modifyGame(
        gameId,
        'make the enemies slower and add audio cues',
        makeProfile(),
      );

      expect(modResult.success).toBe(true);
      expect(modResult.gameSpec).toBeDefined();
      expect(modResult.gameSpec!.id).toBe(gameId);
    });

    it('rejects empty modification text', async () => {
      const result = await service.modifyGame('game-1', '', makeProfile());

      expect(result.success).toBe(false);
    });
  });

  describe('interaction validation', () => {
    it('validates that all interactions use player input methods', () => {
      const spec = makeGameSpec();
      const result = service.validateInteractions(spec, ['keyboard', 'mouse']);

      expect(result.valid).toBe(true);
      expect(result.invalidMappings).toHaveLength(0);
    });

    it('detects invalid interaction mappings', () => {
      const spec = makeGameSpec({
        interactionMappings: [
          { mechanicId: 'm1', inputMethod: 'eye_tracking', binding: 'eye:gaze_move' },
        ],
      });

      const result = service.validateInteractions(spec, ['keyboard']);

      expect(result.valid).toBe(false);
      expect(result.invalidMappings.length).toBeGreaterThan(0);
    });
  });

  describe('generation result structure', () => {
    it('includes generation time in result', async () => {
      const result = await service.generateGame({
        playerDescription: 'a narrative game',
        profile: makeProfile(),
        sessionId: 'session-1',
      });

      expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('generates accessibility adaptations for profiles with special needs', async () => {
      const result = await service.generateGame({
        playerDescription: 'a puzzle game',
        profile: makeProfile({
          preferredPacing: 'slow',
          minReadableTextSize: 24,
          minContrastRatio: 7.0,
        }),
        preferredGenre: 'puzzle',
        sessionId: 'session-1',
      });

      expect(result.success).toBe(true);
      expect(result.gameSpec!.accessibilityAdaptations.length).toBeGreaterThan(0);
    });
  });
});
