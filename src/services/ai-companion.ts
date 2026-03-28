import type { AccessibilityProfile } from '../types/player';
import type { GameMechanic, GameAction, GameSegment } from '../types/game';
import type { CommunicationChannel } from '../types/common';
import type {
  ControlDivision,
  CompanionPerformanceLog,
  LoggedAction,
  ControlTransferEvent,
  AssistanceOffer,
} from '../types/companion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanionSession {
  sessionId: string;
  profile: AccessibilityProfile;
  controlDivision: ControlDivision | null;
  performanceLog: CompanionPerformanceLog;
  playerStrategy: PlayerStrategy;
  active: boolean;
  joinedAt: number;
}

export interface PlayerStrategy {
  goals: string[];
  preferences: Record<string, unknown>;
}

export interface ActionAnnouncement {
  actionId: string;
  action: GameAction;
  channel: CommunicationChannel;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Max time (ms) allowed for companion to join a session. */
export const JOIN_DEADLINE_MS = 5000;

/** Max time (ms) allowed for control transfer. */
export const TRANSFER_DEADLINE_MS = 2000;

/**
 * Checks whether a player can perform a given mechanic based on their profile.
 * A mechanic is playable if the player has at least one of the required input
 * methods OR at least one of the alternative input methods.
 */
export function canPlayerPerformMechanic(
  mechanic: GameMechanic,
  profile: AccessibilityProfile,
): boolean {
  const playerMethods = new Set(profile.inputMethods);

  const hasRequired = mechanic.requiredInputMethods.some((m) =>
    playerMethods.has(m),
  );
  if (hasRequired) return true;

  const hasAlternative = mechanic.alternativeInputMethods.some((m) =>
    playerMethods.has(m),
  );
  return hasAlternative;
}

/**
 * Build a human-readable announcement message for a companion action.
 */
function buildAnnouncementMessage(action: GameAction): string {
  const target = action.target?.name ?? 'unknown target';
  return `Companion will ${action.type} on ${target}`;
}

// ---------------------------------------------------------------------------
// AI Companion Service
// ---------------------------------------------------------------------------

export class AICompanionService {
  private sessions: Map<string, CompanionSession> = new Map();
  private announcements: ActionAnnouncement[] = [];

