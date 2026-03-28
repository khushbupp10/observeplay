import type { InputMethod } from '../types/common';
import type {
  GameSpec,
  GameState,
  GameAction,
  GameEntityRef,
  InteractionMapping,
} from '../types/game';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rendering phase for progressive rendering */
export type RenderPhase = 'skeleton' | 'interactive' | 'assets-loading' | 'complete';

/** Events emitted by the renderer */
export interface GameRendererEvent {
  type: 'action_performed' | 'state_changed' | 'phase_changed' | 'error';
  timestamp: number;
  payload: Record<string, unknown>;
}

export type GameRendererEventHandler = (event: GameRendererEvent) => void;

/** Configuration for the renderer */
export interface GameRendererConfig {
  /** DOM container to render into */
  container: HTMLElement;
  /** The game spec to render */
  gameSpec: GameSpec;
  /** Optional event handler for game events */
  onEvent?: GameRendererEventHandler;
  /** Optional custom asset loader (useful for testing) */
  assetLoader?: (url: string, type: string) => Promise<void>;
}

/** Asset load status */
export interface AssetLoadStatus {
  total: number;
  loaded: number;
  failed: number;
}

/** Input handler cleanup function */
type CleanupFn = () => void;

// ---------------------------------------------------------------------------
// GameStateManager — tracks current game state, score, variables
// ---------------------------------------------------------------------------

export class GameStateManager {
  private state: GameState;
  private score: number = 0;
  private actionLog: GameAction[] = [];

  constructor(gameSpec: GameSpec, sessionId?: string) {
    this.state = {
      sessionId: sessionId ?? `session-${Date.now()}`,
      gameSpecId: gameSpec.id,
      currentSegment: 'main',
      entities: [],
      variables: { score: 0, turn: 0 },
      timestamp: Date.now(),
    };
  }

  getState(): GameState {
    return {
      ...this.state,
      entities: [...this.state.entities],
      variables: { ...this.state.variables },
    };
  }

  getScore(): number {
    return this.score;
  }

  getActionLog(): GameAction[] {
    return [...this.actionLog];
  }

  updateVariable(key: string, value: unknown): void {
    this.state.variables[key] = value;
    this.state.timestamp = Date.now();
  }

  setScore(score: number): void {
    this.score = score;
    this.state.variables['score'] = score;
    this.state.timestamp = Date.now();
  }

  incrementScore(amount: number): void {
    this.setScore(this.score + amount);
  }

  addEntity(entity: GameEntityRef): void {
    this.state.entities.push(entity);
    this.state.timestamp = Date.now();
  }

  removeEntity(entityId: string): void {
    this.state.entities = this.state.entities.filter((e) => e.id !== entityId);
    this.state.timestamp = Date.now();
  }

  setCurrentSegment(segment: string): void {
    this.state.currentSegment = segment;
    this.state.timestamp = Date.now();
  }

  logAction(action: GameAction): void {
    this.actionLog.push(action);
  }
}


// ---------------------------------------------------------------------------
// Input handler factory — wires interaction mappings to DOM event handlers
// ---------------------------------------------------------------------------

/**
 * Creates a DOM event handler for a given interaction mapping.
 * Returns a cleanup function to remove the listener.
 */
function createInputHandler(
  mapping: InteractionMapping,
  container: HTMLElement,
  onAction: (action: GameAction) => void,
): CleanupFn {
  const method = mapping.inputMethod;

  switch (method) {
    case 'keyboard':
      return attachKeyboardHandler(mapping, container, onAction);
    case 'mouse':
      return attachMouseHandler(mapping, container, onAction);
    case 'touch':
      return attachTouchHandler(mapping, container, onAction);
    case 'voice':
      return attachVoiceHandler(mapping, onAction);
    case 'single_switch':
      return attachSingleSwitchHandler(mapping, container, onAction);
    case 'eye_tracking':
      return attachEyeTrackingHandler(mapping, container, onAction);
    case 'gamepad':
      return attachGamepadHandler(mapping, onAction);
    case 'head_tracking':
    case 'sip_puff':
      // Placeholder — these require hardware SDKs
      return () => {};
    default:
      return () => {};
  }
}

