export interface AdaptationHistory {
  playerId: string;
  entries: AdaptationHistoryEntry[];
}

export interface AdaptationHistoryEntry {
  barrierType: string;
  adaptationType: string;
  sessionId: string;
  timestamp: number;
  accepted: boolean;
}

export interface AdaptationModel {
  playerId: string;
  trainedAt: number;
  rules: ProactiveRule[];
}

export interface ProactiveRule {
  barrierType: string;
  adaptationType: string;
  sessionsObserved: number;
  acceptanceRate: number;
  isProactive: boolean;
  disabledByPlayer: boolean;
}

export interface ProactiveDecision {
  apply: boolean;
  confidence: number;
  sessionsObserved: number;
  acceptanceRate: number;
}

export interface MechanicOutcome {
  mechanicId: string;
  success: boolean;
  sessionId: string;
  timestamp: number;
}

export interface TransferSuggestion {
  mechanicId: string;
  direction: 'to_player' | 'to_companion';
  consecutiveSuccesses?: number;
  errorRate?: number;
  confidence: number;
}

export interface StrugglingDetection {
  mechanicId: string;
  isStruggling: boolean;
  errorRate: number;
  recentAttempts: number;
  recommendation: string;
}
