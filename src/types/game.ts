import type { Genre, InputMethod, SpatialPosition } from './common';

export interface GameSpec {
  id: string;
  genre: Genre;
  title: string;
  description: string;
  createdAt: number;
  playerDescription: string;

  // Game logic
  rules: GameRule[];
  winConditions: WinCondition[];
  mechanics: GameMechanic[];

  // Interaction mappings
  interactionMappings: InteractionMapping[];

  // Assets
  visualAssets: AssetReference[];
  audioAssets: AssetReference[];

  // Accessibility adaptations baked in
  accessibilityAdaptations: AccessibilityAdaptation[];

  // Metadata
  estimatedPlayTimeMinutes: number;
  difficultyLevel: 'easy' | 'medium' | 'hard' | 'adaptive';
}

export interface GameRule {
  id: string;
  description: string;
  condition: string;
  effect: string;
}

export interface WinCondition {
  id: string;
  description: string;
  condition: string;
}

export interface GameMechanic {
  id: string;
  name: string;
  description: string;
  requiredInputMethods: InputMethod[];
  alternativeInputMethods: InputMethod[];
  difficulty: number; // 0.0 - 1.0
}

export interface InteractionMapping {
  mechanicId: string;
  inputMethod: InputMethod;
  binding: string;
}

export interface AssetReference {
  id: string;
  type: 'image' | 'audio' | 'animation' | 'soundscape';
  url: string;
  altText?: string;
  spatialPosition?: SpatialPosition;
}

export interface AccessibilityAdaptation {
  mechanicId: string;
  adaptationType: string;
  parameters: Record<string, unknown>;
}

export interface GameAction {
  type: string;
  target: GameEntityRef;
  parameters: Record<string, unknown>;
  sequenceIndex: number;
}

export interface GameEntityRef {
  id: string;
  type: string;
  name: string;
}

export interface GameState {
  sessionId: string;
  gameSpecId: string;
  currentSegment: string;
  entities: GameEntityRef[];
  variables: Record<string, unknown>;
  timestamp: number;
}

export interface GameContext {
  gameState: GameState;
  sessionId: string;
  playerId: string;
}

export interface GameEnvironment {
  id: string;
  name: string;
  type: string;
  description: string;
  ambientProperties: Record<string, unknown>;
}

export interface GameSegment {
  id: string;
  name: string;
  mechanics: string[];
  requiredInputMethods: InputMethod[];
}
