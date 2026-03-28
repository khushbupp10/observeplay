import type { SpatialPosition } from '../types/common';
import type { GameEnvironment } from '../types/game';
import type {
  VisualGameEvent,
  AudioDescription,
  SpatialSoundscape,
  SoundscapeLayer,
  SceneState,
} from '../types/audio';

// ---------------------------------------------------------------------------
// Speech Synthesizer abstraction
// ---------------------------------------------------------------------------

/**
 * Abstraction over the Web Speech API / Web Audio API for text-to-speech.
 * In production this uses the browser's SpeechSynthesis + AudioContext;
 * in tests we swap in a stub that returns a deterministic buffer.
 */
export interface SpeechSynthesizer {
  /** Synthesize text into an audio buffer. */
  synthesize(text: string): Promise<ArrayBuffer>;
  /** Estimated duration in ms for the given text. */
  estimateDuration(text: string): number;
}

/**
 * Default stub synthesizer — returns a tiny empty buffer.
 * Replace with a real Web Speech API / Web Audio implementation in the browser.
 */
export class StubSpeechSynthesizer implements SpeechSynthesizer {
  async synthesize(_text: string): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
  estimateDuration(text: string): number {
    // Rough estimate: ~80ms per word
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(200, words * 80);
  }
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

type Priority = 'critical' | 'important' | 'ambient';

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  important: 1,
  ambient: 2,
};

type VerbosityLevel = 'minimal' | 'standard' | 'detailed';

/**
 * Returns true if the event should be narrated at the given verbosity level.
 *  - minimal: critical only
 *  - standard: critical + important
 *  - detailed: all
 */
function shouldNarrate(priority: Priority, verbosity: VerbosityLevel): boolean {
  switch (verbosity) {
    case 'minimal':
      return priority === 'critical';
    case 'standard':
      return priority === 'critical' || priority === 'important';
    case 'detailed':
      return true;
  }
}

/**
 * Clamp a spatial position to valid ranges.
 */
function clampPosition(pos: SpatialPosition): SpatialPosition {
  return {
    azimuth: Math.max(-180, Math.min(180, pos.azimuth)),
    elevation: Math.max(-90, Math.min(90, pos.elevation)),
    distance: Math.max(0, Math.min(1, pos.distance)),
  };
}

// ---------------------------------------------------------------------------
// Soundscape generation helpers
// ---------------------------------------------------------------------------

interface EnvironmentTemplate {
  layers: Array<{
    type: string;
    positionFn: () => SpatialPosition;
    volume: number;
    loop: boolean;
  }>;
}

const ENVIRONMENT_TEMPLATES: Record<string, EnvironmentTemplate> = {
  cave: {
    layers: [
      { type: 'dripping_water', positionFn: () => ({ azimuth: -60, elevation: 30, distance: 0.4 }), volume: 0.3, loop: true },
      { type: 'echo_ambience', positionFn: () => ({ azimuth: 0, elevation: 0, distance: 0.8 }), volume: 0.5, loop: true },
      { type: 'distant_rumble', positionFn: () => ({ azimuth: 90, elevation: -20, distance: 0.9 }), volume: 0.2, loop: true },
    ],
  },
  field: {
    layers: [
      { type: 'wind', positionFn: () => ({ azimuth: 45, elevation: 10, distance: 0.3 }), volume: 0.4, loop: true },
      { type: 'birdsong', positionFn: () => ({ azimuth: -90, elevation: 40, distance: 0.5 }), volume: 0.3, loop: true },
      { type: 'rustling_grass', positionFn: () => ({ azimuth: 0, elevation: -10, distance: 0.2 }), volume: 0.2, loop: true },
    ],
  },
  market: {
    layers: [
      { type: 'crowd_chatter', positionFn: () => ({ azimuth: 0, elevation: 0, distance: 0.3 }), volume: 0.6, loop: true },
      { type: 'merchant_calls', positionFn: () => ({ azimuth: -120, elevation: 0, distance: 0.5 }), volume: 0.4, loop: false },
      { type: 'clinking_coins', positionFn: () => ({ azimuth: 60, elevation: -10, distance: 0.4 }), volume: 0.2, loop: true },
      { type: 'footsteps', positionFn: () => ({ azimuth: 150, elevation: -5, distance: 0.2 }), volume: 0.3, loop: true },
    ],
  },
  forest: {
    layers: [
      { type: 'leaves_rustling', positionFn: () => ({ azimuth: -30, elevation: 50, distance: 0.3 }), volume: 0.4, loop: true },
      { type: 'stream', positionFn: () => ({ azimuth: 90, elevation: -20, distance: 0.6 }), volume: 0.3, loop: true },
      { type: 'owl_hoot', positionFn: () => ({ azimuth: -150, elevation: 60, distance: 0.7 }), volume: 0.2, loop: false },
    ],
  },
  dungeon: {
    layers: [
      { type: 'torch_crackle', positionFn: () => ({ azimuth: -45, elevation: 20, distance: 0.3 }), volume: 0.4, loop: true },
      { type: 'chains_rattle', positionFn: () => ({ azimuth: 120, elevation: 0, distance: 0.6 }), volume: 0.2, loop: false },
      { type: 'distant_moans', positionFn: () => ({ azimuth: 0, elevation: -10, distance: 0.9 }), volume: 0.15, loop: true },
    ],
  },
};

/** Fallback template for unknown environment types. */
const DEFAULT_TEMPLATE: EnvironmentTemplate = {
  layers: [
    { type: 'ambient_hum', positionFn: () => ({ azimuth: 0, elevation: 0, distance: 0.5 }), volume: 0.3, loop: true },
    { type: 'subtle_wind', positionFn: () => ({ azimuth: 90, elevation: 10, distance: 0.6 }), volume: 0.2, loop: true },
  ],
};

