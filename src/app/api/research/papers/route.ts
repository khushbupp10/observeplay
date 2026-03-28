import { NextRequest, NextResponse } from 'next/server';
import { createResearchAnalyzer } from '../../_lib/services';
import { badRequest, withErrorHandling } from '../../_lib/errors';

/**
 * POST /api/research/papers
 *
 * Upload and ingest a research paper (PDF or HTML).
 *
 * Requirements: 5.1, 5.2
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const contentType = request.headers.get('content-type') ?? '';

    let fileBuffer: Buffer;
    let format: 'pdf' | 'html';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      format = (formData.get('format') as string) as 'pdf' | 'html';

      if (!file) {
        return badRequest('file is required');
      }
      if (format !== 'pdf' && format !== 'html') {
        return badRequest('format must be "pdf" or "html"');
      }

      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
    } else {
      const body = await request.json();
      const { content, format: fmt } = body as {
        content?: string;
        format?: string;
      };

      if (!content || typeof content !== 'string') {
        return badRequest('content is required (base64-encoded file data)');
      }
      if (fmt !== 'pdf' && fmt !== 'html') {
        return badRequest('format must be "pdf" or "html"');
      }

      fileBuffer = Buffer.from(content, 'base64');
      format = fmt;
    }

    const analyzer = createResearchAnalyzer();
    const result = await analyzer.ingestPaper(fileBuffer, format);

    return NextResponse.json(result, { status: result.isDuplicate ? 409 : 201 });
  });
}
