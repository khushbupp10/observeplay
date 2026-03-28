import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from './event-bus';
import { wireLearningServices } from './wire-learning-services';
import type { LearningServices } from './wire-learning-services';
import type { BarrierEvent, AdaptationAction } from '../types/barrier';
import type { AccessibilityProfile } from '../types/player';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBarrier(): BarrierEvent {
  return {
    id: 'b-1',
    sessionId: 'session-1',
    playerId: 'player-1',
    timestamp: Date.now(),
    type: 'small_text',
    severity: 'medium',
    detectedElement: {
      elementId: 'el-1',
      type: 'text',
      position: { x: 0, y: 0, width: 100, height: 20 },
    },
    detectedValue: 10,
    thresholdValue: 16,
    adaptationUndone: false,
  };
}

function makeAdaptation(): AdaptationAction {
  return {
    id: 'a-1',
    type: 'enlarge_text',
    targetElement: {
      elementId: 'el-1',
      type: 'text',
      position: { x: 0, y: 0, width: 100, height: 20 },
    },
    parameters: { newSize: 18 },
    isProactive: false,
    undoable: true,
  };
}

function createMockServices(): LearningServices {
  return {
    profileLearner: {
      refineProfile: vi.fn().mockResolvedValue({ changes: [], requiresPlayerApproval: false }),
    } as any,
    copilotAdaptationLearner: {
      recordOutcome: vi.fn(),
      onPreferenceChange: vi.fn(),
    } as any,
    companionLearning: {
      trackPerformance: vi.fn(),
      onModelChange: vi.fn(),
    } as any,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wireLearningServices', () => {
  let bus: EventBus;
  let services: LearningServices;

  beforeEach(() => {
    bus = new EventBus();
    services = createMockServices();
  });

  it('should forward adaptation_applied events to CopilotAdaptationLearner.recordOutcome', async () => {
    wireLearningServices(bus, services);

    const barrier = makeBarrier();
    const adaptation = makeAdaptation();

    await bus.emit('adaptation_applied', {
      sessionId: 'session-1',
      playerId: 'player-1',
      barrier,
      adaptation,
      accepted: true,
    });

    expect(services.copilotAdaptationLearner.recordOutcome).toHaveBeenCalledWith(
      'player-1',
      barrier,
      adaptation,
      true,
    );
  });

  it('should forward companion_action events to CompanionLearning.trackPerformance', async () => {
    wireLearningServices(bus, services);

    await bus.emit('companion_action', {
      sessionId: 'session-1',
      playerId: 'player-1',
      action: {
        type: 'move',
        target: { id: 'e-1', type: 'entity', name: 'hero' },
        parameters: {},
        sequenceIndex: 0,
      },
      performedBy: 'companion',
    });

    expect(services.companionLearning.trackPerformance).toHaveBeenCalledWith(
      'player-1',
      'move',
      expect.objectContaining({
        mechanicId: 'move',
        success: true,
        sessionId: 'session-1',
      }),
    );
  });

  it('should forward emotion_changed events to ProfileLearner.refineProfile', async () => {
    wireLearningServices(bus, services);

    await bus.emit('emotion_changed', {
      sessionId: 'session-1',
      playerId: 'player-1',
      state: {
        current: 'frustrated',
        previous: 'neutral',
        durationMs: 12000,
        lastUpdated: Date.now(),
        webcamEnabled: true,
      },
    });

    expect(services.profileLearner.refineProfile).toHaveBeenCalledWith(
      'player-1',
      expect.objectContaining({ sessionId: 'session-1' }),
    );
  });

  it('should not throw if profileLearner.refineProfile rejects', async () => {
    (services.profileLearner.refineProfile as any).mockRejectedValue(
      new Error('No profile'),
    );
    wireLearningServices(bus, services);

    // Should not throw
    await bus.emit('emotion_changed', {
      sessionId: 'session-1',
      playerId: 'player-1',
      state: {
        current: 'neutral',
        previous: 'neutral',
        durationMs: 0,
        lastUpdated: Date.now(),
        webcamEnabled: false,
      },
    });
  });

  it('should register preference change listeners on learning services', () => {
    wireLearningServices(bus, services);

    expect(services.copilotAdaptationLearner.onPreferenceChange).toHaveBeenCalledOnce();
    expect(services.companionLearning.onModelChange).toHaveBeenCalledOnce();
  });

  it('should unsubscribe event bus handlers when unsubscribe is called', async () => {
    const unsub = wireLearningServices(bus, services);
    unsub();

    await bus.emit('adaptation_applied', {
      sessionId: 'session-1',
      playerId: 'player-1',
      barrier: makeBarrier(),
      adaptation: makeAdaptation(),
      accepted: true,
    });

    expect(services.copilotAdaptationLearner.recordOutcome).not.toHaveBeenCalled();
  });
});
