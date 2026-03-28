/**
 * Unit tests for GameRenderer and GameStateManager.
 *
 * Uses jsdom environment for DOM APIs.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GameRenderer,
  GameStateManager,
  type GameRendererEvent,
  type RenderPhase,
} from './game-renderer';
import type { GameSpec, InteractionMapping } from '../types/game';
import type { InputMethod } from '../types/common';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGameSpec(overrides?: Partial<GameSpec>): GameSpec {
  return {
    id: 'test-game-1',
    genre: 'puzzle',
    title: 'Test Puzzle Game',
    description: 'A test puzzle game for unit testing',
    createdAt: Date.now(),
    playerDescription: 'a simple puzzle game',
    rules: [
      { id: 'r1', description: 'Match tiles to score', condition: 'tiles_matched', effect: 'add_score' },
    ],
    winConditions: [
      { id: 'w1', description: 'Clear all tiles', condition: 'all_cleared' },
    ],
    mechanics: [
      {
        id: 'mech-select',
        name: 'tile_select',
        description: 'Select a tile',
        requiredInputMethods: ['mouse'],
        alternativeInputMethods: ['keyboard', 'touch'],
        difficulty: 0.2,
      },
    ],
    interactionMappings: [
      { mechanicId: 'mech-select', inputMethod: 'keyboard', binding: 'key:tile_select' },
    ],
    visualAssets: [
      { id: 'va1', type: 'image', url: '/assets/bg.png', altText: 'background' },
    ],
    audioAssets: [
      { id: 'aa1', type: 'audio', url: '/assets/music.mp3', altText: 'music' },
    ],
    accessibilityAdaptations: [],
    estimatedPlayTimeMinutes: 10,
    difficultyLevel: 'easy',
    ...overrides,
  };
}

/** Instant asset loader for tests — resolves immediately */
const testAssetLoader = async () => {};

/** Asset loader that always fails */
const failingAssetLoader = async () => { throw new Error('load failed'); };

function makeMapping(method: InputMethod, mechanicId = 'mech-1'): InteractionMapping {
  return { mechanicId, inputMethod: method, binding: `${method}:action` };
}

// ---------------------------------------------------------------------------
// GameStateManager
// ---------------------------------------------------------------------------

describe('GameStateManager', () => {
  let manager: GameStateManager;

  beforeEach(() => {
    manager = new GameStateManager(makeGameSpec(), 'sess-1');
  });

  it('initializes with default state', () => {
    const state = manager.getState();
    expect(state.sessionId).toBe('sess-1');
    expect(state.gameSpecId).toBe('test-game-1');
    expect(state.currentSegment).toBe('main');
    expect(state.entities).toEqual([]);
    expect(state.variables.score).toBe(0);
  });

  it('generates a session id when none provided', () => {
    const m = new GameStateManager(makeGameSpec());
    expect(m.getState().sessionId).toMatch(/^session-/);
  });

  it('tracks score', () => {
    expect(manager.getScore()).toBe(0);
    manager.setScore(10);
    expect(manager.getScore()).toBe(10);
    expect(manager.getState().variables.score).toBe(10);
  });

  it('increments score', () => {
    manager.incrementScore(5);
    manager.incrementScore(3);
    expect(manager.getScore()).toBe(8);
  });

  it('manages entities', () => {
    const entity = { id: 'e1', type: 'item', name: 'Sword' };
    manager.addEntity(entity);
    expect(manager.getState().entities).toHaveLength(1);
    expect(manager.getState().entities[0]).toEqual(entity);

    manager.removeEntity('e1');
    expect(manager.getState().entities).toHaveLength(0);
  });

  it('updates variables', () => {
    manager.updateVariable('health', 100);
    expect(manager.getState().variables.health).toBe(100);
  });

  it('sets current segment', () => {
    manager.setCurrentSegment('level-2');
    expect(manager.getState().currentSegment).toBe('level-2');
  });

  it('logs actions', () => {
    const action = {
      type: 'move',
      target: { id: 't1', type: 'location', name: 'castle' },
      parameters: {},
      sequenceIndex: 0,
    };
    manager.logAction(action);
    expect(manager.getActionLog()).toHaveLength(1);
    expect(manager.getActionLog()[0]).toEqual(action);
  });

  it('returns copies of state (immutability)', () => {
    const s1 = manager.getState();
    manager.setScore(99);
    const s2 = manager.getState();
    expect(s1.variables.score).toBe(0);
    expect(s2.variables.score).toBe(99);
  });
});


// ---------------------------------------------------------------------------
// GameRenderer — skeleton rendering
// ---------------------------------------------------------------------------

