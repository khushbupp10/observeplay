import { NextRequest, NextResponse } from 'next/server';
import { createResearchAnalyzer } from '../../_lib/services';
import { badRequest, withErrorHandling } from '../../_lib/errors';

/**
 * POST /api/research/gaps
 *
 * Perform a gap analysis on a research topic to identify under-researched
 * areas and suggest potential research directions.
 *
 * Requirements: 5.4
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { topic } = body as { topic?: string };

    if (!topic || typeof topic !== 'string') {
      return badRequest('topic is required and must be a string');
    }

    const analyzer = createResearchAnalyzer();
    const gaps = analyzer.analyzeGaps(topic);

    return NextResponse.json(gaps);
  });
}
