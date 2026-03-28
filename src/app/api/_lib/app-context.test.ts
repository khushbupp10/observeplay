import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppContext, getAppContext, resetAppContext } from './app-context';
import type { AppContext } from './app-context';

describe('AppContext', () => {
  let ctx: AppContext;

  beforeEach(() => {
    resetAppContext();
  });

  afterEach(() => {
    if (ctx) ctx.destroy();
    resetAppContext();
  });

  // ── Service instantiation ───────────────────────────────────────

  it('creates all core services', () => {
    ctx = createAppContext();

    expect(ctx.eventBus).toBeDefined();
    expect(ctx.webSocketHub).toBeDefined();
    expect(ctx.gameGenerator).toBeDefined();
    expect(ctx.accessibilityCopilot).toBeDefined();
    expect(ctx.emotionEngine).toBeDefined();
    expect(ctx.nlController).toBeDefined();
    expect(ctx.audioNarrator).toBeDefined();
    expect(ctx.aiCompanion).toBeDefined();
    expect(ctx.profileLearner).toBeDefined();
    expect(ctx.researchAnalyzer).toBeDefined();
    expect(ctx.consentManager).toBeDefined();
    expect(ctx.copilotAdaptationLearner).toBeDefined();
    expect(ctx.companionLearning).toBeDefined();
  });

  // ── Singleton behaviour ─────────────────────────────────────────

  it('getAppContext returns the same instance on repeated calls', () => {
    const a = getAppContext();
    const b = getAppContext();
    expect(a).toBe(b);
    ctx = a; // for cleanup
  });

  it('resetAppContext clears the singleton', () => {
    const a = getAppContext();
    resetAppContext();
    const b = getAppContext();
    expect(a).not.toBe(b);
    ctx = b;
  });

  // ── Event bus wiring ────────────────────────────────────────────

  it('learning services are wired to the event bus', () => {
    ctx = createAppContext();

    // wireLearningServices subscribes to: adaptation_applied,
    // companion_action, emotion_changed — so listener counts should be > 0
    expect(ctx.eventBus.listenerCount('adaptation_applied')).toBeGreaterThan(0);
    expect(ctx.eventBus.listenerCount('companion_action')).toBeGreaterThan(0);
    expect(ctx.eventBus.listenerCount('emotion_changed')).toBeGreaterThan(0);
  });

  it('WebSocketHub subscribes to event bus events', () => {
    ctx = createAppContext();

    // WebSocketHub subscribes to: barrier_detected, emotion_changed,
    // companion_action, adaptation_applied, game_generated, profile_updated
    expect(ctx.eventBus.listenerCount('barrier_detected')).toBeGreaterThan(0);
    expect(ctx.eventBus.listenerCount('game_generated')).toBeGreaterThan(0);
    expect(ctx.eventBus.listenerCount('profile_updated')).toBeGreaterThan(0);
  });

  it('events flow from event bus through to learning services', async () => {
    ctx = createAppContext();

    // Emit an adaptation_applied event — the CopilotAdaptationLearner
    // should receive it via its wired handler (recordOutcome).
    // We verify indirectly: after emitting, the learner should have data
    // for the player.
    await ctx.eventBus.emit('adaptation_applied', {
      sessionId: 'sess-1',
      playerId: 'player-1',
      barrier: {
        id: 'b-1',
        sessionId: 'sess-1',
        playerId: 'player-1',
        timestamp: Date.now(),
        type: 'small_text',
        severity: 'medium',
        detectedElement: {
          elementId: 'el-1',
          type: 'text',
          position: { x: 0, y: 0, width: 100, height: 10 },
        },
        detectedValue: 10,
        thresholdValue: 16,
        adaptationUndone: false,
      },
      adaptation: {
        id: 'a-1',
        type: 'enlarge_text',
        targetElement: {
          elementId: 'el-1',
          type: 'text',
          position: { x: 0, y: 0, width: 100, height: 16 },
        },
        parameters: { newSize: 16, originalSize: 10 },
        isProactive: false,
        undoable: true,
      },
      accepted: true,
    });

    // The learner should now report that it has seen this adaptation
    const decision = ctx.copilotAdaptationLearner.shouldApplyProactively(
      'player-1',
      'small_text',
      'enlarge_text',
    );
    expect(decision.sessionsObserved).toBeGreaterThanOrEqual(1);
  });

  // ── Destroy cleans up ───────────────────────────────────────────

  it('destroy removes all event bus listeners', () => {
    ctx = createAppContext();
    ctx.destroy();

    // After destroy, all listeners should be gone
    expect(ctx.eventBus.listenerCount('adaptation_applied')).toBe(0);
    expect(ctx.eventBus.listenerCount('barrier_detected')).toBe(0);
    expect(ctx.eventBus.listenerCount('emotion_changed')).toBe(0);
    expect(ctx.eventBus.listenerCount('companion_action')).toBe(0);
    expect(ctx.eventBus.listenerCount('game_generated')).toBe(0);
    expect(ctx.eventBus.listenerCount('profile_updated')).toBe(0);
  });
});