describe('GameRenderer', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('skeleton rendering', () => {
    it('renders title, description, rules, game area, score, and status', async () => {
      const spec = makeGameSpec();
      const renderer = new GameRenderer({ container, gameSpec: spec, assetLoader: testAssetLoader });
      await renderer.render();

      expect(container.querySelector('.game-title')?.textContent).toBe('Test Puzzle Game');
      expect(container.querySelector('.game-description')?.textContent).toBe(
        'A test puzzle game for unit testing',
      );
      expect(container.querySelector('.game-rules')).toBeTruthy();
      expect(container.querySelector('.game-rules li')?.textContent).toBe('Match tiles to score');
      expect(container.querySelector('[data-game-area]')).toBeTruthy();
      expect(container.querySelector('[data-score]')?.textContent).toContain('Score');
      expect(container.querySelector('[data-status]')).toBeTruthy();
    });

    it('sets accessible attributes on the container', async () => {
      const renderer = new GameRenderer({ container, gameSpec: makeGameSpec(), assetLoader: testAssetLoader });
      await renderer.render();

      expect(container.getAttribute('tabindex')).toBe('0');
      expect(container.getAttribute('role')).toBe('application');
      expect(container.getAttribute('aria-label')).toBe('Game: Test Puzzle Game');
    });

    it('renders rules section with aria-label', async () => {
      const renderer = new GameRenderer({ container, gameSpec: makeGameSpec(), assetLoader: testAssetLoader });
      await renderer.render();

      const rulesSection = container.querySelector('section[aria-label="Game Rules"]');
      expect(rulesSection).toBeTruthy();
      expect(rulesSection?.querySelector('h2')?.textContent).toBe('Rules');
    });

    it('renders game area with proper ARIA region', async () => {
      const renderer = new GameRenderer({ container, gameSpec: makeGameSpec(), assetLoader: testAssetLoader });
      await renderer.render();

      const gameArea = container.querySelector('[data-game-area]');
      expect(gameArea?.getAttribute('role')).toBe('region');
      expect(gameArea?.getAttribute('aria-label')).toBe('Game Play Area');
    });

    it('renders score display with aria-live', async () => {
      const renderer = new GameRenderer({ container, gameSpec: makeGameSpec(), assetLoader: testAssetLoader });
      await renderer.render();

      const score = container.querySelector('[data-score]');
      expect(score?.getAttribute('aria-live')).toBe('polite');
    });

    it('skips rules section when no rules', async () => {
      const spec = makeGameSpec({ rules: [] });
      const renderer = new GameRenderer({ container, gameSpec: spec, assetLoader: testAssetLoader });
      await renderer.render();

      expect(container.querySelector('.game-rules')).toBeNull();
    });
  });

  describe('progressive rendering phases', () => {
    it('progresses through all phases', async () => {
      const phases: RenderPhase[] = [];
      const spec = makeGameSpec({ visualAssets: [], audioAssets: [] });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => {
          if (e.type === 'phase_changed') {
            phases.push(e.payload.phase as RenderPhase);
          }
        },
      });

      await renderer.render();

      expect(phases).toEqual(['skeleton', 'interactive', 'assets-loading', 'complete']);
      expect(renderer.getPhase()).toBe('complete');
    });

    it('is interactive before assets finish loading', async () => {
      let interactiveBeforeComplete = false;
      const spec = makeGameSpec();
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => {
          if (e.type === 'phase_changed' && e.payload.phase === 'interactive') {
            interactiveBeforeComplete = true;
          }
        },
      });

      await renderer.render();
      expect(interactiveBeforeComplete).toBe(true);
    });
  });

  describe('input handler wiring', () => {
    it('fires action_performed on keyboard input', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('keyboard', 'mech-select')],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();

      // Simulate keydown
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      const actionEvents = events.filter((e) => e.type === 'action_performed');
      expect(actionEvents).toHaveLength(1);
      expect(actionEvents[0].payload.inputMethod).toBe('keyboard');
      expect(actionEvents[0].payload.mechanicId).toBe('mech-select');
    });

    it('fires action_performed on mouse click', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('mouse', 'mech-click')],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();

      container.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 200, bubbles: true }));

      const actionEvents = events.filter((e) => e.type === 'action_performed');
      expect(actionEvents).toHaveLength(1);
      expect(actionEvents[0].payload.inputMethod).toBe('mouse');
    });

    it('fires action_performed on touch input', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('touch', 'mech-tap')],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();

      // jsdom TouchEvent support is limited; use a CustomEvent fallback
      const touchEvent = new Event('touchstart', { bubbles: true });
      Object.defineProperty(touchEvent, 'touches', {
        value: [{ clientX: 50, clientY: 75 }],
      });
      container.dispatchEvent(touchEvent);

      const actionEvents = events.filter((e) => e.type === 'action_performed');
      expect(actionEvents).toHaveLength(1);
      expect(actionEvents[0].payload.inputMethod).toBe('touch');
    });

    it('fires action_performed on single_switch (Space key)', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('single_switch', 'mech-switch')],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();

      container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      const actionEvents = events.filter((e) => e.type === 'action_performed');
      expect(actionEvents).toHaveLength(1);
      expect(actionEvents[0].payload.inputMethod).toBe('single_switch');
    });

    it('single_switch ignores non-Space/Enter keys', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('single_switch', 'mech-switch')],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();

      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      const actionEvents = events.filter((e) => e.type === 'action_performed');
      expect(actionEvents).toHaveLength(0);
    });

    it('fires action_performed on eye_tracking custom event', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('eye_tracking', 'mech-gaze')],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();

      container.dispatchEvent(
        new CustomEvent('eyetrack', { detail: { x: 300, y: 400 }, bubbles: true }),
      );

      const actionEvents = events.filter((e) => e.type === 'action_performed');
      expect(actionEvents).toHaveLength(1);
      expect(actionEvents[0].payload.inputMethod).toBe('eye_tracking');
    });

    it('wires multiple input methods simultaneously', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [
          makeMapping('keyboard', 'mech-kb'),
          makeMapping('mouse', 'mech-mouse'),
        ],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();

      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      container.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const actionEvents = events.filter((e) => e.type === 'action_performed');
      expect(actionEvents).toHaveLength(2);
    });
  });

  describe('asset loading', () => {
    it('reports asset status', async () => {
      const spec = makeGameSpec();
      const renderer = new GameRenderer({ container, gameSpec: spec, assetLoader: testAssetLoader });
      await renderer.render();

      const status = renderer.getAssetStatus();
      // In jsdom/node, loadAssetFromUrl resolves immediately
      expect(status.total).toBe(2); // 1 visual + 1 audio
      expect(status.loaded).toBe(2);
      expect(status.failed).toBe(0);
    });

    it('handles empty assets gracefully', async () => {
      const spec = makeGameSpec({ visualAssets: [], audioAssets: [] });
      const renderer = new GameRenderer({ container, gameSpec: spec, assetLoader: testAssetLoader });
      await renderer.render();

      expect(renderer.getAssetStatus().total).toBe(0);
      expect(renderer.getPhase()).toBe('complete');
    });

    it('shows ready status after loading', async () => {
      const spec = makeGameSpec({ visualAssets: [], audioAssets: [] });
      const renderer = new GameRenderer({ container, gameSpec: spec, assetLoader: testAssetLoader });
      await renderer.render();

      const statusEl = container.querySelector('[data-status]');
      expect(statusEl?.textContent).toBe('Ready to play!');
    });

    it('reports failed assets when loader rejects', async () => {
      const spec = makeGameSpec();
      const renderer = new GameRenderer({ container, gameSpec: spec, assetLoader: failingAssetLoader });
      await renderer.render();

      const status = renderer.getAssetStatus();
      expect(status.total).toBe(2);
      expect(status.failed).toBe(2);
      expect(status.loaded).toBe(0);

      const statusEl = container.querySelector('[data-status]');
      expect(statusEl?.textContent).toContain('assets failed to load');
    });
  });

  describe('destroy', () => {
    it('clears container and stops listening', async () => {
      const events: GameRendererEvent[] = [];
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('keyboard', 'mech-kb')],
      });
      const renderer = new GameRenderer({
        container,
        gameSpec: spec,
        assetLoader: testAssetLoader,
        onEvent: (e) => events.push(e),
      });

      await renderer.render();
      renderer.destroy();

      expect(container.innerHTML).toBe('');

      // Events after destroy should not fire
      const countBefore = events.length;
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
      expect(events.length).toBe(countBefore);
    });

    it('render is a no-op after destroy', async () => {
      const renderer = new GameRenderer({ container, gameSpec: makeGameSpec(), assetLoader: testAssetLoader });
      renderer.destroy();
      await renderer.render();
      expect(container.innerHTML).toBe('');
    });
  });

  describe('state manager integration', () => {
    it('logs actions through the state manager on input', async () => {
      const spec = makeGameSpec({
        interactionMappings: [makeMapping('keyboard', 'mech-kb')],
      });
      const renderer = new GameRenderer({ container, gameSpec: spec, assetLoader: testAssetLoader });
      await renderer.render();

      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      const log = renderer.getStateManager().getActionLog();
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe('keyboard:action');
    });
  });
});
