/**
 * Application Context — Singleton that wires all services together.
 *
 * Creates a shared EventBus, instantiates every service, connects the
 * WebSocketHub, and wires learning services as event bus consumers.
 * Route handlers access services through `getAppContext()` instead of
 * creating per-request instances.
 *
 * Requirements: 1.1, 2.1, 3.2, 4.1, 6.1, 8.1, 11.4, 12.5
 */

import { EventBus } from '@/events/event-bus';
import { WebSocketHub } from '@/api/websocket-hub';
import { wireLearningServices } from '@/events/wire-learning-services';

import { GameGeneratorService } from '@/services/game-generator';
import { AccessibilityCopilotService } from '@/services/accessibility-copilot';
import { EmotionEngine } from '@/services/emotion-engine';
import { NLControllerService } from '@/services/nl-controller';
import { AudioNarratorService } from '@/services/audio-narrator';
import { AICompanionService } from '@/services/ai-companion';
import { ProfileLearnerService } from '@/services/profile-learner';
import { ResearchAnalyzerService } from '@/services/research-analyzer';
import { ConsentManagerService } from '@/services/consent-manager';
import { CopilotAdaptationLearner } from '@/services/copilot-adaptation-learner';
import { CompanionLearningService } from '@/services/companion-learning';

import { PlayerRepository } from '@/db/repositories/player-repository';
import { GameRepository } from '@/db/repositories/game-repository';
import { EmotionRepository } from '@/db/repositories/emotion-repository';
import { BarrierRepository } from '@/db/repositories/barrier-repository';
import { CompanionRepository } from '@/db/repositories/companion-repository';

// ---------------------------------------------------------------------------
// AppContext interface
// ---------------------------------------------------------------------------

export interface AppContext {
  eventBus: EventBus;
  webSocketHub: WebSocketHub;

  // Core services
  gameGenerator: GameGeneratorService;
  accessibilityCopilot: AccessibilityCopilotService;
  emotionEngine: EmotionEngine;
  nlController: NLControllerService;
  audioNarrator: AudioNarratorService;
  aiCompanion: AICompanionService;
  profileLearner: ProfileLearnerService;
  researchAnalyzer: ResearchAnalyzerService;
  consentManager: ConsentManagerService;

  // Learning services
  copilotAdaptationLearner: CopilotAdaptationLearner;
  companionLearning: CompanionLearningService;

  /** Tear down all subscriptions and connections. */
  destroy: () => void;
}

// ---------------------------------------------------------------------------
// Factory — builds a fresh context (useful for testing)
// ---------------------------------------------------------------------------

export function createAppContext(): AppContext {
  // 1. Event bus
  const eventBus = new EventBus();

  // 2. Repositories (shared across services that need them)
  const playerRepo = new PlayerRepository();
  const gameRepo = new GameRepository();
  const emotionRepo = new EmotionRepository();
  const barrierRepo = new BarrierRepository();
  const companionRepo = new CompanionRepository();

  // 3. Core services
  const gameGenerator = new GameGeneratorService();
  const accessibilityCopilot = new AccessibilityCopilotService();
  const emotionEngine = new EmotionEngine();
  const nlController = new NLControllerService();
  const audioNarrator = new AudioNarratorService();
  const aiCompanion = new AICompanionService();
  const profileLearner = new ProfileLearnerService({ playerRepo });
  const researchAnalyzer = new ResearchAnalyzerService();
  const consentManager = new ConsentManagerService({
    playerRepo,
    gameRepo,
    emotionRepo,
    barrierRepo,
    companionRepo,
  });

  // 4. Learning services
  const copilotAdaptationLearner = new CopilotAdaptationLearner();
  const companionLearning = new CompanionLearningService();

  // 5. WebSocket hub — forwards event bus events to connected clients
  const webSocketHub = new WebSocketHub(eventBus);

  // 6. Wire learning services to the event bus
  const unwireLearning = wireLearningServices(eventBus, {
    profileLearner,
    copilotAdaptationLearner,
    companionLearning,
  });

  // 7. Destroy function
  function destroy(): void {
    unwireLearning();
    webSocketHub.destroy();
    eventBus.off();
  }

  return {
    eventBus,
    webSocketHub,
    gameGenerator,
    accessibilityCopilot,
    emotionEngine,
    nlController,
    audioNarrator,
    aiCompanion,
    profileLearner,
    researchAnalyzer,
    consentManager,
    copilotAdaptationLearner,
    companionLearning,
    destroy,
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AppContext | null = null;

/**
 * Get the shared application context. Creates it on first call.
 * Route handlers should use this instead of creating services per-request.
 */
export function getAppContext(): AppContext {
  if (!instance) {
    instance = createAppContext();
  }
  return instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetAppContext(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