// ---------------------------------------------------------------------------
// AudioNarratorService implementation
// ---------------------------------------------------------------------------

export class AudioNarratorService {
  private synthesizer: SpeechSynthesizer;
  private verbosity: VerbosityLevel = 'standard';

  constructor(synthesizer?: SpeechSynthesizer) {
    this.synthesizer = synthesizer ?? new StubSpeechSynthesizer();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Set narration verbosity level.
   *  - minimal: critical events only
   *  - standard: critical + important events
   *  - detailed: all events
   */
  setVerbosity(level: VerbosityLevel): void {
    this.verbosity = level;
  }

  getVerbosity(): VerbosityLevel {
    return this.verbosity;
  }

  /**
   * Describe a visual game event with 3D spatial audio positioning.
   * Events are filtered by the current verbosity level.
   * Returns null if the event is filtered out.
   */
  async describeEvent(
    event: VisualGameEvent,
    position: SpatialPosition,
  ): Promise<AudioDescription | null> {
    if (!shouldNarrate(event.priority, this.verbosity)) {
      return null;
    }

    const text = this.generateEventText(event);
    const clamped = clampPosition(position);
    const audioBuffer = await this.synthesizer.synthesize(text);
    const durationMs = this.synthesizer.estimateDuration(text);

    return {
      text,
      audioBuffer,
      spatialPosition: clamped,
      priority: event.priority,
      durationMs,
    };
  }

  /**
   * Generate a comprehensive spatial description of the current scene.
   * Describes all visible elements with their spatial positions, ordered
   * by priority (critical first, then important, then ambient).
   */
  async describeScene(sceneState: SceneState): Promise<AudioDescription> {
    const sorted = [...sceneState.elements].sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    );

    const parts: string[] = [];
    parts.push(`You are in a ${sceneState.environmentType} environment.`);

    for (const element of sorted) {
      const direction = describeDirection(element.position);
      parts.push(`${element.name}: ${element.description}, ${direction}.`);
    }

    const text = parts.join(' ');
    const audioBuffer = await this.synthesizer.synthesize(text);
    const durationMs = this.synthesizer.estimateDuration(text);

    // Center the scene description spatially
    const centerPosition: SpatialPosition = { azimuth: 0, elevation: 0, distance: 0 };

    return {
      text,
      audioBuffer,
      spatialPosition: centerPosition,
      priority: 'critical',
      durationMs,
    };
  }

  /**
   * Generate a unique spatial soundscape for a game environment.
   * Different environment types produce different layer configurations.
   */
  generateSoundscape(environment: GameEnvironment): SpatialSoundscape {
    const envType = environment.type.toLowerCase();
    const template = ENVIRONMENT_TEMPLATES[envType] ?? DEFAULT_TEMPLATE;

    const layers: SoundscapeLayer[] = template.layers.map((layer, index) => ({
      id: `${environment.id}-${layer.type}-${index}`,
      type: layer.type,
      position: clampPosition(layer.positionFn()),
      volume: layer.volume,
      loop: layer.loop,
    }));

    return {
      environmentId: environment.id,
      environmentType: environment.type,
      layers,
    };
  }

  /**
   * Sort events by priority and return them in narration order.
   * Critical first, then important, then ambient.
   */
  prioritizeEvents(events: VisualGameEvent[]): VisualGameEvent[] {
    return [...events].sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    );
  }

  /**
   * Filter events by the current verbosity level.
   */
  filterByVerbosity(events: VisualGameEvent[]): VisualGameEvent[] {
    return events.filter((e) => shouldNarrate(e.priority, this.verbosity));
  }

  /**
   * Process a batch of simultaneous events: filter by verbosity,
   * sort by priority, and generate descriptions.
   */
  async processEventBatch(
    events: VisualGameEvent[],
  ): Promise<AudioDescription[]> {
    const filtered = this.filterByVerbosity(events);
    const sorted = this.prioritizeEvents(filtered);

    const descriptions: AudioDescription[] = [];
    for (const event of sorted) {
      const desc = await this.describeEvent(event, event.position);
      if (desc) {
        descriptions.push(desc);
      }
    }
    return descriptions;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private generateEventText(event: VisualGameEvent): string {
    const prefix = EVENT_TYPE_PREFIXES[event.type] ?? '';
    return prefix ? `${prefix} ${event.description}` : event.description;
  }
}

// ---------------------------------------------------------------------------
// Text generation helpers
// ---------------------------------------------------------------------------

const EVENT_TYPE_PREFIXES: Record<VisualGameEvent['type'], string> = {
  character_movement: 'Movement:',
  environmental_change: 'Environment:',
  item_appearance: 'Item:',
  enemy_action: 'Alert:',
  objective_update: 'Objective:',
};

/**
 * Convert a SpatialPosition into a human-readable direction string.
 */
function describeDirection(pos: SpatialPosition): string {
  const parts: string[] = [];

  // Horizontal direction
  if (pos.azimuth < -45) {
    parts.push('to your left');
  } else if (pos.azimuth > 45) {
    parts.push('to your right');
  } else {
    parts.push('ahead');
  }

  // Vertical direction
  if (pos.elevation > 30) {
    parts.push('above');
  } else if (pos.elevation < -30) {
    parts.push('below');
  }

  // Distance
  if (pos.distance > 0.7) {
    parts.push('far away');
  } else if (pos.distance < 0.3) {
    parts.push('nearby');
  }

  return parts.join(', ');
}
