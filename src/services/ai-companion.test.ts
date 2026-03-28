import { describe, it, expect, beforeEach } from 'vitest';
import {
  AICompanionService,
  canPlayerPerformMechanic,
  JOIN_DEADLINE_MS,
  TRANSFER_DEADLINE_MS,
} from './ai-companion';
import type { AccessibilityProfile } from '../types/player';
import type { GameMechanic, GameAction, GameSegment } from '../types/game';
import type { CommunicationChannel } from '../types/common';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(
  overrides?: Partial<AccessibilityProfile>,
): AccessibilityProfile {
  return {
    playerId: 'player-1',
    version: 1,
    lastUpdated: Date.now(),
    inputMethods: ['keyboard', 'mouse'],
    responseTimeMs: 500,
    inputAccuracy: 0.9,
    minReadableTextSize: 14,
    minContrastRatio: 4.5,
    colorBlindnessType: null,
    visualFieldRestriction: null,
    hearingCapability: 'full',
    preferredAudioChannel: 'stereo',
    reachableScreenZone: {
      topLeft: { x: 0, y: 0 },
      bottomRight: { x: 1920, y: 1080 },
    },
    clickPrecision: 10,
    holdDuration: 1000,
    preferredPacing: 'moderate',
    maxSimultaneousElements: 5,
    preferredInstructionFormat: 'text',
    learnedPreferences: {},
    manualOverrides: {},
    ...overrides,
  };
}

function makeMechanic(
  overrides?: Partial<GameMechanic>,
): GameMechanic {
  return {
    id: 'mech-1',
    name: 'Jump',
    description: 'Jump over obstacles',
    requiredInputMethods: ['keyboard'],
    alternativeInputMethods: ['gamepad'],
    difficulty: 0.3,
    ...overrides,
  };
}

