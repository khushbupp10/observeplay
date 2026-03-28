import { describe, it, expect } from 'vitest';
import {
  NLControllerService,
  RuleBasedNLUProvider,
} from './nl-controller';
import type { GameState, GameEntityRef } from '../types/game';
import type { DialogueContext } from '../types/dialogue';
import type { SupportedLanguage } from '../types/common';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides?: Partial<GameEntityRef>): GameEntityRef {
  return {
    id: 'entity-1',
    type: 'item',
    name: 'sword',
    ...overrides,
  };
}

function makeGameState(overrides?: Partial<GameState>): GameState {
  return {
    sessionId: 'session-1',
    gameSpecId: 'game-1',
    currentSegment: 'castle entrance',
    entities: [
      makeEntity({ id: 'sword-1', type: 'item', name: 'sword' }),
      makeEntity({ id: 'bridge-1', type: 'location', name: 'bridge' }),
      makeEntity({ id: 'castle-1', type: 'location', name: 'castle' }),
      makeEntity({ id: 'potion-1', type: 'item', name: 'health potion' }),
      makeEntity({ id: 'goblin-1', type: 'enemy', name: 'goblin' }),
    ],
    variables: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeContext(overrides?: Partial<DialogueContext>): DialogueContext {
  return {
    sessionId: 'session-1',
    history: [],
    referenceMap: new Map<string, GameEntityRef>(),
    language: 'en' as SupportedLanguage,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NLControllerService', () => {
  describe('interpretCommand()', () => {
    it('interprets a simple move command', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand(
        'move to the castle',
        makeContext(),
        makeGameState(),
      );

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('move');
      expect(result.actions[0].target.name).toBe('castle');
      expect(result.actions[0].sequenceIndex).toBe(0);
    });

    it('interprets a pick up command', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand(
        'pick up the sword',
        makeContext(),
        makeGameState(),
      );

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('pick_up');
      expect(result.actions[0].target.name).toBe('sword');
    });

    it('interprets an attack command', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand(
        'attack the goblin',
        makeContext(),
        makeGameState(),
      );

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('attack');
      expect(result.actions[0].target.name).toBe('goblin');
    });

    it('decomposes multi-step commands with "and then"', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand(
        'pick up the sword and then go to the bridge',
        makeContext(),
        makeGameState(),
      );

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].type).toBe('pick_up');
      expect(result.actions[0].target.name).toBe('sword');
      expect(result.actions[0].sequenceIndex).toBe(0);
      expect(result.actions[1].type).toBe('move');
      expect(result.actions[1].target.name).toBe('bridge');
      expect(result.actions[1].sequenceIndex).toBe(1);
    });

    it('decomposes multi-step commands with "then"', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand(
        'grab the potion then attack the goblin',
        makeContext(),
        makeGameState(),
      );

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].type).toBe('pick_up');
      expect(result.actions[0].target.name).toContain('potion');
      expect(result.actions[1].type).toBe('attack');
      expect(result.actions[1].target.name).toBe('goblin');
    });

    it('decomposes multi-step commands with "and"', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand(
        'take the sword and use the potion',
        makeContext(),
        makeGameState(),
      );

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].type).toBe('pick_up');
      expect(result.actions[1].type).toBe('use');
    });

    it('resolves pronouns from dialogue context', async () => {
      const service = new NLControllerService();
      const context = makeContext();
      const gameState = makeGameState();

      // First command references the sword
      await service.interpretCommand('pick up the sword', context, gameState);

      // Second command uses "it"
      const result = await service.interpretCommand('use it', context, gameState);

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('use');
      expect(result.actions[0].target.name).toBe('sword');
    });

    it('resolves "there" to a location entity', async () => {
      const service = new NLControllerService();
      const context = makeContext();
      const gameState = makeGameState();

      // First command references the bridge (a location)
      await service.interpretCommand('go to the bridge', context, gameState);

      // Second command uses "there"
      const result = await service.interpretCommand('move there', context, gameState);

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].target.name).toBe('bridge');
    });

    it('requests clarification for ambiguous commands', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand(
        'use the mysterious artifact',
        makeContext(),
        makeGameState(),
      );

      expect(result.requiresClarification).toBe(true);
      expect(result.clarificationQuestion).toBeDefined();
    });

    it('returns clarification for empty utterance', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand('', makeContext(), makeGameState());

      expect(result.requiresClarification).toBe(true);
      expect(result.actions).toHaveLength(0);
    });

    it('handles meta commands (help)', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand('help', makeContext(), makeGameState());

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('meta_help');
    });

    it('handles meta commands (undo)', async () => {
      const service = new NLControllerService();
      const result = await service.interpretCommand('undo', makeContext(), makeGameState());

      expect(result.requiresClarification).toBe(false);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('meta_undo');
    });

    it('explains invalid actions when target not in game state', async () => {
      const service = new NLControllerService();
      const gameState = makeGameState({
        entities: [
          makeEntity({ id: 'tree-1', type: 'object', name: 'tree' }),
        ],
      });

      const result = await service.interpretCommand(
        'pick up the sword',
        makeContext(),
        gameState,
      );

      // Sword doesn't exist in this game state
      expect(result.requiresClarification).toBe(true);
    });

    it('maintains dialogue history across commands', async () => {
      const service = new NLControllerService();
      const context = makeContext();
      const gameState = makeGameState();

      await service.interpretCommand('go to the castle', context, gameState);
      await service.interpretCommand('pick up the sword', context, gameState);

      expect(context.history.length).toBeGreaterThanOrEqual(2);
      expect(context.history.some((t) => t.speaker === 'player')).toBe(true);
    });

    it('produces deterministic results for same input', async () => {
      const service = new NLControllerService();
      const gameState = makeGameState();

      const result1 = await service.interpretCommand(
        'move to the castle',
        makeContext(),
        gameState,
      );
      const result2 = await service.interpretCommand(
        'move to the castle',
        makeContext(),
        gameState,
      );

      expect(result1.actions).toHaveLength(result2.actions.length);
      expect(result1.actions[0].type).toBe(result2.actions[0].type);
      expect(result1.actions[0].target.id).toBe(result2.actions[0].target.id);
      expect(result1.confidence).toBe(result2.confidence);
    });
  });

  describe('queryGameState()', () => {
    it('responds to inventory query', async () => {
      const service = new NLControllerService();
      const gameState = makeGameState();
      const result = await service.queryGameState(
        'what is in my inventory?',
        makeContext(),
        gameState,
      );

      expect(result.answer).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('responds to location query', async () => {
      const service = new NLControllerService();
      const gameState = makeGameState();
      const result = await service.queryGameState(
        'where am I?',
        makeContext(),
        gameState,
      );

      expect(result.answer).toContain('castle entrance');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('responds to options query', async () => {
      const service = new NLControllerService();
      const gameState = makeGameState();
      const result = await service.queryGameState(
        'what are my options?',
        makeContext(),
        gameState,
      );

      expect(result.answer).toBeDefined();
      expect(result.referencedEntities.length).toBeGreaterThan(0);
    });

    it('provides a fallback response for unknown queries', async () => {
      const service = new NLControllerService();
      const gameState = makeGameState();
      const result = await service.queryGameState(
        'tell me something interesting',
        makeContext(),
        gameState,
      );

      expect(result.answer).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('requestClarification()', () => {
    it('generates a clarification request from ambiguity', () => {
      const service = new NLControllerService();
      const result = service.requestClarification({
        utterance: 'use that',
        possibleInterpretations: ['use the sword', 'use the potion'],
        conflictingEntities: [
          makeEntity({ id: 'sword-1', name: 'sword' }),
          makeEntity({ id: 'potion-1', name: 'health potion' }),
        ],
      });

      expect(result.question).toContain('use that');
      expect(result.options).toHaveLength(2);
      expect(result.options).toContain('use the sword');
      expect(result.options).toContain('use the potion');
    });

    it('uses entity names when no interpretations provided', () => {
      const service = new NLControllerService();
      const result = service.requestClarification({
        utterance: 'go',
        possibleInterpretations: [],
        conflictingEntities: [
          makeEntity({ id: 'bridge-1', type: 'location', name: 'bridge' }),
          makeEntity({ id: 'castle-1', type: 'location', name: 'castle' }),
        ],
      });

      expect(result.options).toContain('bridge');
      expect(result.options).toContain('castle');
    });
  });

  describe('language support', () => {
    it('handles Spanish commands', async () => {
      const service = new NLControllerService();
      const context = makeContext({ language: 'es' });
      const gameState = makeGameState({
        entities: [makeEntity({ id: 'espada-1', type: 'item', name: 'espada' })],
      });

      const result = await service.interpretCommand(
        'recoger la espada',
        context,
        gameState,
      );

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('pick_up');
    });

    it('handles French commands', async () => {
      const service = new NLControllerService();
      const context = makeContext({ language: 'fr' });
      const gameState = makeGameState({
        entities: [makeEntity({ id: 'epee-1', type: 'item', name: 'épée' })],
      });

      const result = await service.interpretCommand(
        'prendre épée',
        context,
        gameState,
      );

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('pick_up');
    });

    it('handles German commands', async () => {
      const service = new NLControllerService();
      const context = makeContext({ language: 'de' });
      const gameState = makeGameState({
        entities: [makeEntity({ id: 'schwert-1', type: 'item', name: 'schwert' })],
      });

      const result = await service.interpretCommand(
        'nehmen schwert',
        context,
        gameState,
      );

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('pick_up');
    });

    it('handles Japanese commands', async () => {
      const service = new NLControllerService();
      const context = makeContext({ language: 'ja' });
      const gameState = makeGameState({
        entities: [makeEntity({ id: 'katana-1', type: 'item', name: '刀' })],
      });

      const result = await service.interpretCommand(
        '刀を取る',
        context,
        gameState,
      );

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('pick_up');
    });

    it('handles Spanish meta commands', async () => {
      const service = new NLControllerService();
      const context = makeContext({ language: 'es' });
      const result = await service.interpretCommand('ayuda', context, makeGameState());

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('meta_help');
    });
  });

  describe('RuleBasedNLUProvider', () => {
    it('classifies move commands correctly', () => {
      const provider = new RuleBasedNLUProvider();
      const result = provider.classifyIntent(['move', 'to', 'castle'], 'en');

      expect(result.type).toBe('command');
      expect(result.action).toBe('move');
    });

    it('classifies query intents from question words', () => {
      const provider = new RuleBasedNLUProvider();
      const result = provider.classifyIntent(['what', 'is', 'my', 'inventory'], 'en');

      expect(result.type).toBe('query');
    });

    it('classifies meta intents', () => {
      const provider = new RuleBasedNLUProvider();
      const result = provider.classifyIntent(['help'], 'en');

      expect(result.type).toBe('meta');
      expect(result.action).toBe('help');
    });

    it('falls back to English verbs for unknown language tokens', () => {
      const provider = new RuleBasedNLUProvider();
      // Using English verb with non-English language setting
      const result = provider.classifyIntent(['move', 'castle'], 'ja');

      expect(result.type).toBe('command');
      expect(result.action).toBe('move');
    });

    it('returns low confidence for unrecognized commands', () => {
      const provider = new RuleBasedNLUProvider();
      const result = provider.classifyIntent(['xyzzy', 'plugh'], 'en');

      expect(result.confidence).toBeLessThan(0.5);
    });

    it('detects English language', () => {
      const provider = new RuleBasedNLUProvider();
      expect(provider.detectLanguage('move the character to the castle')).toBe('en');
    });

    it('detects Japanese language', () => {
      const provider = new RuleBasedNLUProvider();
      expect(provider.detectLanguage('城に移動する')).toBe('ja');
    });

    it('detects Spanish language', () => {
      const provider = new RuleBasedNLUProvider();
      expect(provider.detectLanguage('mover el personaje al castillo por favor')).toBe('es');
    });

    it('detects French language', () => {
      const provider = new RuleBasedNLUProvider();
      expect(provider.detectLanguage('déplacer le personnage dans le château')).toBe('fr');
    });

    it('detects German language', () => {
      const provider = new RuleBasedNLUProvider();
      expect(provider.detectLanguage('bewegen Sie die Figur zur Burg')).toBe('de');
    });
  });

  describe('custom NLU provider', () => {
    it('uses a custom NLU provider when provided', async () => {
      const customProvider = {
        classifyIntent: () => ({
          type: 'command' as const,
          action: 'custom_action',
          confidence: 0.99,
        }),
        detectLanguage: () => 'en' as SupportedLanguage,
      };

      const service = new NLControllerService(customProvider);
      const gameState = makeGameState();
      const result = await service.interpretCommand(
        'do something with the sword',
        makeContext(),
        gameState,
      );

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('custom_action');
    });
  });
});
