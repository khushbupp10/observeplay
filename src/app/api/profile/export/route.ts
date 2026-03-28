import { NextRequest, NextResponse } from 'next/server';
import { createProfileLearner } from '../../_lib/services';
import { badRequest, withErrorHandling } from '../../_lib/errors';

/**
 * POST /api/profile/export
 *
 * Export a player's accessibility profile in a portable format with
 * checksum for integrity verification.
 *
 * Requirements: 7.7
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { playerId } = body as { playerId?: string };

    if (!playerId || typeof playerId !== 'string') {
      return badRequest('playerId is required and must be a string');
    }

    const learner = createProfileLearner();
    const exported = await learner.exportProfile(playerId);

    return NextResponse.json(exported);
  });
}