function buildGameAction(mapping: InteractionMapping, extra?: Record<string, unknown>): GameAction {
  return {
    type: mapping.binding,
    target: { id: mapping.mechanicId, type: 'mechanic', name: mapping.mechanicId },
    parameters: extra ?? {},
    sequenceIndex: 0,
  };
}

function attachKeyboardHandler(
  mapping: InteractionMapping,
  container: HTMLElement,
  onAction: (action: GameAction) => void,
): CleanupFn {
  const handler = (e: Event) => {
    const ke = e as KeyboardEvent;
    onAction(buildGameAction(mapping, { key: ke.key, code: ke.code }));
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

function attachMouseHandler(
  mapping: InteractionMapping,
  container: HTMLElement,
  onAction: (action: GameAction) => void,
): CleanupFn {
  const handler = (e: Event) => {
    const me = e as MouseEvent;
    onAction(buildGameAction(mapping, { x: me.clientX, y: me.clientY, button: me.button }));
  };
  container.addEventListener('click', handler);
  return () => container.removeEventListener('click', handler);
}

function attachTouchHandler(
  mapping: InteractionMapping,
  container: HTMLElement,
  onAction: (action: GameAction) => void,
): CleanupFn {
  const handler = (e: Event) => {
    const te = e as TouchEvent;
    const touch = te.touches[0];
    onAction(
      buildGameAction(mapping, {
        x: touch?.clientX ?? 0,
        y: touch?.clientY ?? 0,
      }),
    );
  };
  container.addEventListener('touchstart', handler);
  return () => container.removeEventListener('touchstart', handler);
}

function attachVoiceHandler(
  mapping: InteractionMapping,
  onAction: (action: GameAction) => void,
): CleanupFn {
  // Use Web Speech API if available
  const SpeechRecognitionCtor =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>).SpeechRecognition ??
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
      : undefined;

  if (!SpeechRecognitionCtor) {
    return () => {};
  }

  const recognition = new (SpeechRecognitionCtor as new () => SpeechRecognition)();
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    const last = event.results[event.results.length - 1];
    if (last?.isFinal) {
      const transcript = last[0]?.transcript?.trim().toLowerCase() ?? '';
      onAction(buildGameAction(mapping, { transcript }));
    }
  };

  try {
    recognition.start();
  } catch {
    // Already started or not available
  }

  return () => {
    try {
      recognition.stop();
    } catch {
      // Already stopped
    }
  };
}

function attachSingleSwitchHandler(
  mapping: InteractionMapping,
  container: HTMLElement,
  onAction: (action: GameAction) => void,
): CleanupFn {
  // Single switch maps to Space or Enter
  const handler = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === ' ' || ke.key === 'Enter') {
      onAction(buildGameAction(mapping, { key: ke.key }));
    }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

function attachEyeTrackingHandler(
  mapping: InteractionMapping,
  container: HTMLElement,
  onAction: (action: GameAction) => void,
): CleanupFn {
  // Placeholder: eye tracking requires hardware SDK.
  // We expose a custom event interface so external eye-tracking
  // integrations can dispatch 'eyetrack' events on the container.
  const handler = (e: Event) => {
    const ce = e as CustomEvent<{ x: number; y: number }>;
    onAction(buildGameAction(mapping, { x: ce.detail?.x ?? 0, y: ce.detail?.y ?? 0 }));
  };
  container.addEventListener('eyetrack', handler);
  return () => container.removeEventListener('eyetrack', handler);
}

function attachGamepadHandler(
  mapping: InteractionMapping,
  onAction: (action: GameAction) => void,
): CleanupFn {
  let animFrameId: number | null = null;
  let running = true;

  function poll() {
    if (!running) return;
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (!gp) continue;
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i]?.pressed) {
            onAction(buildGameAction(mapping, { buttonIndex: i, gamepadId: gp.id }));
          }
        }
      }
    }
    animFrameId = requestAnimationFrame(poll);
  }

  poll();

  return () => {
    running = false;
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  };
}


