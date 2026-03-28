import type {
  InputMethod,
  ColorBlindnessType,
  ScreenZone,
  VisualFieldRestriction,
  SupportedLanguage,
  CommunicationChannel,
} from './common';
import type { ConsentState } from './consent';
import type { AdaptationHistory } from './learning';
import type { CompanionPlayerModel } from './companion';

export interface Player {
  id: string;
  createdAt: number;
  profile: AccessibilityProfile;
  consentState: ConsentState;
  adaptationHistory: AdaptationHistory;
  companionModel: CompanionPlayerModel;
  preferredLanguage: SupportedLanguage;
  preferredCommunicationChannel: CommunicationChannel;
}

export interface AccessibilityProfile {
  playerId: string;
  version: number;
  lastUpdated: number;

  // Input capabilities
  inputMethods: InputMethod[];
  responseTimeMs: number;
  inputAccuracy: number; // 0.0 - 1.0

  // Visual capabilities
  minReadableTextSize: number;
  minContrastRatio: number;
  colorBlindnessType: ColorBlindnessType | null;
  visualFieldRestriction: VisualFieldRestriction | null;

  // Audio capabilities
  hearingCapability: 'full' | 'partial' | 'none';
  preferredAudioChannel: 'stereo' | 'mono';

  // Motor capabilities
  reachableScreenZone: ScreenZone;
  clickPrecision: number;
  holdDuration: number;

  // Cognitive preferences
  preferredPacing: 'slow' | 'moderate' | 'fast';
  maxSimultaneousElements: number;
  preferredInstructionFormat: 'text' | 'audio' | 'visual' | 'multimodal';

  // Learned preferences
  learnedPreferences: Record<string, unknown>;
  manualOverrides: Record<string, unknown>;
}

export interface AccessibilityProfileExport {
  version: number;
  exportedAt: number;
  profile: Omit<AccessibilityProfile, 'playerId'>;
  checksum: string;
}
