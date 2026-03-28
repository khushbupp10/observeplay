import { createHash } from 'crypto';
import type { GameSpec } from '../types/game';
import type { AccessibilityProfile, AccessibilityProfileExport } from '../types/player';
import type { PaperMetadata } from '../types/research';
import type { ConsentConfigurationExport } from '../types/consent';
import type { ConsentCategory } from '../types/common';

// ── Checksum utilities ──────────────────────────────────────────────

/**
 * Generate a SHA-256 checksum for the given data string.
 */
export function generateChecksum(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Verify that a data string matches the expected checksum.
 */
export function verifyChecksum(data: string, checksum: string): boolean {
  return generateChecksum(data) === checksum;
}

// ── GameSpec serialization ──────────────────────────────────────────

/**
 * Serialize a GameSpec to a JSON string.
 */
export function serializeGameSpec(spec: GameSpec): string {
  return JSON.stringify(spec);
}

/**
 * Deserialize a JSON string into a GameSpec.
 * Throws if the JSON is invalid or missing required fields.
 */
export function deserializeGameSpec(json: string): GameSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON: unable to parse GameSpec');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid GameSpec: expected an object');
  }

  const obj = parsed as Record<string, unknown>;

  const requiredStringFields = ['id', 'genre', 'title', 'description', 'playerDescription', 'difficultyLevel'];
  for (const field of requiredStringFields) {
    if (typeof obj[field] !== 'string') {
      throw new Error(`Invalid GameSpec: missing or invalid field "${field}"`);
    }
  }

  if (typeof obj.createdAt !== 'number') {
    throw new Error('Invalid GameSpec: missing or invalid field "createdAt"');
  }

  if (typeof obj.estimatedPlayTimeMinutes !== 'number') {
    throw new Error('Invalid GameSpec: missing or invalid field "estimatedPlayTimeMinutes"');
  }

  const requiredArrayFields = [
    'rules', 'winConditions', 'mechanics', 'interactionMappings',
    'visualAssets', 'audioAssets', 'accessibilityAdaptations',
  ];
  for (const field of requiredArrayFields) {
    if (!Array.isArray(obj[field])) {
      throw new Error(`Invalid GameSpec: missing or invalid field "${field}"`);
    }
  }

  return parsed as GameSpec;
}


// ── AccessibilityProfile serialization ──────────────────────────────

/**
 * Serialize an AccessibilityProfile into an exportable format with checksum.
 * The export omits the playerId for portability.
 */
export function serializeAccessibilityProfile(
  profile: AccessibilityProfile,
): AccessibilityProfileExport {
  const { playerId: _playerId, ...profileWithoutPlayerId } = profile;
  const exportData: Omit<AccessibilityProfileExport, 'checksum'> = {
    version: profile.version,
    exportedAt: Date.now(),
    profile: profileWithoutPlayerId,
  };
  const dataString = JSON.stringify(exportData);
  const checksum = generateChecksum(dataString);
  return { ...exportData, checksum };
}

/**
 * Deserialize an AccessibilityProfileExport back into profile data.
 * Verifies the checksum before returning.
 * Throws if the checksum is invalid or data is malformed.
 */
export function deserializeAccessibilityProfile(
  exported: AccessibilityProfileExport,
): Omit<AccessibilityProfile, 'playerId'> {
  const { checksum, ...dataWithoutChecksum } = exported;
  const dataString = JSON.stringify(dataWithoutChecksum);

  if (!verifyChecksum(dataString, checksum)) {
    throw new Error('Invalid AccessibilityProfileExport: checksum mismatch');
  }

  if (!exported.profile || typeof exported.profile !== 'object') {
    throw new Error('Invalid AccessibilityProfileExport: missing profile data');
  }

  return exported.profile;
}

// ── PaperMetadata serialization ─────────────────────────────────────

/**
 * Serialize PaperMetadata to a JSON string.
 */
export function serializePaperMetadata(metadata: PaperMetadata): string {
  return JSON.stringify(metadata);
}

/**
 * Deserialize a JSON string into PaperMetadata.
 * Throws if the JSON is invalid or missing required fields.
 */
export function deserializePaperMetadata(json: string): PaperMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON: unable to parse PaperMetadata');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid PaperMetadata: expected an object');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.title !== 'string') {
    throw new Error('Invalid PaperMetadata: missing or invalid field "title"');
  }
  if (!Array.isArray(obj.authors)) {
    throw new Error('Invalid PaperMetadata: missing or invalid field "authors"');
  }
  if (typeof obj.abstract !== 'string') {
    throw new Error('Invalid PaperMetadata: missing or invalid field "abstract"');
  }
  if (!Array.isArray(obj.references)) {
    throw new Error('Invalid PaperMetadata: missing or invalid field "references"');
  }

  return parsed as PaperMetadata;
}

// ── ConsentConfiguration serialization ──────────────────────────────

const CONSENT_CATEGORIES: ConsentCategory[] = [
  'webcam',
  'interaction_patterns',
  'profile_learning',
  'voice_input',
];

/**
 * Serialize a consent configuration into an exportable format with checksum.
 */
export function serializeConsentConfig(
  consents: Record<ConsentCategory, boolean>,
): ConsentConfigurationExport {
  const exportData: Omit<ConsentConfigurationExport, 'checksum'> = {
    exportedAt: Date.now(),
    consents,
  };
  const dataString = JSON.stringify(exportData);
  const checksum = generateChecksum(dataString);
  return { ...exportData, checksum };
}

/**
 * Deserialize a ConsentConfigurationExport back into a consent record.
 * Verifies the checksum before returning.
 * Throws if the checksum is invalid or data is malformed.
 */
export function deserializeConsentConfig(
  exported: ConsentConfigurationExport,
): Record<ConsentCategory, boolean> {
  const { checksum, ...dataWithoutChecksum } = exported;
  const dataString = JSON.stringify(dataWithoutChecksum);

  if (!verifyChecksum(dataString, checksum)) {
    throw new Error('Invalid ConsentConfigurationExport: checksum mismatch');
  }

  if (!exported.consents || typeof exported.consents !== 'object') {
    throw new Error('Invalid ConsentConfigurationExport: missing consents data');
  }

  for (const category of CONSENT_CATEGORIES) {
    if (typeof exported.consents[category] !== 'boolean') {
      throw new Error(
        `Invalid ConsentConfigurationExport: missing or invalid consent for "${category}"`,
      );
    }
  }

  return exported.consents;
}
