import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../events/event-bus';
import { WebSocketHub, WS_OPEN } from './websocket-hub';
import type { WebSocketLike } from './websocket-hub';
import type { BarrierEvent } from '../types/barrier';
import type { AccessibilityProfile } from '../types/player';
import type { GameSpec } from '../types/game';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

function createMockWs(readyState = WS_OPEN): WebSocketLike & { sentMessages: string[] } {
  const sentMessages: string[] = [];
  return {
    readyState,
    send: vi.fn((data: string) => sentMessages.push(data)),
    close: vi.fn(),
    onclose: null,
    onerror: null,
    sentMessages,
  };
}

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
    detectedElement: { elementId: 'el-1', type: 'text', position: { x: 0, y: 0, width: 100, height: 20 } },
    detectedValue: 10,
    thresholdValue: 16,
    adaptationUndone: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketHub', () => {
  let bus: EventBus;
  let hub: WebSocketHub;

  beforeEach(() => {
    bus = new EventBus();
    hub = new WebSocketHub(bus);
  });

  describe('connection management', () => {
    it('should register a connection and track it by session', () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');

      expect(hub.connectionCount).toBe(1);
      expect(hub.sessionCount).toBe(1);
      expect(hub.getSessionConnections('session-1').size).toBe(1);
    });

    it('should support multiple connections per session', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-1', 'player-1');

      expect(hub.connectionCount).toBe(2);
      expect(hub.sessionCount).toBe(1);
      expect(hub.getSessionConnections('session-1').size).toBe(2);
    });

    it('should support connections across different sessions', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-2', 'player-2');

      expect(hub.connectionCount).toBe(2);
      expect(hub.sessionCount).toBe(2);
    });

    it('should remove a connection', () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');
      hub.removeConnection(ws);

      expect(hub.connectionCount).toBe(0);
      expect(hub.sessionCount).toBe(0);
    });

    it('should clean up session when last connection is removed', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-1', 'player-1');

      hub.removeConnection(ws1);
      expect(hub.sessionCount).toBe(1);

      hub.removeConnection(ws2);
      expect(hub.sessionCount).toBe(0);
    });

    it('should return connection info', () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');

      const info = hub.getConnectionInfo(ws);
      expect(info).toBeDefined();
      expect(info!.sessionId).toBe('session-1');
      expect(info!.playerId).toBe('player-1');
      expect(info!.connectedAt).toBeGreaterThan(0);
    });

    it('should return undefined for unknown connection', () => {
      const ws = createMockWs();
      expect(hub.getConnectionInfo(ws)).toBeUndefined();
    });

    it('should return empty set for unknown session', () => {
      expect(hub.getSessionConnections('nonexistent').size).toBe(0);
    });

    it('should handle removing an unknown connection gracefully', () => {
      const ws = createMockWs();
      // Should not throw
      hub.removeConnection(ws);
      expect(hub.connectionCount).toBe(0);
    });
  });

  describe('broadcasting', () => {
    it('should broadcast to all connections in a session', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-1', 'player-1');

      hub.broadcastToSession('session-1', 'barrier_detected', {
        sessionId: 'session-1',
        playerId: 'player-1',
        barrier: makeBarrier(),
      });

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).toHaveBeenCalledOnce();

      const msg1 = JSON.parse(ws1.sentMessages[0]);
      expect(msg1.type).toBe('barrier_detected');
      expect(msg1.payload.sessionId).toBe('session-1');
      expect(msg1.timestamp).toBeGreaterThan(0);
    });

    it('should not send to connections in other sessions', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-2', 'player-2');

      hub.broadcastToSession('session-1', 'barrier_detected', {
        sessionId: 'session-1',
        playerId: 'player-1',
        barrier: makeBarrier(),
      });

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it('should broadcast to all sessions with broadcastToAll', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-2', 'player-2');

      hub.broadcastToAll('game_generated', {
        sessionId: 's-1',
        playerId: 'p-1',
        gameSpec: { id: 'g-1' } as GameSpec,
      });

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).toHaveBeenCalledOnce();
    });

    it('should skip closed connections', () => {
      const ws = createMockWs(0); // CONNECTING state, not OPEN
      hub.addConnection(ws, 'session-1', 'player-1');

      hub.broadcastToSession('session-1', 'barrier_detected', {
        sessionId: 'session-1',
        playerId: 'player-1',
        barrier: makeBarrier(),
      });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should handle broadcast to nonexistent session gracefully', () => {
      // Should not throw
      hub.broadcastToSession('nonexistent', 'barrier_detected', {
        sessionId: 'nonexistent',
        playerId: 'p-1',
        barrier: makeBarrier(),
      });
    });
  });

  describe('event bus integration', () => {
    it('should forward barrier_detected events to the correct session', async () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');

      await bus.emit('barrier_detected', {
        sessionId: 'session-1',
        playerId: 'player-1',
        barrier: makeBarrier(),
      });

      expect(ws.send).toHaveBeenCalledOnce();
      const msg = JSON.parse(ws.sentMessages[0]);
      expect(msg.type).toBe('barrier_detected');
    });

    it('should forward emotion_changed events', async () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');

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

      expect(ws.send).toHaveBeenCalledOnce();
      const msg = JSON.parse(ws.sentMessages[0]);
      expect(msg.type).toBe('emotion_changed');
    });

    it('should forward adaptation_applied events', async () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');

      await bus.emit('adaptation_applied', {
        sessionId: 'session-1',
        playerId: 'player-1',
        barrier: makeBarrier(),
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

      expect(ws.send).toHaveBeenCalledOnce();
    });

    it('should forward companion_action events', async () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');

      await bus.emit('companion_action', {
        sessionId: 'session-1',
        playerId: 'player-1',
        action: { type: 'move', target: { id: 'e-1', type: 'entity', name: 'hero' }, parameters: {}, sequenceIndex: 0 },
        performedBy: 'companion',
      });

      expect(ws.send).toHaveBeenCalledOnce();
    });

    it('should forward game_generated events', async () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-1', 'player-1');

      await bus.emit('game_generated', {
        sessionId: 'session-1',
        playerId: 'player-1',
        gameSpec: { id: 'g-1' } as GameSpec,
      });

      expect(ws.send).toHaveBeenCalledOnce();
    });

    it('should forward profile_updated to all sessions for that player', async () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      const ws3 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-2', 'player-1');
      hub.addConnection(ws3, 'session-3', 'player-2');

      await bus.emit('profile_updated', {
        playerId: 'player-1',
        profile: { playerId: 'player-1' } as AccessibilityProfile,
      });

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).toHaveBeenCalledOnce();
      expect(ws3.send).not.toHaveBeenCalled();
    });

    it('should not forward events to sessions that do not match', async () => {
      const ws = createMockWs();
      hub.addConnection(ws, 'session-2', 'player-2');

      await bus.emit('barrier_detected', {
        sessionId: 'session-1',
        playerId: 'player-1',
        barrier: makeBarrier(),
      });

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should close all connections and unsubscribe from events', async () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      hub.addConnection(ws1, 'session-1', 'player-1');
      hub.addConnection(ws2, 'session-2', 'player-2');

      hub.destroy();

      expect(ws1.close).toHaveBeenCalled();
      expect(ws2.close).toHaveBeenCalled();
      expect(hub.connectionCount).toBe(0);
      expect(hub.sessionCount).toBe(0);

      // Events should no longer be forwarded
      const ws3 = createMockWs();
      hub.addConnection(ws3, 'session-1', 'player-1');

      await bus.emit('barrier_detected', {
        sessionId: 'session-1',
        playerId: 'player-1',
        barrier: makeBarrier(),
      });

      // Hub re-added ws3 but event bus subscriptions were removed
      expect(ws3.send).not.toHaveBeenCalled();
    });
  });
});
