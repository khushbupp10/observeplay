import type { SupportedLanguage } from './common';
import type { GameAction, GameEntityRef } from './game';

export interface DialogueContext {
  sessionId: string;
  history: DialogueTurn[];
  referenceMap: Map<string, GameEntityRef>;
  language: SupportedLanguage;
}

export interface DialogueTurn {
  speaker: 'player' | 'system';
  utterance: string;
  timestamp: number;
  referencedEntities: GameEntityRef[];
}

export interface CommandInterpretation {
  actions: GameAction[];
  confidence: number;
  requiresClarification: boolean;
  clarificationQuestion?: string;
}

export interface GameStateResponse {
  answer: string;
  referencedEntities: GameEntityRef[];
  confidence: number;
}

export interface ClarificationRequest {
  question: string;
  options: string[];
  context: string;
}

export interface AmbiguityDescription {
  utterance: string;
  possibleInterpretations: string[];
  conflictingEntities: GameEntityRef[];
}
