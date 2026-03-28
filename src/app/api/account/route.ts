import { NextRequest, NextResponse } from 'next/server';
import { createConsentManager } from '../_lib/services';
import { badRequest, withErrorHandling } from '../_lib/errors';

/**
 * DELETE /api/account
 *
 * Delete a player account and all associated personal data.
 * All data must be removed within 48 hours.
 *
 * Requirements: 9.8
 */
export async function DELETE(request: NextRequest) {
  return withErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');

    if (!playerId) {
      return badRequest('playerId query parameter is required');
    }

    const manager = createConsentManager();
    const result = await manager.deletePlayerData(playerId);

    return NextResponse.json(result);
  });
}