// ---------------------------------------------------------------------------
// GameRenderer — renders a GameSpec into a playable DOM-based game
// ---------------------------------------------------------------------------

export class GameRenderer {
  private config: GameRendererConfig;
  private stateManager: GameStateManager;
  private phase: RenderPhase = 'skeleton';
  private inputCleanups: CleanupFn[] = [];
  private assetStatus: AssetLoadStatus = { total: 0, loaded: 0, failed: 0 };
  private destroyed = false;

  constructor(config: GameRendererConfig) {
    this.config = config;
    this.stateManager = new GameStateManager(config.gameSpec);
  }

  // ---- Public API ----

  getPhase(): RenderPhase {
    return this.phase;
  }

  getStateManager(): GameStateManager {
    return this.stateManager;
  }

  getAssetStatus(): AssetLoadStatus {
    return { ...this.assetStatus };
  }

  /**
   * Start rendering the game progressively.
   * 1. Render skeleton (title, rules, basic UI) — immediately interactive
   * 2. Wire input handlers
   * 3. Load assets in background
   * 4. Mark complete when all assets loaded
   */
  async render(): Promise<void> {
    if (this.destroyed) return;

    // Phase 1: Skeleton
    this.setPhase('skeleton');
    this.renderSkeleton();

    // Phase 2: Wire input handlers — game is now interactive
    this.setPhase('interactive');
    this.wireInputHandlers();

    // Phase 3: Load assets in background
    this.setPhase('assets-loading');
    await this.loadAssets();

    // Phase 4: Complete
    if (!this.destroyed) {
      this.setPhase('complete');
    }
  }

  /**
   * Destroy the renderer, cleaning up all event listeners and DOM content.
   */
  destroy(): void {
    this.destroyed = true;
    for (const cleanup of this.inputCleanups) {
      cleanup();
    }
    this.inputCleanups = [];
    this.config.container.innerHTML = '';
  }

  // ---- Private rendering methods ----

  private setPhase(phase: RenderPhase): void {
    this.phase = phase;
    this.emitEvent({
      type: 'phase_changed',
      timestamp: Date.now(),
      payload: { phase },
    });
  }

  private emitEvent(event: GameRendererEvent): void {
    this.config.onEvent?.(event);
  }

  /**
   * Render the game skeleton: title, description, rules, and a game area.
   * This is shown immediately so the player can start reading/interacting
   * before assets finish loading.
   */
  private renderSkeleton(): void {
    const { gameSpec } = this.config;
    const container = this.config.container;

    // Clear previous content
    container.innerHTML = '';

    // Make container focusable for keyboard events
    container.setAttribute('tabindex', '0');
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', `Game: ${gameSpec.title}`);

    // Title
    const title = document.createElement('h1');
    title.textContent = gameSpec.title;
    title.className = 'game-title';
    container.appendChild(title);

    // Description
    const desc = document.createElement('p');
    desc.textContent = gameSpec.description;
    desc.className = 'game-description';
    container.appendChild(desc);

    // Rules section
    if (gameSpec.rules.length > 0) {
      const rulesSection = document.createElement('section');
      rulesSection.setAttribute('aria-label', 'Game Rules');

      const rulesHeading = document.createElement('h2');
      rulesHeading.textContent = 'Rules';
      rulesSection.appendChild(rulesHeading);

      const rulesList = document.createElement('ul');
      rulesList.className = 'game-rules';
      for (const rule of gameSpec.rules) {
        const li = document.createElement('li');
        li.textContent = rule.description;
        rulesList.appendChild(li);
      }
      rulesSection.appendChild(rulesList);
      container.appendChild(rulesSection);
    }

    // Game area (where the actual game content renders)
    const gameArea = document.createElement('div');
    gameArea.className = 'game-area';
    gameArea.setAttribute('role', 'region');
    gameArea.setAttribute('aria-label', 'Game Play Area');
    gameArea.dataset.gameArea = 'true';
    container.appendChild(gameArea);

    // Score display
    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'game-score';
    scoreDisplay.setAttribute('aria-live', 'polite');
    scoreDisplay.textContent = 'Score: 0';
    scoreDisplay.dataset.score = 'true';
    container.appendChild(scoreDisplay);

    // Status / loading indicator
    const status = document.createElement('div');
    status.className = 'game-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Loading game...';
    status.dataset.status = 'true';
    container.appendChild(status);
  }

