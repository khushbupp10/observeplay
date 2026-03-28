import { NextRequest, NextResponse } from 'next/server';
import { createGameGenerator } from '../../../_lib/services';
import { badRequest, withErrorHandling } from '../../../_lib/errors';
import type { AccessibilityProfile } from '@/types/player';

/**
 * PUT /api/games/:id/modify
 *
 * Modify an existing generated game based on player feedback.
 *
 * Requirements: 1.4
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const { id: gameId } = await params;

    const body = await request.json();
    const { modifications, profile } = body as {
      modifications?: string;
      profile?: AccessibilityProfile;
    };

    if (!modifications || typeof modifications !== 'string') {
      return badRequest('modifications is required and must be a string');
    }
    if (!profile || typeof profile !== 'object') {
      return badRequest('profile is required and must be an object');
    }

    const generator = createGameGenerator();
    const result = await generator.modifyGame(gameId, modifications, profile);

    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  });
}
