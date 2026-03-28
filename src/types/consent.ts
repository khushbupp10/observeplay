import type { ConsentCategory } from './common';

export interface ConsentState {
  playerId: string;
  consents: Record<ConsentCategory, ConsentRecord>;
  lastUpdated: number;
}

export interface ConsentRecord {
  granted: boolean;
  grantedAt?: number;
  revokedAt?: number;
}

export interface ConsentForm {
  categories: ConsentFormCategory[];
  version: string;
  lastUpdated: number;
}

export interface ConsentFormCategory {
  category: ConsentCategory;
  title: string;
  description: string;
  required: boolean;
}

export interface ConsentConfigurationExport {
  exportedAt: number;
  consents: Record<ConsentCategory, boolean>;
  checksum: string;
}

export interface DataDashboard {
  collectedData: DataCategoryInfo[];
  lastAccessed: Record<string, number>;
  storageUsed: number;
}

export interface DataCategoryInfo {
  category: string;
  description: string;
  dataPointCount: number;
  lastCollected: number;
  retentionDays: number;
}

export interface PlayerDataExport {
  exportedAt: number;
  format: 'json';
  player: Record<string, unknown>;
  gameHistory: GameSessionSummary[];
  researchData?: ResearcherData;
}

export interface GameSessionSummary {
  sessionId: string;
  gameSpecId: string;
  startedAt: number;
  endedAt: number;
  duration: number;
}

export interface ResearcherData {
  papers: string[];
  queries: string[];
}

export interface DataDeletionResult {
  playerId: string;
  deletedCategories: string[];
  completedAt: number;
  withinDeadline: boolean;
}
