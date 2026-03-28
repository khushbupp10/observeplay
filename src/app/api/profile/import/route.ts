import { NextRequest, NextResponse } from 'next/server';
import { createProfileLearner } from '../../_lib/services';
import { badRequest, withErrorHandling } from '../../_lib/errors';
import type { AccessibilityProfileExport } from '@/types/player';

/**
 * POST /api/profile/import
 *
 * Import an accessibility profile from a previously exported portable
 * format. Verifies checksum integrity before applying.
 *
 * Requirements: 7.7
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { playerId, profileData } = body as {
      playerId?: string;
      profileData?: AccessibilityProfileExport;
    };

    if (!playerId || typeof playerId !== 'string') {
      return badRequest('playerId is required and must be a string');
    }
    if (!profileData || typeof profileData !== 'object') {
      return badRequest('profileData is required and must be an AccessibilityProfileExport object');
    }

    const learner = createProfileLearner();
    const profile = await learner.importProfileForPlayer(playerId, profileData);

    return NextResponse.json(profile);
  });
}
