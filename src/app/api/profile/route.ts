import { NextRequest, NextResponse } from 'next/server';
import { createProfileLearner } from '../_lib/services';
import { badRequest, notFound, withErrorHandling } from '../_lib/errors';
import type { InteractionData, ProfileChange } from '@/services/profile-learner';

/**
 * GET /api/profile
 *
 * Retrieve a player's accessibility profile.
 *
 * Requirements: 7.5, 7.6
 */
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');

    if (!playerId) {
      return badRequest('playerId query parameter is required');
    }

    const learner = createProfileLearner();
    const profile = await learner.exportProfile(playerId);

    return NextResponse.json(profile);
  });
}

/**
 * PUT /api/profile
 *
 * Update a player's accessibility profile by submitting new interaction
 * data for refinement, or by applying/rejecting proposed changes.
 *
 * Requirements: 7.5, 7.6
 */
export async function PUT(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { playerId, action } = body as {
      playerId?: string;
      action?: string;
    };

    if (!playerId || typeof playerId !== 'string') {
      return badRequest('playerId is required and must be a string');
    }

    const learner = createProfileLearner();

    if (action === 'refine') {
      const { interactionData } = body as { interactionData?: InteractionData };
      if (!interactionData || typeof interactionData !== 'object') {
        return badRequest('interactionData is required for refine action');
      }
      const update = await learner.refineProfile(playerId, interactionData);
      return NextResponse.json(update);
    }

    if (action === 'apply-changes') {
      const { changes, accepted } = body as {
        changes?: ProfileChange[];
        accepted?: boolean;
      };
      if (!Array.isArray(changes)) {
        return badRequest('changes array is required for apply-changes action');
      }
      if (typeof accepted !== 'boolean') {
        return badRequest('accepted boolean is required for apply-changes action');
      }
      if (accepted) {
        await learner.applyProfileChanges(playerId, changes);
      }
      return NextResponse.json({ applied: accepted, changeCount: changes.length });
    }

    if (action === 'override') {
      const { attribute, value } = body as {
        attribute?: string;
        value?: unknown;
      };
      if (!attribute || typeof attribute !== 'string') {
        return badRequest('attribute is required for override action');
      }
      if (value === undefined) {
        return badRequest('value is required for override action');
      }
      await learner.setManualOverride(playerId, attribute, value);
      return NextResponse.json({ overridden: attribute });
    }

    return badRequest('action must be one of: "refine", "apply-changes", "override"');
  });
}
