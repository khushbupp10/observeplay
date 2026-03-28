import { NextRequest, NextResponse } from 'next/server';
import { createResearchAnalyzer } from '../../../_lib/services';
import { badRequest, notFound, withErrorHandling } from '../../../_lib/errors';

/**
 * GET /api/research/citations/:id
 *
 * Export a citation for a paper in the requested format (apa, mla, bibtex).
 *
 * Requirements: 5.6
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const { id: paperId } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') as 'apa' | 'mla' | 'bibtex' | null;

    if (!format || !['apa', 'mla', 'bibtex'].includes(format)) {
      return badRequest('format query parameter is required and must be "apa", "mla", or "bibtex"');
    }

    const analyzer = createResearchAnalyzer();

    const paper = analyzer.getPaper(paperId);
    if (!paper) {
      return notFound(`Paper with id "${paperId}" not found`);
    }

    const citation = analyzer.exportCitation(paperId, format);

    return NextResponse.json({ paperId, format, citation });
  });
}
