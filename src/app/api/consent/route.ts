import { NextRequest, NextResponse } from 'next/server';
import { createConsentManager } from '../_lib/services';
import { badRequest, withErrorHandling } from '../_lib/errors';
import type { ConsentCategory } from '@/types/common';

const VALID_CATEGORIES: ConsentCategory[] = [
  'webcam',
  'interaction_patterns',
  'profile_learning',
  'voice_input',
];

/**
 * GET /api/consent
 *
 * Retrieve the consent form definition or the current consent state for a
 * player (when playerId query param is provided).
 *
 * Requirements: 9.1, 9.3
 */
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');

    const manager = createConsentManager();

    if (playerId) {
      const state = manager.getConsentState(playerId);
      return NextResponse.json(state);
    }

    const form = manager.getConsentForm();
    return NextResponse.json(form);
  });
}

/**
 * PUT /api/consent
 *
 * Update consent for a specific data-collection category.
 *
 * Requirements: 9.1, 9.3
 */
export async function PUT(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { playerId, category, granted } = body as {
      playerId?: string;
      category?: ConsentCategory;
      granted?: boolean;
    };

    if (!playerId || typeof playerId !== 'string') {
      return badRequest('playerId is required and must be a string');
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return badRequest(
        `category is required and must be one of: ${VALID_CATEGORIES.join(', ')}`,
      );
    }
    if (typeof granted !== 'boolean') {
      return badRequest('granted is required and must be a boolean');
    }

    const manager = createConsentManager();
    await manager.updateConsent(playerId, category, granted);

    const updated = manager.getConsentState(playerId);
    return NextResponse.json(updated);
  });
}
