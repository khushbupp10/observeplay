import { NextRequest, NextResponse } from 'next/server';
import { createConsentManager } from '../_lib/services';
import { badRequest, withErrorHandling } from '../_lib/errors';

/**
 * POST /api/data-export
 *
 * Export all personal data for a player in machine-readable JSON format.
 *
 * Requirements: 9.6
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { playerId } = body as { playerId?: string };

    if (!playerId || typeof playerId !== 'string') {
      return badRequest('playerId is required and must be a string');
    }

    const manager = createConsentManager();
    const exportData = await manager.exportPlayerData(playerId);

    return NextResponse.json(exportData);
  });
}
