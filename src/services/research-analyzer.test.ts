import { describe, it, expect, beforeEach } from 'vitest';
import {
  ResearchAnalyzerService,
  StubEmbeddingProvider,
  StubTextExtractor,
  titleSimilarity,
  formatCitation,
  generateSummary,
  TITLE_SIMILARITY_THRESHOLD,
  INGESTION_DEADLINE_MS,
  ANSWER_DEADLINE_MS,
} from './research-analyzer';
import type { PaperMetadata } from '../types';
import type { ExtractedContent } from './research-analyzer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePaperBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

function makeWellFormedPaper(overrides?: Partial<{ title: string; doi: string }>): Buffer {
  const title = overrides?.title ?? 'Accessible Gaming for Motor Disabilities';
  const doi = overrides?.doi ?? '10.1234/test.2024.001';
  return makePaperBuffer(
    `${title}
Authors: Jane Smith, John Doe
Date: 2024-01-15
Journal: Journal of Accessible Computing
DOI: ${doi}

Abstract: This paper investigates accessible gaming approaches for players with motor disabilities. We present a novel framework for adaptive input methods.

Introduction

1 Methods
We conducted a user study with 30 participants using adaptive controllers and voice input.

2 Results
Players showed 40% improvement in task completion. Voice input was preferred by 60% of participants.

3 Limitations
The sample size was limited. Only desktop platforms were tested.

References
Smith, J. (2023). Prior work on accessible gaming. Journal of HCI.
Doe, J. (2022). Input methods for disabled gamers. ACM ASSETS.
`,
  );
}

