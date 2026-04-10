import type { AccessibilityProfile } from '../types/player';
import type {
  GameGenerationRequest,
  GameGenerationResult,
} from './game-generator';

/**
 * Calls the Next.js API routes so generation runs server-side alongside
 * {@link createGameGenerator} in route handlers.
 */
export const apiGameGenerator = {
  async generateGame(request: GameGenerationRequest): Promise<GameGenerationResult> {
    const res = await fetch('/api/games/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const data = (await res.json()) as GameGenerationResult;
    if (!res.ok && !('success' in data)) {
      throw new Error('Game generation request failed');
    }
    return data;
  },

  async modifyGame(
    gameId: string,
    modifications: string,
    profile: AccessibilityProfile,
  ): Promise<GameGenerationResult> {
    const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/modify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modifications, profile }),
    });
    const data = (await res.json()) as GameGenerationResult;
    if (!res.ok && !('success' in data)) {
      throw new Error('Game modification request failed');
    }
    return data;
  },
};
