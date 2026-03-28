import type { CommunicationChannel } from './common';
import type { GameMechanic, GameAction } from './game';

export interface ControlDivision {
  playerControlled: GameMechanic[];
  companionControlled: GameMechanic[];
  shared: GameMechanic[];
}

export interface CompanionPerformanceLog {
  sessionId: string;
  playerActions: LoggedAction[];
  companionActions: LoggedAction[];
  controlTransfers: ControlTransferEvent[];
}

export interface LoggedAction {
  actionId: string;
  action: GameAction;
  timestamp: number;
  mechanicId: string;
  performedBy: 'player' | 'companion';
}

export interface ControlTransferEvent {
  mechanicId: string;
  from: 'player' | 'companion';
  to: 'player' | 'companion';
  timestamp: number;
  reason: string;
}

export interface CompanionPlayerModel {
  playerId: string;
  mechanicPerformance: MechanicPerformanceRecord[];
  lastSyncedWithProfileLearner: number;
}

export interface MechanicPerformanceRecord {
  mechanicId: string;
  controlledBy: 'player' | 'companion';
  sessionResults: SessionMechanicResult[];
}

export interface SessionMechanicResult {
  sessionId: string;
  attempts: number;
  successes: number;
  errorRate: number;
  timestamp: number;
}

export interface AssistanceOffer {
  segmentId: string;
  mechanicIds: string[];
  reason: string;
  communicationChannel: CommunicationChannel;
}
