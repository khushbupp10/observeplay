import type { EmotionCategory } from './common';

export type { EmotionCategory } from './common';

export interface EmotionClassification {
  category: EmotionCategory;
  confidence: number; // 0.0 - 1.0
  timestamp: number;
}

export interface InputPatternWindow {
  pauseFrequency: number;
  errorRate: number;
  inputHesitationMs: number;
  windowDurationMs: number;
}

export interface Intervention {
  type:
    | 'hint'
    | 'difficulty_reduction'
    | 'pacing_adjustment'
    | 'objective_explanation'
    | 'break_suggestion'
    | 'activity_change';
  message: string;
  priority: 'low' | 'medium' | 'high';
}

export interface EmotionState {
  current: EmotionCategory;
  previous: EmotionCategory;
  durationMs: number;
  lastUpdated: number;
  webcamEnabled: boolean;
}

export interface EmotionStateLog {
  sessionId: string;
  playerId: string;
  entries: EmotionStateEntry[];
}

export interface EmotionStateEntry {
  timestamp: number;
  category: EmotionCategory;
  confidence: number;
  source: 'webcam' | 'input_pattern' | 'fused';
  intervention?: Intervention;
  postInterventionState?: EmotionCategory;
}
