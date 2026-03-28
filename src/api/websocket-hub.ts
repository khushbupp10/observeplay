/**
 * WebSocket Hub — Manages WebSocket connections per session and broadcasts
 * events from the internal event bus to connected clients.
 *
 * Forwards real-time events: copilot adaptations, emotion updates,
 * NL controller dialogue, audio narration, companion actions, and
 * game generation progress.
 *
 * Requirements: 2.2, 3.1, 4.1, 8.1, 11.4, 12.5
 */

import type { EventBus, EventType, EventMap } from '../events/event-bus';

// ---------------------------------------------------------------------------
// Minimal WebSocket interface (compatible with `ws` and browser WebSocket)
// ---------------------------------------------------------------------------

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener?(event: string, listener: (...args: unknown[]) => void): void;
  removeEventListener?(event: string, listener: (...args: unknown[]) => void): void;
  onclose?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
}

/** WebSocket readyState constants */
export const WS_OPEN = 1;

// ---------------------------------------------------------------------------
// Client message sent over the wire
// ---------------------------------------------------------------------------

export interface WebSocketMessage<T extends EventType = EventType> {
  type: T;
  payload: EventMap[T];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Connection metadata
// ---------------------------------------------------------------------------

export interface ConnectionInfo {
  sessionId: string;
  playerId: string;
  connectedAt: number;
}

// ---------------------------------------------------------------------------
// WebSocketHub
// ---------------------------------------------------------------------------

export class WebSocketHub {
  /** sessionId → Set of connected sockets */
  private sessions: Map<string, Set<WebSocketLike>> = new Map();
  /** socket → connection metadata */
  private connectionInfo: Map<WebSocketLike, ConnectionInfo> = new Map();
  /** Unsubscribe functions for event bus subscriptions */
  private unsubscribers: Array<() => void> = [];

  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.subscribeToEvents();
  }

  // ── Connection management ───────────────────────────────────────

  /**
   * Register a WebSocket connection for a session.
   */
  addConnection(ws: WebSocketLike, sessionId: string, playerId: string): void {
    let sessionSockets = this.sessions.get(sessionId);
    if (!sessionSockets) {
      sessionSockets = new Set();
      this.sessions.set(sessionId, sessionSockets);
    }
    sessionSockets.add(ws);

    this.connectionInfo.set(ws, {
      sessionId,
      playerId,
      connectedAt: Date.now(),
    });

    // Clean up on close
    const cleanup = () => this.removeConnection(ws);
    if (ws.addEventListener) {
      ws.addEventListener('close', cleanup);
      ws.addEventListener('error', cleanup);
    } else {
      ws.onclose = cleanup;
      ws.onerror = cleanup;
    }
  }

  /**
   * Remove a WebSocket connection.
   */
  removeConnection(ws: WebSocketLike): void {
    const info = this.connectionInfo.get(ws);
    if (!info) return;

    const sessionSockets = this.sessions.get(info.sessionId);
    if (sessionSockets) {
      sessionSockets.delete(ws);
      if (sessionSockets.size === 0) {
        this.sessions.delete(info.sessionId);
      }
    }
    this.connectionInfo.delete(ws);
  }

  /**
   * Get all connections for a session.
   */
  getSessionConnections(sessionId: string): Set<WebSocketLike> {
    return this.sessions.get(sessionId) ?? new Set();
  }

  /**
   * Get connection info for a socket.
   */
  getConnectionInfo(ws: WebSocketLike): ConnectionInfo | undefined {
    return this.connectionInfo.get(ws);
  }

  /**
   * Get the total number of active connections.
   */
  get connectionCount(): number {
    return this.connectionInfo.size;
  }

  /**
   * Get the number of active sessions.
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  // ── Broadcasting ────────────────────────────────────────────────

  /**
   * Send a typed message to all connections in a session.
   */
  broadcastToSession<T extends EventType>(
    sessionId: string,
    type: T,
    payload: EventMap[T],
  ): void {
    const sockets = this.sessions.get(sessionId);
    if (!sockets || sockets.size === 0) return;

    const message: WebSocketMessage<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };
    const data = JSON.stringify(message);

    for (const ws of sockets) {
      this.safeSend(ws, data);
    }
  }

  /**
   * Send a typed message to all connected clients across all sessions.
   */
  broadcastToAll<T extends EventType>(type: T, payload: EventMap[T]): void {
    const message: WebSocketMessage<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };
    const data = JSON.stringify(message);

    for (const [, sockets] of this.sessions) {
      for (const ws of sockets) {
        this.safeSend(ws, data);
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /**
   * Tear down the hub: unsubscribe from the event bus and close all
   * connections.
   */
  destroy(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    for (const [, sockets] of this.sessions) {
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // ignore close errors during teardown
        }
      }
    }
    this.sessions.clear();
    this.connectionInfo.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────

  /**
   * Subscribe to all relevant event bus events and forward them to the
   * appropriate session's WebSocket connections.
   */
  private subscribeToEvents(): void {
    const sessionEvents: EventType[] = [
      'barrier_detected',
      'emotion_changed',
      'companion_action',
      'adaptation_applied',
      'game_generated',
    ];

    for (const eventType of sessionEvents) {
      const unsub = this.eventBus.on(eventType, (payload: any) => {
        const sessionId = payload.sessionId as string | undefined;
        if (sessionId) {
          this.broadcastToSession(sessionId, eventType, payload);
        }
      });
      this.unsubscribers.push(unsub);
    }

    // profile_updated is broadcast to all sessions for that player
    const unsubProfile = this.eventBus.on('profile_updated', (payload) => {
      const playerId = payload.playerId;
      for (const [sessionId, sockets] of this.sessions) {
        for (const ws of sockets) {
          const info = this.connectionInfo.get(ws);
          if (info && info.playerId === playerId) {
            this.broadcastToSession(sessionId, 'profile_updated', payload);
            break; // one broadcast per session is enough
          }
        }
      }
    });
    this.unsubscribers.push(unsubProfile);
  }

  /**
   * Safely send data to a WebSocket, handling closed connections.
   */
  private safeSend(ws: WebSocketLike, data: string): void {
    try {
      if (ws.readyState === WS_OPEN) {
        ws.send(data);
      }
    } catch {
      // Connection may have closed between readyState check and send
      this.removeConnection(ws);
    }
  }
}