function makeAction(overrides?: Partial<GameAction>): GameAction {
  return {
    type: 'move',
    target: { id: 'entity-1', type: 'character', name: 'Hero' },
    parameters: { direction: 'north' },
    sequenceIndex: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canPlayerPerformMechanic
// ---------------------------------------------------------------------------

describe('canPlayerPerformMechanic', () => {
  it('returns true when player has a required input method', () => {
    const profile = makeProfile({ inputMethods: ['keyboard'] });
    const mechanic = makeMechanic({ requiredInputMethods: ['keyboard', 'mouse'] });
    expect(canPlayerPerformMechanic(mechanic, profile)).toBe(true);
  });

  it('returns true when player has an alternative input method', () => {
    const profile = makeProfile({ inputMethods: ['gamepad'] });
    const mechanic = makeMechanic({
      requiredInputMethods: ['keyboard'],
      alternativeInputMethods: ['gamepad'],
    });
    expect(canPlayerPerformMechanic(mechanic, profile)).toBe(true);
  });

  it('returns false when player has neither required nor alternative methods', () => {
    const profile = makeProfile({ inputMethods: ['voice'] });
    const mechanic = makeMechanic({
      requiredInputMethods: ['keyboard'],
      alternativeInputMethods: ['mouse'],
    });
    expect(canPlayerPerformMechanic(mechanic, profile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AICompanionService
// ---------------------------------------------------------------------------

describe('AICompanionService', () => {
  let service: AICompanionService;
  const sessionId = 'session-1';
  const profile = makeProfile();

  beforeEach(() => {
    service = new AICompanionService();
  });

  // -----------------------------------------------------------------------
  // joinSession (Req 6.1)
  // -----------------------------------------------------------------------
  describe('joinSession', () => {
    it('creates an active session', async () => {
      await service.joinSession(sessionId, profile);
      const session = service.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.active).toBe(true);
      expect(session!.sessionId).toBe(sessionId);
    });

    it('initialises an empty performance log', async () => {
      await service.joinSession(sessionId, profile);
      const log = service.getPerformanceLog(sessionId);
      expect(log.sessionId).toBe(sessionId);
      expect(log.playerActions).toHaveLength(0);
      expect(log.companionActions).toHaveLength(0);
      expect(log.controlTransfers).toHaveLength(0);
    });

    it('stores the accessibility profile on the session', async () => {
      await service.joinSession(sessionId, profile);
      const session = service.getSession(sessionId);
      expect(session!.profile.playerId).toBe(profile.playerId);
    });
  });

  // -----------------------------------------------------------------------
  // determineControlDivision (Req 6.2, 6.3)
  // -----------------------------------------------------------------------
  describe('determineControlDivision', () => {
    it('assigns mechanics to player when they have required input methods', () => {
      const mechanics = [
        makeMechanic({ id: 'm1', requiredInputMethods: ['keyboard'] }),
      ];
      const division = service.determineControlDivision(mechanics, profile);
      expect(division.playerControlled).toHaveLength(1);
      expect(division.companionControlled).toHaveLength(0);
      expect(division.shared).toHaveLength(0);
    });

    it('assigns mechanics to companion when player lacks all input methods', () => {
      const voiceOnlyProfile = makeProfile({ inputMethods: ['voice'] });
      const mechanics = [
        makeMechanic({
          id: 'm1',
          requiredInputMethods: ['keyboard'],
          alternativeInputMethods: ['mouse'],
        }),
      ];
      const division = service.determineControlDivision(mechanics, voiceOnlyProfile);
      expect(division.playerControlled).toHaveLength(0);
      expect(division.companionControlled).toHaveLength(1);
      expect(division.companionControlled[0].id).toBe('m1');
    });

    it('assigns mechanics to shared when player has alternative but not required methods', () => {
      const gamepadProfile = makeProfile({ inputMethods: ['gamepad'] });
      const mechanics = [
        makeMechanic({
          id: 'm1',
          requiredInputMethods: ['keyboard'],
          alternativeInputMethods: ['gamepad'],
        }),
      ];
      const division = service.determineControlDivision(mechanics, gamepadProfile);
      expect(division.shared).toHaveLength(1);
      expect(division.shared[0].id).toBe('m1');
    });

    it('correctly splits a mixed set of mechanics', () => {
      const voiceProfile = makeProfile({ inputMethods: ['voice', 'gamepad'] });
      const mechanics = [
        makeMechanic({ id: 'm1', requiredInputMethods: ['voice'], alternativeInputMethods: [] }),
        makeMechanic({ id: 'm2', requiredInputMethods: ['keyboard'], alternativeInputMethods: ['gamepad'] }),
        makeMechanic({ id: 'm3', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard'] }),
      ];
      const division = service.determineControlDivision(mechanics, voiceProfile);
      expect(division.playerControlled.map((m) => m.id)).toEqual(['m1']);
      expect(division.shared.map((m) => m.id)).toEqual(['m2']);
      expect(division.companionControlled.map((m) => m.id)).toEqual(['m3']);
    });

    it('handles empty mechanics list', () => {
      const division = service.determineControlDivision([], profile);
      expect(division.playerControlled).toHaveLength(0);
      expect(division.companionControlled).toHaveLength(0);
      expect(division.shared).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // offerAssistance (Req 6.3)
  // -----------------------------------------------------------------------
  describe('offerAssistance', () => {
    it('identifies inaccessible mechanics in a segment', () => {
      const segment: GameSegment = {
        id: 'seg-1',
        name: 'Boss Fight',
        mechanics: ['m1', 'm2'],
        requiredInputMethods: ['eye_tracking'],
      };
      const offer = service.offerAssistance(segment, profile, 'speech');
      expect(offer.segmentId).toBe('seg-1');
      expect(offer.mechanicIds.length).toBeGreaterThan(0);
      expect(offer.communicationChannel).toBe('speech');
    });

    it('returns empty mechanic list when segment is accessible', () => {
      const segment: GameSegment = {
        id: 'seg-2',
        name: 'Walk',
        mechanics: ['m1'],
        requiredInputMethods: ['keyboard'],
      };
      const offer = service.offerAssistance(segment, profile, 'text');
      expect(offer.mechanicIds).toHaveLength(0);
    });

    it('defaults to text channel', () => {
      const segment: GameSegment = {
        id: 'seg-3',
        name: 'Puzzle',
        mechanics: [],
        requiredInputMethods: [],
      };
      const offer = service.offerAssistance(segment, profile);
      expect(offer.communicationChannel).toBe('text');
    });
  });

  // -----------------------------------------------------------------------
  // transferControl (Req 6.5)
  // -----------------------------------------------------------------------
  describe('transferControl', () => {
    it('moves a mechanic from companion to player control', async () => {
      await service.joinSession(sessionId, profile);
      const mechanic = makeMechanic({ id: 'mech-transfer' });
      const division = {
        playerControlled: [],
        companionControlled: [mechanic],
        shared: [],
      };
      service.setControlDivision(sessionId, division);

      await service.transferControl(sessionId, 'mech-transfer');

      const session = service.getSession(sessionId)!;
      expect(
        session.controlDivision!.playerControlled.some((m) => m.id === 'mech-transfer'),
      ).toBe(true);
      expect(
        session.controlDivision!.companionControlled.some((m) => m.id === 'mech-transfer'),
      ).toBe(false);
    });

    it('moves a mechanic from shared to player control', async () => {
      await service.joinSession(sessionId, profile);
      const mechanic = makeMechanic({ id: 'mech-shared' });
      service.setControlDivision(sessionId, {
        playerControlled: [],
        companionControlled: [],
        shared: [mechanic],
      });

      await service.transferControl(sessionId, 'mech-shared');

      const session = service.getSession(sessionId)!;
      expect(
        session.controlDivision!.playerControlled.some((m) => m.id === 'mech-shared'),
      ).toBe(true);
      expect(session.controlDivision!.shared).toHaveLength(0);
    });

    it('logs the control transfer event', async () => {
      await service.joinSession(sessionId, profile);
      const mechanic = makeMechanic({ id: 'mech-log' });
      service.setControlDivision(sessionId, {
        playerControlled: [],
        companionControlled: [mechanic],
        shared: [],
      });

      await service.transferControl(sessionId, 'mech-log');

      const log = service.getPerformanceLog(sessionId);
      expect(log.controlTransfers).toHaveLength(1);
      expect(log.controlTransfers[0].mechanicId).toBe('mech-log');
      expect(log.controlTransfers[0].from).toBe('companion');
      expect(log.controlTransfers[0].to).toBe('player');
    });

    it('is a no-op when mechanic is already player-controlled', async () => {
      await service.joinSession(sessionId, profile);
      const mechanic = makeMechanic({ id: 'mech-already' });
      service.setControlDivision(sessionId, {
        playerControlled: [mechanic],
        companionControlled: [],
        shared: [],
      });

      // Should not throw
      await service.transferControl(sessionId, 'mech-already');
    });

    it('throws for unknown session', async () => {
      await expect(
        service.transferControl('nonexistent', 'mech-1'),
      ).rejects.toThrow('No active session');
    });

    it('throws when control division is not set', async () => {
      await service.joinSession(sessionId, profile);
      await expect(
        service.transferControl(sessionId, 'mech-1'),
      ).rejects.toThrow('Control division not yet determined');
    });
  });

  // -----------------------------------------------------------------------
  // announceAction (Req 6.6)
  // -----------------------------------------------------------------------
  describe('announceAction', () => {
    it('creates an announcement with the correct channel', () => {
      const action = makeAction();
      const announcement = service.announceAction(action, 'speech');
      expect(announcement.channel).toBe('speech');
      expect(announcement.action).toBe(action);
      expect(announcement.message).toContain('Hero');
    });

    it('stores announcements for retrieval', () => {
      service.announceAction(makeAction(), 'text');
      service.announceAction(makeAction(), 'audio_cue');
      expect(service.getAnnouncements()).toHaveLength(2);
    });

    it('generates unique action IDs', () => {
      const a1 = service.announceAction(makeAction(), 'text');
      const a2 = service.announceAction(makeAction(), 'text');
      expect(a1.actionId).not.toBe(a2.actionId);
    });

    it('announcement precedes execution (timestamp is set)', () => {
      const before = Date.now();
      const announcement = service.announceAction(makeAction(), 'speech');
      expect(announcement.timestamp).toBeGreaterThanOrEqual(before);
      expect(announcement.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  // -----------------------------------------------------------------------
  // logAction & getPerformanceLog (Req 6.7, 6.8)
  // -----------------------------------------------------------------------
  describe('logAction / getPerformanceLog', () => {
    it('logs player actions to the performance log', async () => {
      await service.joinSession(sessionId, profile);
      service.logAction(sessionId, makeAction(), 'mech-1', 'player');

      const log = service.getPerformanceLog(sessionId);
      expect(log.playerActions).toHaveLength(1);
      expect(log.playerActions[0].performedBy).toBe('player');
      expect(log.companionActions).toHaveLength(0);
    });

    it('logs companion actions to the performance log', async () => {
      await service.joinSession(sessionId, profile);
      service.logAction(sessionId, makeAction(), 'mech-1', 'companion');

      const log = service.getPerformanceLog(sessionId);
      expect(log.companionActions).toHaveLength(1);
      expect(log.companionActions[0].performedBy).toBe('companion');
    });

    it('attributes each action correctly in a mixed session', async () => {
      await service.joinSession(sessionId, profile);
      service.logAction(sessionId, makeAction({ type: 'move' }), 'mech-1', 'player');
      service.logAction(sessionId, makeAction({ type: 'attack' }), 'mech-2', 'companion');
      service.logAction(sessionId, makeAction({ type: 'defend' }), 'mech-1', 'player');

      const log = service.getPerformanceLog(sessionId);
      expect(log.playerActions).toHaveLength(2);
      expect(log.companionActions).toHaveLength(1);
    });

    it('throws when logging to a nonexistent session', () => {
      expect(() =>
        service.logAction('bad-session', makeAction(), 'mech-1', 'player'),
      ).toThrow('No active session');
    });
  });

  // -----------------------------------------------------------------------
  // Player strategy / contradiction prevention (Req 6.7)
  // -----------------------------------------------------------------------
  describe('player strategy enforcement', () => {
    it('allows companion actions that do not contradict player strategy', async () => {
      await service.joinSession(sessionId, profile);
      service.setPlayerStrategy(sessionId, {
        goals: ['attack'],
        preferences: {},
      });

      // "move" does not contradict "attack"
      expect(() =>
        service.logAction(sessionId, makeAction({ type: 'move' }), 'mech-1', 'companion'),
      ).not.toThrow();
    });

    it('throws when companion action contradicts player strategy', async () => {
      await service.joinSession(sessionId, profile);
      service.setPlayerStrategy(sessionId, {
        goals: ['attack'],
        preferences: {},
      });

      expect(() =>
        service.logAction(
          sessionId,
          makeAction({ type: 'avoid_attack' }),
          'mech-1',
          'companion',
        ),
      ).toThrow('contradicts player strategy');
    });

    it('does not validate strategy for player actions', async () => {
      await service.joinSession(sessionId, profile);
      service.setPlayerStrategy(sessionId, {
        goals: ['attack'],
        preferences: {},
      });

      // Player can do whatever they want, even "avoid_attack"
      expect(() =>
        service.logAction(
          sessionId,
          makeAction({ type: 'avoid_attack' }),
          'mech-1',
          'player',
        ),
      ).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // leaveSession
  // -----------------------------------------------------------------------
  describe('leaveSession', () => {
    it('marks the session as inactive', async () => {
      await service.joinSession(sessionId, profile);
      service.leaveSession(sessionId);
      const session = service.getSession(sessionId);
      expect(session!.active).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  describe('timing constants', () => {
    it('join deadline is 5 seconds', () => {
      expect(JOIN_DEADLINE_MS).toBe(5000);
    });

    it('transfer deadline is 2 seconds', () => {
      expect(TRANSFER_DEADLINE_MS).toBe(2000);
    });
  });
});
