import { NextRequest, NextResponse } from 'next/server';
import { createConsentManager } from '../_lib/services';
import { badRequest, withErrorHandling } from '../_lib/errors';

/**
 * GET /api/data-dashboard
 *
 * Retrieve the data dashboard showing what data has been collected,
 * how it is used, and when it was last accessed.
 *
 * Requirements: 9.4
 */
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');

    if (!playerId) {
      return badRequest('playerId query parameter is required');
    }

    const manager = createConsentManager();
    const dashboard = await manager.getDataDashboard(playerId);

    return NextResponse.json(dashboard);
  });
}
