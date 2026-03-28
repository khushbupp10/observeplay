import type {
  Paper,
  PaperMetadata,
  PaperSummary,
  ChunkEmbedding,
  Citation,
  ResearchAnswer,
  GapAnalysis,
  ResearchGap,
  ResearchDirection,
  PaperIngestionResult,
  DuplicateCheckResult,
} from '../types';

// ---------------------------------------------------------------------------
// Interfaces — abstractions for external dependencies
// ---------------------------------------------------------------------------

/**
 * Abstraction for generating vector embeddings from text.
 * Default stub returns deterministic mock embeddings.
 */
export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}

/**
 * Abstraction for extracting text and metadata from PDF/HTML content.
 * Default stub extracts basic metadata from text content.
 */
export interface TextExtractor {
  extract(content: Buffer, format: 'pdf' | 'html'): Promise<ExtractedContent>;
}

export interface ExtractedContent {
  fullText: string;
  title: string;
  authors: string[];
  abstract: string;
  publicationDate?: string;
  journal?: string;
  doi?: string;
  references: string[];
  sections: ExtractedSection[];
  failedFields: string[];
}

export interface ExtractedSection {
  title: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

// ---------------------------------------------------------------------------
// Default stubs
// ---------------------------------------------------------------------------

/** Deterministic mock embedding provider — produces a fixed-length vector from text. */
export class StubEmbeddingProvider implements EmbeddingProvider {
  private readonly dimensions: number;

  constructor(dimensions = 128) {
    this.dimensions = dimensions;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const embedding: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      // Deterministic: hash-like value derived from text + index
      let hash = 0;
      const seed = `${text}:${i}`;
      for (let j = 0; j < seed.length; j++) {
        hash = (hash * 31 + seed.charCodeAt(j)) | 0;
      }
      embedding.push(((hash % 1000) / 1000));
    }
    return embedding;
  }
}

/** Stub text extractor — parses basic metadata from raw text content. */
export class StubTextExtractor implements TextExtractor {
  async extract(content: Buffer, format: 'pdf' | 'html'): Promise<ExtractedContent> {
    const text = content.toString('utf-8');
    const failedFields: string[] = [];

    const title = this.extractTitle(text);
    if (!title) failedFields.push('title');

    const authors = this.extractAuthors(text);
    if (authors.length === 0) failedFields.push('authors');

    const abstract = this.extractAbstract(text);
    if (!abstract) failedFields.push('abstract');

    const sections = this.extractSections(text);

    return {
      fullText: text,
      title: title || 'requires manual entry',
      authors: authors.length > 0 ? authors : [],
      abstract: abstract || 'requires manual entry',
      publicationDate: this.extractField(text, 'date') || undefined,
      journal: this.extractField(text, 'journal') || undefined,
      doi: this.extractDoi(text) || undefined,
      references: this.extractReferences(text),
      sections,
      failedFields,
    };
  }