  /**
   * Wire interaction mappings to actual DOM event handlers.
   */
  private wireInputHandlers(): void {
    const { gameSpec, container } = this.config;

    for (const mapping of gameSpec.interactionMappings) {
      const cleanup = createInputHandler(mapping, container, (action) => {
        if (this.destroyed) return;

        // Log the action
        this.stateManager.logAction(action);

        // Emit action event
        this.emitEvent({
          type: 'action_performed',
          timestamp: Date.now(),
          payload: {
            mechanicId: mapping.mechanicId,
            inputMethod: mapping.inputMethod,
            binding: mapping.binding,
            action,
          },
        });

        // Update score display
        this.updateScoreDisplay();
      });

      this.inputCleanups.push(cleanup);
    }
  }

  /**
   * Load visual and audio assets in the background.
   * Updates status as assets load.
   */
  private async loadAssets(): Promise<void> {
    const { gameSpec } = this.config;
    const allAssets = [...gameSpec.visualAssets, ...gameSpec.audioAssets];
    this.assetStatus = { total: allAssets.length, loaded: 0, failed: 0 };

    if (allAssets.length === 0) {
      this.updateStatusDisplay('Ready to play!');
      return;
    }

    this.updateStatusDisplay(`Loading assets: 0/${allAssets.length}`);

    const loader = this.config.assetLoader ?? loadAssetFromUrl;

    const loadPromises = allAssets.map(async (asset) => {
      try {
        await loader(asset.url, asset.type);
        this.assetStatus.loaded++;
      } catch {
        this.assetStatus.failed++;
      }
      this.updateStatusDisplay(
        `Loading assets: ${this.assetStatus.loaded + this.assetStatus.failed}/${this.assetStatus.total}`,
      );
    });

    await Promise.allSettled(loadPromises);

    if (!this.destroyed) {
      const msg =
        this.assetStatus.failed > 0
          ? `Ready to play! (${this.assetStatus.failed} assets failed to load)`
          : 'Ready to play!';
      this.updateStatusDisplay(msg);
    }
  }

  private updateScoreDisplay(): void {
    const el = this.config.container.querySelector('[data-score]');
    if (el) {
      el.textContent = `Score: ${this.stateManager.getScore()}`;
    }
  }

  private updateStatusDisplay(text: string): void {
    const el = this.config.container.querySelector('[data-status]');
    if (el) {
      el.textContent = text;
    }
  }
}

// ---------------------------------------------------------------------------
// Asset loading helper
// ---------------------------------------------------------------------------

/** Max time to wait for a single asset before giving up (ms). */
const ASSET_LOAD_TIMEOUT_MS = 10_000;

/**
 * Load an asset from a URL. Returns a promise that resolves when loaded.
 * In a real browser this uses Image/Audio elements; in non-browser or test
 * environments it resolves immediately.
 */
async function loadAssetFromUrl(url: string, type: string): Promise<void> {
  // Server-side or test environments without real resource loading
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.userAgent) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ASSET_LOAD_TIMEOUT_MS);

    if (type === 'image' || type === 'animation') {
      const img = new Image();
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load image: ${url}`)); };
      img.src = url;
    } else if (type === 'audio' || type === 'soundscape') {
      const audio = new Audio();
      audio.oncanplaythrough = () => { clearTimeout(timer); resolve(); };
      audio.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load audio: ${url}`)); };
      audio.src = url;
    } else {
      clearTimeout(timer);
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          resolve();
        })
        .catch(reject);
    }
  });
}
