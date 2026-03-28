import { describe, it, expect, beforeEach } from 'vitest';
import {
  AudioNarratorService,
  StubSpeechSynthesizer,
  type SpeechSynthesizer,
} from './audio-narrator';
import type { SpatialPosition } from '../types/common';
import type { GameEnvironment } from '../types/game';
import type { VisualGameEvent, SceneState } from '../types/audio';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<VisualGameEvent> = {},
): VisualGameEvent {
  return {
    type: 'character_movement',
    description: 'The hero moves north',
    priority: 'important',
    position: { azimuth: 0, elevation: 0, distance: 0.5 },
    ...overrides,
  };
}

function makePosition(overrides: Partial<SpatialPosition> = {}): SpatialPosition {
  return { azimuth: 0, elevation: 0, distance: 0.5, ...overrides };
}

function makeEnvironment(overrides: Partial<GameEnvironment> = {}): GameEnvironment {
  return {
    id: 'env-1',
    name: 'Dark Cave',
    type: 'cave',
    description: 'A dark, echoing cave',
    ambientProperties: {},
    ...overrides,
  };
}

function makeSceneState(overrides: Partial<SceneState> = {}): SceneState {
  return {
    elements: [
      { id: 'e1', name: 'Dragon', description: 'A fire-breathing dragon', position: { azimuth: -90, elevation: 10, distance: 0.6 }, priority: 'critical' },
      { id: 'e2', name: 'Treasure', description: 'A golden chest', position: { azimuth: 45, elevation: -5, distance: 0.3 }, priority: 'important' },
      { id: 'e3', name: 'Torch', description: 'A flickering wall torch', position: { azimuth: 10, elevation: 20, distance: 0.2 }, priority: 'ambient' },
    ],
    environmentType: 'dungeon',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// StubSpeechSynthesizer tests
// ---------------------------------------------------------------------------

describe('StubSpeechSynthesizer', () => {
  it('returns an empty ArrayBuffer', async () => {
    const synth = new StubSpeechSynthesizer();
    const buf = await synth.synthesize('hello world');
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(0);
  });

  it('estimates duration based on word count', () => {
    const synth = new StubSpeechSynthesizer();
    expect(synth.estimateDuration('one')).toBe(200); // min 200
    expect(synth.estimateDuration('one two three four')).toBe(320); // 4 * 80
  });
});

// ---------------------------------------------------------------------------
// AudioNarratorService tests
// ---------------------------------------------------------------------------

describe('AudioNarratorService', () => {
  let service: AudioNarratorService;

  beforeEach(() => {
    service = new AudioNarratorService();
  });

  // -----------------------------------------------------------------------
  // setVerbosity / getVerbosity
  // -----------------------------------------------------------------------

  describe('setVerbosity', () => {
    it('defaults to standard', () => {
      expect(service.getVerbosity()).toBe('standard');
    });

    it('updates verbosity level', () => {
      service.setVerbosity('minimal');
      expect(service.getVerbosity()).toBe('minimal');
      service.setVerbosity('detailed');
      expect(service.getVerbosity()).toBe('detailed');
    });
  });

  // -----------------------------------------------------------------------
  // describeEvent
  // -----------------------------------------------------------------------

  describe('describeEvent', () => {
    it('returns an AudioDescription with spatial position for a narrated event', async () => {
      const event = makeEvent({ priority: 'critical' });
      const pos = makePosition({ azimuth: 45, elevation: 10, distance: 0.6 });

      const desc = await service.describeEvent(event, pos);

      expect(desc).not.toBeNull();
      expect(desc!.spatialPosition).toEqual(pos);
      expect(desc!.priority).toBe('critical');
      expect(desc!.text).toContain('The hero moves north');
      expect(desc!.durationMs).toBeGreaterThan(0);
      expect(desc!.audioBuffer).toBeInstanceOf(ArrayBuffer);
    });

    it('clamps spatial position to valid ranges', async () => {
      const event = makeEvent({ priority: 'critical' });
      const pos = makePosition({ azimuth: 999, elevation: -200, distance: 5 });

      const desc = await service.describeEvent(event, pos);

      expect(desc).not.toBeNull();
      expect(desc!.spatialPosition.azimuth).toBe(180);
      expect(desc!.spatialPosition.elevation).toBe(-90);
      expect(desc!.spatialPosition.distance).toBe(1);
    });

    it('filters out ambient events at minimal verbosity', async () => {
      service.setVerbosity('minimal');
      const event = makeEvent({ priority: 'ambient' });
      const desc = await service.describeEvent(event, makePosition());
      expect(desc).toBeNull();
    });

    it('filters out important events at minimal verbosity', async () => {
      service.setVerbosity('minimal');
      const event = makeEvent({ priority: 'important' });
      const desc = await service.describeEvent(event, makePosition());
      expect(desc).toBeNull();
    });

    it('allows critical events at minimal verbosity', async () => {
      service.setVerbosity('minimal');
      const event = makeEvent({ priority: 'critical' });
      const desc = await service.describeEvent(event, makePosition());
      expect(desc).not.toBeNull();
    });

    it('allows critical and important events at standard verbosity', async () => {
      service.setVerbosity('standard');

      const critical = await service.describeEvent(makeEvent({ priority: 'critical' }), makePosition());
      const important = await service.describeEvent(makeEvent({ priority: 'important' }), makePosition());
      const ambient = await service.describeEvent(makeEvent({ priority: 'ambient' }), makePosition());

      expect(critical).not.toBeNull();
      expect(important).not.toBeNull();
      expect(ambient).toBeNull();
    });

    it('allows all events at detailed verbosity', async () => {
      service.setVerbosity('detailed');

      const critical = await service.describeEvent(makeEvent({ priority: 'critical' }), makePosition());
      const important = await service.describeEvent(makeEvent({ priority: 'important' }), makePosition());
      const ambient = await service.describeEvent(makeEvent({ priority: 'ambient' }), makePosition());

      expect(critical).not.toBeNull();
      expect(important).not.toBeNull();
      expect(ambient).not.toBeNull();
    });

    it('prefixes event text based on event type', async () => {
      const enemy = makeEvent({ type: 'enemy_action', priority: 'critical', description: 'Goblin attacks' });
      const desc = await service.describeEvent(enemy, makePosition());
      expect(desc!.text).toBe('Alert: Goblin attacks');
    });
  });

  // -----------------------------------------------------------------------
  // describeScene
  // -----------------------------------------------------------------------

  describe('describeScene', () => {
    it('returns a comprehensive description with environment context', async () => {
      const scene = makeSceneState();
      const desc = await service.describeScene(scene);

      expect(desc.text).toContain('dungeon environment');
      expect(desc.text).toContain('Dragon');
      expect(desc.text).toContain('Treasure');
      expect(desc.text).toContain('Torch');
      expect(desc.priority).toBe('critical');
      expect(desc.durationMs).toBeGreaterThan(0);
    });

    it('orders elements by priority (critical first)', async () => {
      const scene = makeSceneState();
      const desc = await service.describeScene(scene);

      const dragonIdx = desc.text.indexOf('Dragon');
      const treasureIdx = desc.text.indexOf('Treasure');
      const torchIdx = desc.text.indexOf('Torch');

      expect(dragonIdx).toBeLessThan(treasureIdx);
      expect(treasureIdx).toBeLessThan(torchIdx);
    });

    it('centers the scene description spatially', async () => {
      const scene = makeSceneState();
      const desc = await service.describeScene(scene);

      expect(desc.spatialPosition).toEqual({ azimuth: 0, elevation: 0, distance: 0 });
    });

    it('handles an empty scene', async () => {
      const scene = makeSceneState({ elements: [] });
      const desc = await service.describeScene(scene);

      expect(desc.text).toContain('dungeon environment');
      expect(desc.durationMs).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // generateSoundscape
  // -----------------------------------------------------------------------

  describe('generateSoundscape', () => {
    it('generates a soundscape for a known environment type', () => {
      const env = makeEnvironment({ type: 'cave' });
      const soundscape = service.generateSoundscape(env);

      expect(soundscape.environmentId).toBe(env.id);
      expect(soundscape.environmentType).toBe('cave');
      expect(soundscape.layers.length).toBeGreaterThan(0);
    });

    it('generates different soundscapes for different environment types', () => {
      const cave = service.generateSoundscape(makeEnvironment({ id: 'e1', type: 'cave' }));
      const field = service.generateSoundscape(makeEnvironment({ id: 'e2', type: 'field' }));

      // Layer types should differ
      const caveTypes = cave.layers.map((l) => l.type).sort();
      const fieldTypes = field.layers.map((l) => l.type).sort();
      expect(caveTypes).not.toEqual(fieldTypes);
    });

    it('uses a fallback template for unknown environment types', () => {
      const env = makeEnvironment({ type: 'alien_planet' });
      const soundscape = service.generateSoundscape(env);

      expect(soundscape.layers.length).toBeGreaterThan(0);
      expect(soundscape.environmentType).toBe('alien_planet');
    });

    it('produces layers with valid spatial positions', () => {
      const env = makeEnvironment({ type: 'market' });
      const soundscape = service.generateSoundscape(env);

      for (const layer of soundscape.layers) {
        expect(layer.position.azimuth).toBeGreaterThanOrEqual(-180);
        expect(layer.position.azimuth).toBeLessThanOrEqual(180);
        expect(layer.position.elevation).toBeGreaterThanOrEqual(-90);
        expect(layer.position.elevation).toBeLessThanOrEqual(90);
        expect(layer.position.distance).toBeGreaterThanOrEqual(0);
        expect(layer.position.distance).toBeLessThanOrEqual(1);
      }
    });

    it('produces layers with valid volume values', () => {
      const env = makeEnvironment({ type: 'forest' });
      const soundscape = service.generateSoundscape(env);

      for (const layer of soundscape.layers) {
        expect(layer.volume).toBeGreaterThanOrEqual(0);
        expect(layer.volume).toBeLessThanOrEqual(1);
      }
    });

    it('generates unique layer IDs', () => {
      const env = makeEnvironment({ type: 'dungeon' });
      const soundscape = service.generateSoundscape(env);
      const ids = soundscape.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // -----------------------------------------------------------------------
  // prioritizeEvents
  // -----------------------------------------------------------------------

  describe('prioritizeEvents', () => {
    it('sorts events: critical first, then important, then ambient', () => {
      const events: VisualGameEvent[] = [
        makeEvent({ priority: 'ambient', description: 'wind blows' }),
        makeEvent({ priority: 'critical', description: 'enemy attacks' }),
        makeEvent({ priority: 'important', description: 'item found' }),
        makeEvent({ priority: 'critical', description: 'health low' }),
      ];

      const sorted = service.prioritizeEvents(events);

      expect(sorted[0].priority).toBe('critical');
      expect(sorted[1].priority).toBe('critical');
      expect(sorted[2].priority).toBe('important');
      expect(sorted[3].priority).toBe('ambient');
    });

    it('does not mutate the original array', () => {
      const events: VisualGameEvent[] = [
        makeEvent({ priority: 'ambient' }),
        makeEvent({ priority: 'critical' }),
      ];
      const original = [...events];
      service.prioritizeEvents(events);
      expect(events).toEqual(original);
    });
  });

  // -----------------------------------------------------------------------
  // filterByVerbosity
  // -----------------------------------------------------------------------

  describe('filterByVerbosity', () => {
    const allEvents: VisualGameEvent[] = [
      makeEvent({ priority: 'critical' }),
      makeEvent({ priority: 'important' }),
      makeEvent({ priority: 'ambient' }),
    ];

    it('minimal: only critical', () => {
      service.setVerbosity('minimal');
      const filtered = service.filterByVerbosity(allEvents);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].priority).toBe('critical');
    });

    it('standard: critical + important', () => {
      service.setVerbosity('standard');
      const filtered = service.filterByVerbosity(allEvents);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((e) => e.priority)).toEqual(['critical', 'important']);
    });

    it('detailed: all events', () => {
      service.setVerbosity('detailed');
      const filtered = service.filterByVerbosity(allEvents);
      expect(filtered).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // processEventBatch
  // -----------------------------------------------------------------------

  describe('processEventBatch', () => {
    it('processes events in priority order', async () => {
      service.setVerbosity('detailed');
      const events: VisualGameEvent[] = [
        makeEvent({ priority: 'ambient', description: 'leaves rustle' }),
        makeEvent({ priority: 'critical', description: 'enemy spotted' }),
        makeEvent({ priority: 'important', description: 'door opens' }),
      ];

      const descriptions = await service.processEventBatch(events);

      expect(descriptions).toHaveLength(3);
      expect(descriptions[0].priority).toBe('critical');
      expect(descriptions[1].priority).toBe('important');
      expect(descriptions[2].priority).toBe('ambient');
    });

    it('filters events by verbosity before processing', async () => {
      service.setVerbosity('minimal');
      const events: VisualGameEvent[] = [
        makeEvent({ priority: 'ambient', description: 'leaves rustle' }),
        makeEvent({ priority: 'critical', description: 'enemy spotted' }),
        makeEvent({ priority: 'important', description: 'door opens' }),
      ];

      const descriptions = await service.processEventBatch(events);

      expect(descriptions).toHaveLength(1);
      expect(descriptions[0].priority).toBe('critical');
    });

    it('returns empty array for no events', async () => {
      const descriptions = await service.processEventBatch([]);
      expect(descriptions).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Custom synthesizer injection
  // -----------------------------------------------------------------------

  describe('custom synthesizer', () => {
    it('uses injected synthesizer for audio generation', async () => {
      const customSynth: SpeechSynthesizer = {
        async synthesize(text: string) {
          const encoder = new TextEncoder();
          return encoder.encode(text).buffer as ArrayBuffer;
        },
        estimateDuration(text: string) {
          return text.length * 10;
        },
      };

      const customService = new AudioNarratorService(customSynth);
      const event = makeEvent({ priority: 'critical', description: 'test' });
      const desc = await customService.describeEvent(event, makePosition());

      expect(desc).not.toBeNull();
      expect(desc!.audioBuffer.byteLength).toBeGreaterThan(0);
      expect(desc!.durationMs).toBe(desc!.text.length * 10);
    });
  });
});
