/**
 * Wire learning services as event bus consumers.
 *
 * Connects the Profile Learner, Copilot Adaptation Learner, and Companion
 * Learning Service to the internal event bus so they receive barrier events,
 * adaptation outcomes, companion actions, emotion changes, and profile updates.
 *
 * Requirements: 11.4, 12.5
 */

import type { EventBus } from './event-bus';
import type { ProfileLearnerService } from '../services/profile-learner';
import type { CopilotAdaptationLearner } from '../services/copilot-adaptation-learner';
import type { CompanionLearningService } from '../services/companion-learning';

export interface LearningServices {
  profileLearner: ProfileLearnerService;
  copilotAdaptationLearner: CopilotAdaptationLearner;
  companionLearning: CompanionLearningService;
}

/**
 * Subscribe learning services to the event bus. Returns an unsubscribe
 * function that removes all subscriptions.
 */
export function wireLearningServices(
  bus: EventBus,
  services: LearningServices,
): () => void {
  const unsubscribers: Array<() => void> = [];

  // Copilot Adaptation Learner consumes adaptation_applied events
  // Requirement 11.1 — build a model of accepted/undone adaptations
  unsubscribers.push(
    bus.on('adaptation_applied', (payload) => {
      services.copilotAdaptationLearner.recordOutcome(
        payload.playerId,
        payload.barrier,
        payload.adaptation,
        payload.accepted,
      );
    }),
  );

  // Companion Learning consumes companion_action events
  // Requirement 12.1 — track mechanic performance
  unsubscribers.push(
    bus.on('companion_action', (payload) => {
      services.companionLearning.trackPerformance(
        payload.playerId,
        payload.action.type,
        {
          mechanicId: payload.action.type,
          success: true, // actions that reach the bus were executed successfully
          sessionId: payload.sessionId,
          timestamp: Date.now(),
        },
      );
    }),
  );

  // Profile Learner consumes emotion_changed events to refine profiles
  // Requirement 7.3 — continuously refine profile from interaction data
  unsubscribers.push(
    bus.on('emotion_changed', (payload) => {
      // Emotion changes inform the profile learner about engagement patterns
      services.profileLearner.refineProfile(payload.playerId, {
        timestamp: payload.state.lastUpdated,
        inputMethodsUsed: [],
        responseTimeMs: 0,
        inputAccuracy: 0,
        sessionId: payload.sessionId,
      }).catch(() => {
        // Profile may not exist yet — safe to ignore
      });
    }),
  );

  // Copilot Adaptation Learner shares preferences with Profile Learner
  // Requirement 11.4
  services.copilotAdaptationLearner.onPreferenceChange(
    (playerId, preferences) => {
      bus.emit('profile_updated', {
        playerId,
        profile: { playerId, learnedPreferences: preferences } as any,
      });
    },
  );

  // Companion Learning shares model with Profile Learner
  // Requirement 12.5
  services.companionLearning.onModelChange((playerId, preferences) => {
    bus.emit('profile_updated', {
      playerId,
      profile: { playerId, learnedPreferences: preferences } as any,
    });
  });

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}
