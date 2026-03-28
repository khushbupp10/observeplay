import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from './event-bus';
import type {
  BarrierEventPayload,
  EmotionChangedPayload,
  ProfileUpdatedPayload,
  CompanionActionPayload,
  AdaptationAppliedPayload,
  GameGeneratedPayload,
} from './event-bus';
import type { BarrierEvent } from '../types/barrier';
import type { EmotionState } from '../types/emotion';
import type { AccessibilityProfile } from '../types/player';
import type { GameSpec } from '../types/game';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBarrierPayload(overrides?: Partial<BarrierEventPayload>): BarrierEventPayload {
  return {
    sessionId: 'session-1',
    playerId: 'player-1',
    barrier: {
      id: 'b-1',
      sessionId: 'session-1',
      playerId: 'player-1',
      timestamp: Date.now(),
      type: 'small_text',
      severity: 'medium',
      detectedElement: { elementId: 'el-1', type: 'text', position: { x: 0, y: 0, width: 100, height: 20 } },
      detectedValue: 10,
      thresholdValue: 16,
      adaptationUndone: false,
    } as BarrierEvent,
    ...overrides,
  };
}

function makeEmotionPayload(): EmotionChangedPayload {
  return {
    sessionId: 'session-1',
    playerId: 'player-1',
    state: {
      current: 'frustrated',
      previous: 'neutral',
      durationMs: 12000,
      lastUpdated: Date.now(),
      webcamEnabled: true,
    } as EmotionState,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should invoke a sync handler when an event is emitted', async () => {
    const handler = vi.fn();
    bus.on('barrier_detected', handler);

    const payload = makeBarrierPayload();
    await bus.emit('barrier_detected', payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('should invoke an async handler and await it', async () => {
    const order: string[] = [];
    bus.on('emotion_changed', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('handler-done');
    });

    await bus.emit('emotion_changed', makeEmotionPayload());
    order.push('emit-done');

    // handler should complete before emit resolves
    expect(order).toEqual(['handler-done', 'emit-done']);
  });

  it('should support multiple handlers for the same event type', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('barrier_detected', h1);
    bus.on('barrier_detected', h2);

    await bus.emit('barrier_detected', makeBarrierPayload());

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('should not invoke handlers for other event types', async () => {
    const handler = vi.fn();
    bus.on('emotion_changed', handler);

    await bus.emit('barrier_detected', makeBarrierPayload());

    expect(handler).not.toHaveBeenCalled();
  });

  it('should unsubscribe via the returned function', async () => {
    const handler = vi.fn();
    const unsub = bus.on('barrier_detected', handler);

    unsub();
    await bus.emit('barrier_detected', makeBarrierPayload());

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support once() for single-fire handlers', async () => {
    const handler = vi.fn();
    bus.once('barrier_detected', handler);

    await bus.emit('barrier_detected', makeBarrierPayload());
    await bus.emit('barrier_detected', makeBarrierPayload());

    expect(handler).toHaveBeenCalledOnce();
  });

  it('should allow unsubscribing a once() handler before it fires', async () => {
    const handler = vi.fn();
    const unsub = bus.once('barrier_detected', handler);

    unsub();
    await bus.emit('barrier_detected', makeBarrierPayload());

    expect(handler).not.toHaveBeenCalled();
  });

  it('should isolate handler errors so other handlers still run', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h1 = vi.fn(() => { throw new Error('boom'); });
    const h2 = vi.fn();

    bus.on('barrier_detected', h1);
    bus.on('barrier_detected', h2);

    await bus.emit('barrier_detected', makeBarrierPayload());

    expect(h2).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should isolate async handler errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h1 = vi.fn(async () => { throw new Error('async boom'); });
    const h2 = vi.fn();

    bus.on('barrier_detected', h1);
    bus.on('barrier_detected', h2);

    await bus.emit('barrier_detected', makeBarrierPayload());

    expect(h2).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should report correct listenerCount', () => {
    expect(bus.listenerCount('barrier_detected')).toBe(0);

    const unsub1 = bus.on('barrier_detected', vi.fn());
    bus.on('barrier_detected', vi.fn());

    expect(bus.listenerCount('barrier_detected')).toBe(2);

    unsub1();
    expect(bus.listenerCount('barrier_detected')).toBe(1);
  });

  it('should remove all handlers for a type with off(type)', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('barrier_detected', h1);
    bus.on('emotion_changed', h2);

    bus.off('barrier_detected');

    await bus.emit('barrier_detected', makeBarrierPayload());
    await bus.emit('emotion_changed', makeEmotionPayload());

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('should remove all handlers with off()', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('barrier_detected', h1);
    bus.on('emotion_changed', h2);

    bus.off();

    await bus.emit('barrier_detected', makeBarrierPayload());
    await bus.emit('emotion_changed', makeEmotionPayload());

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('should handle emit with no subscribers gracefully', async () => {
    // Should not throw
    await bus.emit('game_generated', {
      sessionId: 's-1',
      playerId: 'p-1',
      gameSpec: { id: 'g-1' } as GameSpec,
    });
  });

  it('should support all six event types', async () => {
    const handlers = {
      barrier_detected: vi.fn(),
      emotion_changed: vi.fn(),
      profile_updated: vi.fn(),
      companion_action: vi.fn(),
      adaptation_applied: vi.fn(),
      game_generated: vi.fn(),
    };

    for (const [type, handler] of Object.entries(handlers)) {
      bus.on(type as any, handler);
    }

    await bus.emit('barrier_detected', makeBarrierPayload());
    await bus.emit('emotion_changed', makeEmotionPayload());
    await bus.emit('profile_updated', {
      playerId: 'p-1',
      profile: { playerId: 'p-1' } as AccessibilityProfile,
    });
    await bus.emit('companion_action', {
      sessionId: 's-1',
      playerId: 'p-1',
      action: { type: 'move', target: { id: 'e-1', type: 'entity', name: 'hero' }, parameters: {}, sequenceIndex: 0 },
      performedBy: 'companion',
    });
    await bus.emit('adaptation_applied', {
      sessionId: 's-1',
      playerId: 'p-1',
      barrier: makeBarrierPayload().barrier,
      adaptation: {
        id: 'a-1',
        type: 'enlarge_text',
        targetElement: { elementId: 'el-1', type: 'text', position: { x: 0, y: 0, width: 100, height: 20 } },
        parameters: {},
        isProactive: false,
        undoable: true,
      },
      accepted: true,
    });
    await bus.emit('game_generated', {
      sessionId: 's-1',
      playerId: 'p-1',
      gameSpec: { id: 'g-1' } as GameSpec,
    });

    for (const handler of Object.values(handlers)) {
      expect(handler).toHaveBeenCalledOnce();
    }
  });
});
