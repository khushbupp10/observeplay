import { NextRequest, NextResponse } from 'next/server';
import { createGameGenerator } from '../../_lib/services';
import { badRequest, withErrorHandling } from '../../_lib/errors';
import type { AccessibilityProfile } from '@/types/player';
import type { Genre } from '@/types/common';

/**
 * POST /api/games/generate
 *
 * Generate a new game from a natural language description and player profile.
 *
 * Requirements: 1.1, 1.4
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();

    const { playerDescription, profile, preferredGenre, sessionId } = body as {
      playerDescription?: string;
      profile?: AccessibilityProfile;
      preferredGenre?: Genre;
      sessionId?: string;
    };

    if (!playerDescription || typeof playerDescription !== 'string') {
      return badRequest('playerDescription is required and must be a string');
    }
    if (!profile || typeof profile !== 'object') {
      return badRequest('profile is required and must be an object');
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return badRequest('sessionId is required and must be a string');
    }

    const generator = createGameGenerator();
    const result = await generator.generateGame({
      playerDescription,
      profile,
      preferredGenre,
      sessionId,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  });
}
