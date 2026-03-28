export interface Paper {
  id: string;
  metadata: PaperMetadata;
  summary: PaperSummary;
  fullTextEmbedding: number[];
  chunkEmbeddings: ChunkEmbedding[];
  indexedAt: number;
  status: 'indexed' | 'partial' | 'failed';
  failedFields: string[];
}

export interface PaperMetadata {
  title: string;
  authors: string[];
  abstract: string;
  publicationDate?: string;
  journal?: string;
  doi?: string;
  references: string[];
}

export interface PaperSummary {
  objective: string;
  methodology: string;
  keyFindings: string[];
  limitations: string[];
}

export interface ChunkEmbedding {
  sectionTitle: string;
  text: string;
  embedding: number[];
  startOffset: number;
  endOffset: number;
}

export interface Citation {
  paperId: string;
  relevantText: string;
  sectionTitle: string;
  confidence: number;
}

export interface ResearchAnswer {
  synthesizedAnswer: string;
  citations: Citation[];
  confidence: number;
  relatedTopics: string[];
}

export interface GapAnalysis {
  topic: string;
  underResearchedAreas: ResearchGap[];
  suggestedDirections: ResearchDirection[];
  supportingEvidence: Citation[];
}

export interface ResearchGap {
  area: string;
  description: string;
  evidenceCount: number;
}

export interface ResearchDirection {
  direction: string;
  rationale: string;
  relatedPapers: string[];
}

export interface PaperIngestionResult {
  paperId: string;
  metadata: PaperMetadata;
  summary: PaperSummary;
  isDuplicate: boolean;
  failedFields: string[];
  processingTimeMs: number;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingPaperId?: string;
  matchType?: 'doi' | 'title';
  confidence: number;
}
