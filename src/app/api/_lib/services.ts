/**
 * Per-request service factory.
 *
 * Each route handler instantiates the services it needs through these
 * helpers so that no long-lived singletons leak across requests.
 */

import { PlayerRepository } from '@/db/repositories/player-repository';
import { GameRepository } from '@/db/repositories/game-repository';
import { EmotionRepository } from '@/db/repositories/emotion-repository';
import { BarrierRepository } from '@/db/repositories/barrier-repository';
import { CompanionRepository } from '@/db/repositories/companion-repository';

import { GameGeneratorService } from '@/services/game-generator';
import { ResearchAnalyzerService } from '@/services/research-analyzer';
import { ConsentManagerService } from '@/services/consent-manager';
import { ProfileLearnerService } from '@/services/profile-learner';

export function createGameGenerator() {
  return new GameGeneratorService();
}

export function createResearchAnalyzer() {
  return new ResearchAnalyzerService();
}

export function createConsentManager() {
  return new ConsentManagerService({
    playerRepo: new PlayerRepository(),
    gameRepo: new GameRepository(),
    emotionRepo: new EmotionRepository(),
    barrierRepo: new BarrierRepository(),
    companionRepo: new CompanionRepository(),
  });
}

export function createProfileLearner() {
  return new ProfileLearnerService({
    playerRepo: new PlayerRepository(),
  });
}