  private extractTitle(text: string): string | null {
    // Look for a title-like first line (non-empty, not too long)
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0 && lines[0].length > 0 && lines[0].length < 300) {
      return lines[0];
    }
    return null;
  }

  private extractAuthors(text: string): string[] {
    const match = text.match(/(?:authors?|by)[:\s]+([^\n]+)/i);
    if (match) {
      return match[1]
        .split(/[,;&]/)
        .map((a) => a.trim())
        .filter(Boolean);
    }
    return [];
  }

  private extractAbstract(text: string): string | null {
    const match = text.match(/abstract[:\s]*\n?([\s\S]{10,500}?)(?:\n\n|introduction|keywords)/i);
    if (match) return match[1].trim();
    return null;
  }

  private extractField(text: string, field: string): string | null {
    const regex = new RegExp(`${field}[:\\s]+([^\\n]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  private extractDoi(text: string): string | null {
    const match = text.match(/(?:doi[:\s]*)(10\.\d{4,}\/[^\s]+)/i);
    return match ? match[1] : null;
  }

  private extractReferences(text: string): string[] {
    const refSection = text.match(/references\s*\n([\s\S]*?)$/i);
    if (!refSection) return [];
    return refSection[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 10)
      .slice(0, 50);
  }

  private extractSections(text: string): ExtractedSection[] {
    const sections: ExtractedSection[] = [];
    // Split on lines that look like section headers (all caps or numbered)
    const lines = text.split('\n');
    let currentTitle = 'Introduction';
    let currentText = '';
    let currentStart = 0;
    let offset = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const isHeader =
        (trimmed.length > 0 && trimmed.length < 100 && /^\d+\.?\s+\w/.test(trimmed)) ||
        (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80 && /[A-Z]/.test(trimmed));

      if (isHeader && currentText.trim().length > 0) {
        sections.push({
          title: currentTitle,
          text: currentText.trim(),
          startOffset: currentStart,
          endOffset: offset,
        });
        currentTitle = trimmed;
        currentText = '';
        currentStart = offset;
      } else {
        currentText += line + '\n';
      }
      offset += line.length + 1;
    }

    if (currentText.trim().length > 0) {
      sections.push({
        title: currentTitle,
        text: currentText.trim(),
        startOffset: currentStart,
        endOffset: offset,
      });
    }

    return sections;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Max time (ms) allowed for paper ingestion. */
export const INGESTION_DEADLINE_MS = 60_000;

/** Max time (ms) allowed for answering a question. */
export const ANSWER_DEADLINE_MS = 10_000;

/**
 * Compute a simple similarity score between two strings (0–1).
 * Uses normalized Jaccard similarity on word sets.
 */
export function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/** Title similarity threshold for duplicate detection. */
export const TITLE_SIMILARITY_THRESHOLD = 0.8;

/**
 * Generate a structured summary from extracted text content.
 */
export function generateSummary(extracted: ExtractedContent): PaperSummary {
  const failedFields: string[] = [];

  // Objective: use abstract or first section
  let objective = '';
  if (extracted.abstract && extracted.abstract !== 'requires manual entry') {
    const sentences = extracted.abstract.split(/\.\s+/);
    objective = sentences.length > 0 ? sentences[0] + '.' : '';
  }
  if (!objective && extracted.sections.length > 0) {
    const firstSection = extracted.sections[0].text;
    const sentences = firstSection.split(/\.\s+/);
    objective = sentences.length > 0 ? sentences[0] + '.' : '';
  }
  if (!objective) {
    objective = 'requires manual entry';
    failedFields.push('objective');
  }

  // Methodology: look for methodology/methods section
  let methodology = '';
  const methodSection = extracted.sections.find(
    (s) => /method/i.test(s.title),
  );
  if (methodSection) {
    const sentences = methodSection.text.split(/\.\s+/);
    methodology = sentences.slice(0, 2).join('. ') + '.';
  }
  if (!methodology) {
    methodology = 'requires manual entry';
    failedFields.push('methodology');
  }

  // Key findings: look for results/findings/conclusion sections
  const keyFindings: string[] = [];
  const findingsSection = extracted.sections.find(
    (s) => /result|finding|conclusion/i.test(s.title),
  );
  if (findingsSection) {
    const sentences = findingsSection.text.split(/\.\s+/).filter(Boolean);
    keyFindings.push(...sentences.slice(0, 3).map((s) => s.trim().replace(/\.$/, '') + '.'));
  }
  if (keyFindings.length === 0) {
    keyFindings.push('requires manual entry');
    failedFields.push('keyFindings');
  }

  // Limitations: look for limitations section
  const limitations: string[] = [];
  const limitSection = extracted.sections.find(
    (s) => /limitation/i.test(s.title),
  );
  if (limitSection) {
    const sentences = limitSection.text.split(/\.\s+/).filter(Boolean);
    limitations.push(...sentences.slice(0, 3).map((s) => s.trim().replace(/\.$/, '') + '.'));
  }
  if (limitations.length === 0) {
    limitations.push('requires manual entry');
    failedFields.push('limitations');
  }

  return { objective, methodology, keyFindings, limitations };
}

// ---------------------------------------------------------------------------
// Citation formatting
// ---------------------------------------------------------------------------

/**
 * Format paper metadata into a citation string in the specified format.
 */
export function formatCitation(
  metadata: PaperMetadata,
  format: 'apa' | 'mla' | 'bibtex',
): string {
  const firstAuthor = metadata.authors.length > 0 ? metadata.authors[0] : 'Unknown Author';
  const year = metadata.publicationDate
    ? new Date(metadata.publicationDate).getFullYear() || 'n.d.'
    : 'n.d.';

  switch (format) {
    case 'apa': {
      const authorStr =
        metadata.authors.length > 2
          ? `${formatAuthorLastFirst(firstAuthor)} et al.`
          : metadata.authors.map(formatAuthorLastFirst).join(', & ');
      const journal = metadata.journal ? ` ${metadata.journal}.` : '';
      const doi = metadata.doi ? ` https://doi.org/${metadata.doi}` : '';
      return `${authorStr || 'Unknown Author'} (${year}). ${metadata.title}.${journal}${doi}`;
    }

    case 'mla': {
      const authorStr =
        metadata.authors.length > 2
          ? `${formatAuthorLastFirst(firstAuthor)}, et al.`
          : metadata.authors.map(formatAuthorLastFirst).join(', and ');
      const journal = metadata.journal ? ` ${metadata.journal},` : '';
      const yearStr = metadata.publicationDate
        ? ` ${year}.`
        : '';
      return `${authorStr || 'Unknown Author'}. "${metadata.title}."${journal}${yearStr}`;
    }

    case 'bibtex': {
      const key = firstAuthor.split(/\s+/).pop()?.toLowerCase() || 'unknown';
      const authorStr = metadata.authors.join(' and ');
      const journal = metadata.journal ? `  journal = {${metadata.journal}},\n` : '';
      const doi = metadata.doi ? `  doi = {${metadata.doi}},\n` : '';
      return (
        `@article{${key}${year},\n` +
        `  title = {${metadata.title}},\n` +
        `  author = {${authorStr || 'Unknown Author'}},\n` +
        `  year = {${year}},\n` +
        journal +
        doi +
        `}`
      );
    }

    default:
      throw new Error(`Unsupported citation format: ${format}`);
  }
}

