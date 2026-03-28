import { NextRequest, NextResponse } from 'next/server';
import { createResearchAnalyzer } from '../../_lib/services';
import { badRequest, withErrorHandling } from '../../_lib/errors';

/**
 * POST /api/research/query
 *
 * Ask a natural language research question and get a synthesized answer
 * with citations.
 *
 * Requirements: 5.2
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { question } = body as { question?: string };

    if (!question || typeof question !== 'string') {
      return badRequest('question is required and must be a string');
    }

    const analyzer = createResearchAnalyzer();
    const answer = analyzer.answerQuestion(question);

    return NextResponse.json(answer);
  });
}
