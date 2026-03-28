/**
 * Event Bus — Internal event stream for inter-service communication.
 *
 * Typed pub/sub system supporting barrier events, emotion state changes,
 * profile updates, companion actions, adaptation applications, and game
 * generation events. Handlers can be synchronous or asynchronous.
 *
 * Requirements: 2.2, 3.1, 4.1, 8.1, 11.4, 12.5
 */

import type { BarrierEvent, AdaptationAction } from '../types/barrier';
import type { EmotionState } from '../types/emotion';
import type { AccessibilityProfile } from '../types/player';
import type { GameAction, GameSpec } from '../types/game';

// ---------------------------------------------------------------------------
// Event type map — each key maps to its typed payload
// ---------------------------------------------------------------------------

export interface EventMap {
  barrier_detected: BarrierEventPayload;
  emotion_changed: EmotionChangedPayload;
  profile_updated: ProfileUpdatedPayload;
  companion_action: CompanionActionPayload;
  adaptation_applied: AdaptationAppliedPayload;
  game_generated: GameGeneratedPayload;
}

export type EventType = keyof EventMap;

// ---------------------------------------------------------------------------
// Typed payloads
// ---------------------------------------------------------------------------

export interface BarrierEventPayload {
  sessionId: string;
  playerId: string;
  barrier: BarrierEvent;
}

export interface EmotionChangedPayload {
  sessionId: string;
  playerId: string;
  state: EmotionState;
}

export interface ProfileUpdatedPayload {
  playerId: string;
  profile: AccessibilityProfile;
}

export interface CompanionActionPayload {
  sessionId: string;
  playerId: string;
  action: GameAction;
  performedBy: 'player' | 'companion';
}

export interface AdaptationAppliedPayload {
  sessionId: string;
  playerId: string;
  barrier: BarrierEvent;
  adaptation: AdaptationAction;
  accepted: boolean;
}

export interface GameGeneratedPayload {
  sessionId: string;
  playerId: string;
  gameSpec: GameSpec;
}

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

export type EventHandler<T extends EventType> = (
  payload: EventMap[T],
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

export class EventBus {
  private handlers: Map<EventType, Set<EventHandler<any>>> = new Map();

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  on<T extends EventType>(type: T, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);

    return () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  /**
   * Subscribe to a specific event type for a single invocation.
   */
  once<T extends EventType>(type: T, handler: EventHandler<T>): () => void {
    const wrapper: EventHandler<T> = (payload) => {
      unsubscribe();
      return handler(payload);
    };
    const unsubscribe = this.on(type, wrapper);
    return unsubscribe;
  }

  /**
   * Emit an event. All registered handlers are invoked. Async handlers
   * are awaited in parallel; errors in individual handlers are caught and
   * logged so they don't prevent other handlers from running.
   */
  async emit<T extends EventType>(type: T, payload: EventMap[T]): Promise<void> {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;

    const promises: Promise<void>[] = [];
    for (const handler of set) {
      try {
        const result = handler(payload);
        if (result && typeof (result as Promise<void>).then === 'function') {
          promises.push(
            (result as Promise<void>).catch((err) => {
              console.error(`[EventBus] async handler error for "${type}":`, err);
            }),
          );
        }
      } catch (err) {
        console.error(`[EventBus] sync handler error for "${type}":`, err);
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Remove all handlers for a specific event type, or all handlers if no
   * type is provided.
   */
  off<T extends EventType>(type?: T): void {
    if (type) {
      this.handlers.delete(type);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Get the number of handlers registered for a specific event type.
   */
  listenerCount(type: EventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}
