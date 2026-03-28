import type { SpatialPosition } from './common';

export interface VisualGameEvent {
  type:
    | 'character_movement'
    | 'environmental_change'
    | 'item_appearance'
    | 'enemy_action'
    | 'objective_update';
  description: string;
  priority: 'critical' | 'important' | 'ambient';
  position: SpatialPosition;
}

export interface AudioDescription {
  text: string;
  audioBuffer: ArrayBuffer;
  spatialPosition: SpatialPosition;
  priority: 'critical' | 'important' | 'ambient';
  durationMs: number;
}

export interface SpatialSoundscape {
  environmentId: string;
  environmentType: string;
  layers: SoundscapeLayer[];
}

export interface SoundscapeLayer {
  id: string;
  type: string;
  position: SpatialPosition;
  volume: number; // 0.0 - 1.0
  loop: boolean;
}

export interface SceneElement {
  id: string;
  name: string;
  description: string;
  position: SpatialPosition;
  priority: 'critical' | 'important' | 'ambient';
}

export interface SceneState {
  elements: SceneElement[];
  environmentType: string;
  timestamp: number;
}