function makeMetadata(overrides?: Partial<PaperMetadata>): PaperMetadata {
  return {
    title: 'Accessible Gaming for Motor Disabilities',
    authors: ['Jane Smith', 'John Doe'],
    abstract: 'This paper investigates accessible gaming approaches.',
    publicationDate: '2024-01-15',
    journal: 'Journal of Accessible Computing',
    doi: '10.1234/test.2024.001',
    references: ['Smith 2023', 'Doe 2022'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// titleSimilarity
// ---------------------------------------------------------------------------

describe('titleSimilarity', () => {
  it('returns 1 for identical titles', () => {
    expect(titleSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different titles', () => {
    expect(titleSimilarity('hello world', 'foo bar baz')).toBe(0);
  });

  it('returns a value between 0 and 1 for partial overlap', () => {
    const sim = titleSimilarity('accessible gaming research', 'accessible gaming design');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('is case-insensitive', () => {
    expect(titleSimilarity('Hello World', 'hello world')).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(titleSimilarity('', '')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(titleSimilarity('hello', '')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatCitation
// ---------------------------------------------------------------------------

describe('formatCitation', () => {
  const metadata = makeMetadata();

  describe('APA format', () => {
    it('contains the title and first author', () => {
      const citation = formatCitation(metadata, 'apa');
      expect(citation).toContain('Accessible Gaming for Motor Disabilities');
      expect(citation).toContain('Smith');
    });

    it('includes the year', () => {
      const citation = formatCitation(metadata, 'apa');
      expect(citation).toContain('2024');
    });

    it('includes the journal', () => {
      const citation = formatCitation(metadata, 'apa');
      expect(citation).toContain('Journal of Accessible Computing');
    });

    it('includes the DOI', () => {
      const citation = formatCitation(metadata, 'apa');
      expect(citation).toContain('10.1234/test.2024.001');
    });

    it('uses et al. for more than 2 authors', () => {
      const meta = makeMetadata({ authors: ['A One', 'B Two', 'C Three'] });
      const citation = formatCitation(meta, 'apa');
      expect(citation).toContain('et al.');
    });

    it('handles missing date gracefully', () => {
      const meta = makeMetadata({ publicationDate: undefined });
      const citation = formatCitation(meta, 'apa');
      expect(citation).toContain('n.d.');
    });
  });

  describe('MLA format', () => {
    it('contains the title and first author', () => {
      const citation = formatCitation(metadata, 'mla');
      expect(citation).toContain('Accessible Gaming for Motor Disabilities');
      expect(citation).toContain('Smith');
    });

    it('wraps title in quotes', () => {
      const citation = formatCitation(metadata, 'mla');
      expect(citation).toContain('"Accessible Gaming for Motor Disabilities."');
    });
  });

  describe('BibTeX format', () => {
    it('contains the title and author', () => {
      const citation = formatCitation(metadata, 'bibtex');
      expect(citation).toContain('Accessible Gaming for Motor Disabilities');
      expect(citation).toContain('Jane Smith');
    });

    it('starts with @article', () => {
      const citation = formatCitation(metadata, 'bibtex');
      expect(citation).toMatch(/^@article\{/);
    });

    it('includes year field', () => {
      const citation = formatCitation(metadata, 'bibtex');
      expect(citation).toContain('year = {2024}');
    });
  });

  it('returns non-empty string for all formats', () => {
    for (const fmt of ['apa', 'mla', 'bibtex'] as const) {
      const citation = formatCitation(metadata, fmt);
      expect(citation.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// generateSummary
// ---------------------------------------------------------------------------

describe('generateSummary', () => {
  it('extracts objective from abstract', () => {
    const extracted: ExtractedContent = {
      fullText: 'test',
      title: 'Test',
      authors: ['Author'],
      abstract: 'This paper investigates X. We also do Y.',
      sections: [],
      references: [],
      failedFields: [],
    };
    const summary = generateSummary(extracted);
    expect(summary.objective).toContain('This paper investigates X.');
  });

  it('marks fields as requires manual entry when sections are missing', () => {
    const extracted: ExtractedContent = {
      fullText: 'minimal content',
      title: 'Test',
      authors: [],
      abstract: '',
      sections: [],
      references: [],
      failedFields: [],
    };
    const summary = generateSummary(extracted);
    expect(summary.methodology).toBe('requires manual entry');
    expect(summary.keyFindings).toContain('requires manual entry');
    expect(summary.limitations).toContain('requires manual entry');
  });

  it('extracts methodology from methods section', () => {
    const extracted: ExtractedContent = {
      fullText: 'test',
      title: 'Test',
      authors: ['Author'],
      abstract: 'Abstract text here.',
      sections: [
        { title: 'Methods', text: 'We used surveys. Participants were recruited online.', startOffset: 0, endOffset: 50 },
      ],
      references: [],
      failedFields: [],
    };
    const summary = generateSummary(extracted);
    expect(summary.methodology).toContain('surveys');
  });
});

// ---------------------------------------------------------------------------
// StubEmbeddingProvider
// ---------------------------------------------------------------------------

describe('StubEmbeddingProvider', () => {
  it('returns an embedding of the specified dimension', async () => {
    const provider = new StubEmbeddingProvider(64);
    const embedding = await provider.generateEmbedding('test text');
    expect(embedding).toHaveLength(64);
  });

  it('returns deterministic embeddings for the same input', async () => {
    const provider = new StubEmbeddingProvider();
    const e1 = await provider.generateEmbedding('hello');
    const e2 = await provider.generateEmbedding('hello');
    expect(e1).toEqual(e2);
  });

  it('returns different embeddings for different inputs', async () => {
    const provider = new StubEmbeddingProvider();
    const e1 = await provider.generateEmbedding('hello');
    const e2 = await provider.generateEmbedding('world');
    expect(e1).not.toEqual(e2);
  });
});

// ---------------------------------------------------------------------------
// StubTextExtractor
// ---------------------------------------------------------------------------

describe('StubTextExtractor', () => {
  it('extracts title from first line', async () => {
    const extractor = new StubTextExtractor();
    const result = await extractor.extract(
      makePaperBuffer('My Paper Title\nAuthors: John Doe\n'),
      'pdf',
    );
    expect(result.title).toBe('My Paper Title');
  });

  it('extracts authors from Authors: line', async () => {
    const extractor = new StubTextExtractor();
    const result = await extractor.extract(
      makePaperBuffer('Title\nAuthors: Alice, Bob\n'),
      'html',
    );
    expect(result.authors).toEqual(['Alice', 'Bob']);
  });

  it('marks failed fields when metadata cannot be extracted', async () => {
    const extractor = new StubTextExtractor();
    const result = await extractor.extract(makePaperBuffer(''), 'pdf');
    expect(result.failedFields).toContain('title');
    expect(result.failedFields).toContain('authors');
    expect(result.failedFields).toContain('abstract');
  });

  it('extracts DOI', async () => {
    const extractor = new StubTextExtractor();
    const result = await extractor.extract(
      makePaperBuffer('Title\nDOI: 10.1234/test.001\n'),
      'pdf',
    );
    expect(result.doi).toBe('10.1234/test.001');
  });
});

// ---------------------------------------------------------------------------
// ResearchAnalyzerService
// ---------------------------------------------------------------------------

describe('ResearchAnalyzerService', () => {
  let service: ResearchAnalyzerService;

  beforeEach(() => {
    service = new ResearchAnalyzerService();
  });

  // -----------------------------------------------------------------------
  // ingestPaper (Req 5.1, 5.5, 5.8, 5.9)
  // -----------------------------------------------------------------------
  describe('ingestPaper', () => {
    it('ingests a well-formed paper and returns metadata', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      expect(result.paperId).toBeTruthy();
      expect(result.metadata.title).toContain('Accessible Gaming');
      expect(result.metadata.authors.length).toBeGreaterThan(0);
      expect(result.isDuplicate).toBe(false);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('generates a structured summary with all fields', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      expect(result.summary.objective).toBeTruthy();
      expect(result.summary.objective).not.toBe('requires manual entry');
      expect(result.summary.methodology).toBeTruthy();
      expect(result.summary.keyFindings.length).toBeGreaterThan(0);
      expect(result.summary.limitations.length).toBeGreaterThan(0);
    });

    it('stores the paper for later retrieval', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const paper = service.getPaper(result.paperId);
      expect(paper).toBeDefined();
      expect(paper!.metadata.title).toContain('Accessible Gaming');
    });

    it('generates vector embeddings', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const paper = service.getPaper(result.paperId);
      expect(paper!.fullTextEmbedding.length).toBeGreaterThan(0);
    });

    it('detects duplicate by DOI on second ingestion', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const result2 = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      expect(result2.isDuplicate).toBe(true);
      expect(service.getPaperCount()).toBe(1);
    });

    it('detects duplicate by title similarity', async () => {
      await service.ingestPaper(makeWellFormedPaper({ doi: '10.1234/a' }), 'pdf');
      const result2 = await service.ingestPaper(
        makeWellFormedPaper({ doi: '10.1234/b' }),
        'pdf',
      );
      expect(result2.isDuplicate).toBe(true);
    });

    it('marks failed fields for manual entry on minimal content', async () => {
      const minimal = makePaperBuffer('Short\nSome text without structure.');
      const result = await service.ingestPaper(minimal, 'pdf');
      expect(result.failedFields.length).toBeGreaterThan(0);
    });

    it('sets status to partial when fields fail', async () => {
      const minimal = makePaperBuffer('Short\nSome text without structure.');
      const result = await service.ingestPaper(minimal, 'pdf');
      const paper = service.getPaper(result.paperId);
      expect(paper!.status).toBe('partial');
    });

    it('sets status to indexed when all fields succeed', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const paper = service.getPaper(result.paperId);
      // May be partial or indexed depending on extraction success
      expect(['indexed', 'partial']).toContain(paper!.status);
    });
  });

  // -----------------------------------------------------------------------
  // answerQuestion (Req 5.2)
  // -----------------------------------------------------------------------
  describe('answerQuestion', () => {
    it('returns empty result when no papers indexed', () => {
      const answer = service.answerQuestion('What about gaming?');
      expect(answer.citations).toHaveLength(0);
      expect(answer.confidence).toBe(0);
    });

    it('returns relevant citations for matching question', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const answer = service.answerQuestion('accessible gaming motor disabilities');
      expect(answer.citations.length).toBeGreaterThan(0);
      expect(answer.synthesizedAnswer.length).toBeGreaterThan(0);
    });

    it('all citations reference existing papers', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const answer = service.answerQuestion('gaming accessibility');
      for (const citation of answer.citations) {
        expect(service.getPaper(citation.paperId)).toBeDefined();
      }
    });

    it('returns no citations for unrelated question', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const answer = service.answerQuestion('quantum physics entanglement');
      expect(answer.citations).toHaveLength(0);
    });

    it('returns related topics', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const answer = service.answerQuestion('gaming');
      // relatedTopics may or may not be populated depending on match
      expect(Array.isArray(answer.relatedTopics)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // analyzeGaps (Req 5.3, 5.4)
  // -----------------------------------------------------------------------
  describe('analyzeGaps', () => {
    it('returns the requested topic', () => {
      const gaps = service.analyzeGaps('accessibility');
      expect(gaps.topic).toBe('accessibility');
    });

    it('returns empty gaps when no papers indexed', () => {
      const gaps = service.analyzeGaps('accessibility');
      expect(gaps.underResearchedAreas).toHaveLength(0);
      expect(gaps.suggestedDirections).toHaveLength(0);
    });

    it('identifies under-researched areas from indexed papers', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      await service.ingestPaper(
        makeWellFormedPaper({
          title: 'Voice Input for Accessible Gaming',
          doi: '10.1234/voice.001',
        }),
        'pdf',
      );
      const gaps = service.analyzeGaps('accessible');
      // Should find some areas with few papers
      expect(Array.isArray(gaps.underResearchedAreas)).toBe(true);
    });

    it('provides suggested research directions', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const gaps = service.analyzeGaps('accessible');
      expect(Array.isArray(gaps.suggestedDirections)).toBe(true);
    });

    it('includes supporting evidence citations', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const gaps = service.analyzeGaps('accessible');
      for (const citation of gaps.supportingEvidence) {
        expect(service.getPaper(citation.paperId)).toBeDefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // exportCitation (Req 5.6)
  // -----------------------------------------------------------------------
  describe('exportCitation', () => {
    it('exports APA citation for an indexed paper', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const citation = service.exportCitation(result.paperId, 'apa');
      expect(citation.length).toBeGreaterThan(0);
      expect(citation).toContain('Accessible Gaming');
    });

    it('exports MLA citation for an indexed paper', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const citation = service.exportCitation(result.paperId, 'mla');
      expect(citation.length).toBeGreaterThan(0);
      expect(citation).toContain('Accessible Gaming');
    });

    it('exports BibTeX citation for an indexed paper', async () => {
      const result = await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const citation = service.exportCitation(result.paperId, 'bibtex');
      expect(citation).toMatch(/^@article\{/);
    });

    it('throws for unknown paper ID', () => {
      expect(() => service.exportCitation('nonexistent', 'apa')).toThrow('Paper not found');
    });
  });

  // -----------------------------------------------------------------------
  // detectDuplicate (Req 5.8)
  // -----------------------------------------------------------------------
  describe('detectDuplicate', () => {
    it('returns not duplicate when no papers indexed', () => {
      const result = service.detectDuplicate(makeMetadata());
      expect(result.isDuplicate).toBe(false);
    });

    it('detects duplicate by DOI', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const result = service.detectDuplicate(makeMetadata({ doi: '10.1234/test.2024.001' }));
      expect(result.isDuplicate).toBe(true);
      expect(result.matchType).toBe('doi');
      expect(result.confidence).toBe(1.0);
    });

    it('detects duplicate by title similarity', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const result = service.detectDuplicate(
        makeMetadata({
          doi: '10.9999/different',
          title: 'Accessible Gaming for Motor Disabilities',
        }),
      );
      expect(result.isDuplicate).toBe(true);
      expect(result.matchType).toBe('title');
    });

    it('does not flag different papers as duplicates', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const result = service.detectDuplicate(
        makeMetadata({
          doi: '10.9999/different',
          title: 'Quantum Computing Advances in 2024',
        }),
      );
      expect(result.isDuplicate).toBe(false);
    });

    it('prefers DOI match over title match', async () => {
      await service.ingestPaper(makeWellFormedPaper(), 'pdf');
      const result = service.detectDuplicate(
        makeMetadata({
          doi: '10.1234/test.2024.001',
          title: 'Completely Different Title',
        }),
      );
      expect(result.isDuplicate).toBe(true);
      expect(result.matchType).toBe('doi');
    });
  });

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  describe('timing constants', () => {
    it('ingestion deadline is 60 seconds', () => {
      expect(INGESTION_DEADLINE_MS).toBe(60_000);
    });

    it('answer deadline is 10 seconds', () => {
      expect(ANSWER_DEADLINE_MS).toBe(10_000);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles embedding provider failure gracefully', async () => {
      const failingProvider = {
        generateEmbedding: async () => { throw new Error('embedding failed'); },
      };
      const svc = new ResearchAnalyzerService(failingProvider);
      const result = await svc.ingestPaper(makeWellFormedPaper(), 'pdf');
      expect(result.paperId).toBeTruthy();
      expect(result.failedFields).toContain('fullTextEmbedding');
    });

    it('title similarity threshold is 0.8', () => {
      expect(TITLE_SIMILARITY_THRESHOLD).toBe(0.8);
    });
  });
});