  // -----------------------------------------------------------------------
  // joinSession — companion joins game within 5 seconds (Req 6.1)
  // -----------------------------------------------------------------------
  async joinSession(
    sessionId: string,
    profile: AccessibilityProfile,
  ): Promise<void> {
    const startTime = Date.now();

    const session: CompanionSession = {
      sessionId,
      profile,
      controlDivision: null,
      performanceLog: {
        sessionId,
        playerActions: [],
        companionActions: [],
        controlTransfers: [],
      },
      playerStrategy: { goals: [], preferences: {} },
      active: true,
      joinedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);

    const elapsed = Date.now() - startTime;
    if (elapsed > JOIN_DEADLINE_MS) {
      throw new Error(
        `Companion failed to join within ${JOIN_DEADLINE_MS}ms (took ${elapsed}ms)`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // determineControlDivision — split mechanics by profile (Req 6.2, 6.3)
  // -----------------------------------------------------------------------
  determineControlDivision(
    mechanics: GameMechanic[],
    profile: AccessibilityProfile,
  ): ControlDivision {
    const playerControlled: GameMechanic[] = [];
    const companionControlled: GameMechanic[] = [];
    const shared: GameMechanic[] = [];

    for (const mechanic of mechanics) {
      const playerMethods = new Set(profile.inputMethods);

      const hasRequired = mechanic.requiredInputMethods.some((m) =>
        playerMethods.has(m),
      );
      const hasAlternative = mechanic.alternativeInputMethods.some((m) =>
        playerMethods.has(m),
      );

      if (hasRequired) {
        // Player can use the primary input — full player control
        playerControlled.push(mechanic);
      } else if (hasAlternative) {
        // Player can use an alternative — shared control
        shared.push(mechanic);
      } else {
        // Player cannot perform this mechanic at all — companion takes over
        companionControlled.push(mechanic);
      }
    }

    return { playerControlled, companionControlled, shared };
  }

  // -----------------------------------------------------------------------
  // offerAssistance — offer to handle inaccessible segments (Req 6.3)
  // -----------------------------------------------------------------------
  offerAssistance(
    segment: GameSegment,
    profile: AccessibilityProfile,
    preferredChannel: CommunicationChannel = 'text',
  ): AssistanceOffer {
    const inaccessibleMechanicIds: string[] = [];

    // Identify which mechanics in this segment the player cannot perform
    for (const mechanicId of segment.mechanics) {
      const playerMethods = new Set(profile.inputMethods);
      const canPerform = segment.requiredInputMethods.some((m) =>
        playerMethods.has(m),
      );
      if (!canPerform) {
        inaccessibleMechanicIds.push(mechanicId);
      }
    }

    const reason =
      inaccessibleMechanicIds.length > 0
        ? `This segment requires input methods you don't have available. The companion can handle: ${inaccessibleMechanicIds.join(', ')}`
        : 'All mechanics in this segment are accessible to you.';

    return {
      segmentId: segment.id,
      mechanicIds: inaccessibleMechanicIds,
      reason,
      communicationChannel: preferredChannel,
    };
  }

  // -----------------------------------------------------------------------
  // transferControl — transfer mechanic to player within 2s (Req 6.5)
  // -----------------------------------------------------------------------
  async transferControl(
    sessionId: string,
    mechanicId: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No active session: ${sessionId}`);
    }
    if (!session.controlDivision) {
      throw new Error('Control division not yet determined');
    }

    const startTime = Date.now();

    const division = session.controlDivision;

    // Find the mechanic in companion-controlled or shared lists
    let found = false;
    const idx = division.companionControlled.findIndex(
      (m) => m.id === mechanicId,
    );
    if (idx !== -1) {
      const [mechanic] = division.companionControlled.splice(idx, 1);
      division.playerControlled.push(mechanic);
      found = true;
    }

    if (!found) {
      const sharedIdx = division.shared.findIndex(
        (m) => m.id === mechanicId,
      );
      if (sharedIdx !== -1) {
        const [mechanic] = division.shared.splice(sharedIdx, 1);
        division.playerControlled.push(mechanic);
        found = true;
      }
    }

    if (!found) {
      // Already player-controlled — no-op
      const alreadyPlayer = division.playerControlled.some(
        (m) => m.id === mechanicId,
      );
      if (!alreadyPlayer) {
        throw new Error(`Mechanic ${mechanicId} not found in session`);
      }
    }

    // Log the transfer
    const transferEvent: ControlTransferEvent = {
      mechanicId,
      from: 'companion',
      to: 'player',
      timestamp: Date.now(),
      reason: 'Player requested control transfer',
    };
    session.performanceLog.controlTransfers.push(transferEvent);

    const elapsed = Date.now() - startTime;
    if (elapsed > TRANSFER_DEADLINE_MS) {
      throw new Error(
        `Control transfer exceeded ${TRANSFER_DEADLINE_MS}ms (took ${elapsed}ms)`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // announceAction — communicate before execution (Req 6.6)
  // -----------------------------------------------------------------------
  announceAction(action: GameAction, channel: CommunicationChannel): ActionAnnouncement {
    const announcement: ActionAnnouncement = {
      actionId: generateId(),
      action,
      channel,
      message: buildAnnouncementMessage(action),
      timestamp: Date.now(),
    };

    this.announcements.push(announcement);
    return announcement;
  }

  // -----------------------------------------------------------------------
  // logAction — record an action in the performance log (Req 6.7, 6.8)
  // -----------------------------------------------------------------------
  logAction(
    sessionId: string,
    action: GameAction,
    mechanicId: string,
    performedBy: 'player' | 'companion',
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No active session: ${sessionId}`);
    }

    // Req 6.7: companion never contradicts player strategy
    if (performedBy === 'companion') {
      this.validateAgainstPlayerStrategy(session, action);
    }

    const logged: LoggedAction = {
      actionId: generateId(),
      action,
      timestamp: Date.now(),
      mechanicId,
      performedBy,
    };

    if (performedBy === 'player') {
      session.performanceLog.playerActions.push(logged);
    } else {
      session.performanceLog.companionActions.push(logged);
    }
  }

  // -----------------------------------------------------------------------
  // getPerformanceLog — session log (Req 6.8)
  // -----------------------------------------------------------------------
  getPerformanceLog(sessionId: string): CompanionPerformanceLog {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No active session: ${sessionId}`);
    }
    return session.performanceLog;
  }

  // -----------------------------------------------------------------------
  // setPlayerStrategy — track player goals to avoid contradictions (Req 6.7)
  // -----------------------------------------------------------------------
  setPlayerStrategy(sessionId: string, strategy: PlayerStrategy): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No active session: ${sessionId}`);
    }
    session.playerStrategy = strategy;
  }

  // -----------------------------------------------------------------------
  // setControlDivision — store the division on the session
  // -----------------------------------------------------------------------
  setControlDivision(sessionId: string, division: ControlDivision): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No active session: ${sessionId}`);
    }
    session.controlDivision = division;
  }

  // -----------------------------------------------------------------------
  // getSession — retrieve session state
  // -----------------------------------------------------------------------
  getSession(sessionId: string): CompanionSession | undefined {
    return this.sessions.get(sessionId);
  }

  // -----------------------------------------------------------------------
  // getAnnouncements — retrieve all announcements (for testing/verification)
  // -----------------------------------------------------------------------
  getAnnouncements(): ActionAnnouncement[] {
    return this.announcements;
  }

  // -----------------------------------------------------------------------
  // leaveSession — companion leaves the game session
  // -----------------------------------------------------------------------
  leaveSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.active = false;
    }
  }

  // -----------------------------------------------------------------------
  // Private: validate companion action doesn't contradict player strategy
  // -----------------------------------------------------------------------
  private validateAgainstPlayerStrategy(
    session: CompanionSession,
    action: GameAction,
  ): void {
    const { goals } = session.playerStrategy;
    if (goals.length === 0) return;

    // Check if the action type explicitly contradicts any stated goal.
    // A contradiction is when the action's type is prefixed with "avoid_"
    // matching a player goal, or vice-versa.
    const actionType = action.type.toLowerCase();
    for (const goal of goals) {
      const normalizedGoal = goal.toLowerCase();
      if (
        actionType === `avoid_${normalizedGoal}` ||
        normalizedGoal === `avoid_${actionType}`
      ) {
        throw new Error(
          `Companion action "${action.type}" contradicts player strategy goal "${goal}"`,
        );
      }
    }
  }
}