/**
 * Format an author name as "Last, First" for citation styles.
 */
function formatAuthorLastFirst(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

// ---------------------------------------------------------------------------
// Research Analyzer Service
// ---------------------------------------------------------------------------

export class ResearchAnalyzerService {
  private papers: Map<string, Paper> = new Map();
  private embeddingProvider: EmbeddingProvider;
  private textExtractor: TextExtractor;

  constructor(
    embeddingProvider?: EmbeddingProvider,
    textExtractor?: TextExtractor,
  ) {
    this.embeddingProvider = embeddingProvider ?? new StubEmbeddingProvider();
    this.textExtractor = textExtractor ?? new StubTextExtractor();
  }

  // -----------------------------------------------------------------------
  // ingestPaper (Req 5.1, 5.5, 5.8, 5.9)
  // -----------------------------------------------------------------------

  async ingestPaper(
    file: Buffer,
    format: 'pdf' | 'html',
  ): Promise<PaperIngestionResult> {
    const startTime = Date.now();

    // 1. Extract text and metadata
    const extracted = await this.textExtractor.extract(file, format);

    // 2. Build metadata
    const metadata: PaperMetadata = {
      title: extracted.title,
      authors: extracted.authors,
      abstract: extracted.abstract,
      publicationDate: extracted.publicationDate,
      journal: extracted.journal,
      doi: extracted.doi,
      references: extracted.references,
    };

    // 3. Detect duplicates before indexing
    const dupCheck = this.detectDuplicate(metadata);
    if (dupCheck.isDuplicate) {
      return {
        paperId: dupCheck.existingPaperId!,
        metadata,
        summary: this.papers.get(dupCheck.existingPaperId!)!.summary,
        isDuplicate: true,
        failedFields: extracted.failedFields,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // 4. Generate summary
    const summary = generateSummary(extracted);

    // Merge summary failed fields with extraction failed fields
    const allFailedFields = [...new Set([...extracted.failedFields, ...this.getSummaryFailedFields(summary)])];

    // 5. Generate embeddings
    let fullTextEmbedding: number[] = [];
    try {
      fullTextEmbedding = await this.embeddingProvider.generateEmbedding(extracted.fullText);
    } catch {
      // Embedding failure — index without embeddings (keyword search only)
      allFailedFields.push('fullTextEmbedding');
    }

    // 6. Generate chunk embeddings
    const chunkEmbeddings: ChunkEmbedding[] = [];
    for (const section of extracted.sections) {
      try {
        const embedding = await this.embeddingProvider.generateEmbedding(section.text);
        chunkEmbeddings.push({
          sectionTitle: section.title,
          text: section.text,
          embedding,
          startOffset: section.startOffset,
          endOffset: section.endOffset,
        });
      } catch {
        // Skip failed chunk embeddings
      }
    }

    // 7. Create paper record
    const paperId = generateId();
    const status = allFailedFields.length > 0 ? 'partial' : 'indexed';

    const paper: Paper = {
      id: paperId,
      metadata,
      summary,
      fullTextEmbedding,
      chunkEmbeddings,
      indexedAt: Date.now(),
      status,
      failedFields: allFailedFields,
    };

    this.papers.set(paperId, paper);

    return {
      paperId,
      metadata,
      summary,
      isDuplicate: false,
      failedFields: allFailedFields,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // -----------------------------------------------------------------------
  // answerQuestion (Req 5.2)
  // -----------------------------------------------------------------------

  answerQuestion(question: string): ResearchAnswer {
    const papers = Array.from(this.papers.values());

    if (papers.length === 0) {
      return {
        synthesizedAnswer: 'No papers have been indexed yet.',
        citations: [],
        confidence: 0,
        relatedTopics: [],
      };
    }

    // Simple keyword-matching approach against indexed papers
    const questionWords = new Set(
      question.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
    );

    const scoredPapers = papers
      .map((paper) => {
        const textToSearch = [
          paper.metadata.title,
          paper.metadata.abstract,
          ...paper.summary.keyFindings,
          paper.summary.objective,
        ]
          .join(' ')
          .toLowerCase();

        let matchCount = 0;
        for (const word of questionWords) {
          if (textToSearch.includes(word)) matchCount++;
        }
        const score = questionWords.size > 0 ? matchCount / questionWords.size : 0;
        return { paper, score };
      })
      .filter((sp) => sp.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (scoredPapers.length === 0) {
      return {
        synthesizedAnswer: 'No relevant papers found for this question.',
        citations: [],
        confidence: 0,
        relatedTopics: this.extractTopics(papers),
      };
    }

    // Build synthesized answer from top matching papers
    const citations: Citation[] = scoredPapers.map((sp) => ({
      paperId: sp.paper.id,
      relevantText: sp.paper.summary.objective,
      sectionTitle: 'Summary',
      confidence: sp.score,
    }));

    const answerParts = scoredPapers.map(
      (sp) =>
        `${sp.paper.metadata.title}: ${sp.paper.summary.keyFindings[0] || sp.paper.summary.objective}`,
    );

    const avgConfidence =
      scoredPapers.reduce((sum, sp) => sum + sp.score, 0) / scoredPapers.length;

    return {
      synthesizedAnswer: answerParts.join(' '),
      citations,
      confidence: Math.min(avgConfidence, 1),
      relatedTopics: this.extractTopics(scoredPapers.map((sp) => sp.paper)),
    };
  }

  // -----------------------------------------------------------------------
  // analyzeGaps (Req 5.3, 5.4)
  // -----------------------------------------------------------------------

  analyzeGaps(topic: string): GapAnalysis {
    const papers = Array.from(this.papers.values());
    const topicLower = topic.toLowerCase();

    // Find papers related to the topic
    const relatedPapers = papers.filter((p) => {
      const text = [p.metadata.title, p.metadata.abstract, ...p.summary.keyFindings]
        .join(' ')
        .toLowerCase();
      return text.includes(topicLower);
    });

    // Identify under-researched areas by looking at topics mentioned
    // in related papers but with few dedicated papers
    const topicMentions = new Map<string, string[]>();
    for (const paper of relatedPapers) {
      const words = [paper.metadata.title, paper.metadata.abstract]
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4);

      for (const word of words) {
        if (word === topicLower) continue;
        const existing = topicMentions.get(word) || [];
        if (!existing.includes(paper.id)) {
          existing.push(paper.id);
          topicMentions.set(word, existing);
        }
      }
    }

    // Areas mentioned in only 1-2 papers are under-researched
    const underResearchedAreas: ResearchGap[] = [];
    for (const [area, paperIds] of topicMentions) {
      if (paperIds.length <= 2 && paperIds.length > 0) {
        underResearchedAreas.push({
          area,
          description: `"${area}" is mentioned in only ${paperIds.length} paper(s) related to ${topic}`,
          evidenceCount: paperIds.length,
        });
      }
    }

    // Sort by evidence count (ascending — least researched first), limit results
    underResearchedAreas.sort((a, b) => a.evidenceCount - b.evidenceCount);
    const topGaps = underResearchedAreas.slice(0, 10);

    // Suggest research directions based on gaps
    const suggestedDirections: ResearchDirection[] = topGaps.slice(0, 5).map((gap) => ({
      direction: `Investigate ${gap.area} in the context of ${topic}`,
      rationale: gap.description,
      relatedPapers: topicMentions.get(gap.area) || [],
    }));

    // Supporting evidence from related papers
    const supportingEvidence: Citation[] = relatedPapers.slice(0, 5).map((p) => ({
      paperId: p.id,
      relevantText: p.summary.objective,
      sectionTitle: 'Summary',
      confidence: 0.7,
    }));

    return {
      topic,
      underResearchedAreas: topGaps,
      suggestedDirections,
      supportingEvidence,
    };
  }

  // -----------------------------------------------------------------------
  // exportCitation (Req 5.6)
  // -----------------------------------------------------------------------

  exportCitation(paperId: string, format: 'apa' | 'mla' | 'bibtex'): string {
    const paper = this.papers.get(paperId);
    if (!paper) {
      throw new Error(`Paper not found: ${paperId}`);
    }
    return formatCitation(paper.metadata, format);
  }

  // -----------------------------------------------------------------------
  // detectDuplicate (Req 5.8)
  // -----------------------------------------------------------------------

  detectDuplicate(metadata: PaperMetadata): DuplicateCheckResult {
    // 1. Check by DOI first (exact match)
    if (metadata.doi) {
      for (const [id, paper] of this.papers) {
        if (paper.metadata.doi && paper.metadata.doi === metadata.doi) {
          return {
            isDuplicate: true,
            existingPaperId: id,
            matchType: 'doi',
            confidence: 1.0,
          };
        }
      }
    }

    // 2. Check by title similarity
    for (const [id, paper] of this.papers) {
      const similarity = titleSimilarity(paper.metadata.title, metadata.title);
      if (similarity >= TITLE_SIMILARITY_THRESHOLD) {
        return {
          isDuplicate: true,
          existingPaperId: id,
          matchType: 'title',
          confidence: similarity,
        };
      }
    }

    return {
      isDuplicate: false,
      confidence: 0,
    };
  }

  // -----------------------------------------------------------------------
  // Accessors (for testing / integration)
  // -----------------------------------------------------------------------

  getPaper(paperId: string): Paper | undefined {
    return this.papers.get(paperId);
  }

  getAllPapers(): Paper[] {
    return Array.from(this.papers.values());
  }

  getPaperCount(): number {
    return this.papers.size;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getSummaryFailedFields(summary: PaperSummary): string[] {
    const failed: string[] = [];
    if (summary.objective === 'requires manual entry') failed.push('objective');
    if (summary.methodology === 'requires manual entry') failed.push('methodology');
    if (summary.keyFindings.length === 1 && summary.keyFindings[0] === 'requires manual entry') {
      failed.push('keyFindings');
    }
    if (summary.limitations.length === 1 && summary.limitations[0] === 'requires manual entry') {
      failed.push('limitations');
    }
    return failed;
  }

  private extractTopics(papers: Paper[]): string[] {
    const wordCounts = new Map<string, number>();
    for (const paper of papers) {
      const words = paper.metadata.title
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }
    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
}
