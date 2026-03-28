// Common enums, union types, and shared interfaces
export type {
  Genre,
  InputMethod,
  ColorBlindnessType,
  EmotionCategory,
  ConsentCategory,
  CommunicationChannel,
  SupportedLanguage,
  SpatialPosition,
  ScreenZone,
  VisualFieldRestriction,
} from './common';

// Player and accessibility profile
export type {
  Player,
  AccessibilityProfile,
  AccessibilityProfileExport,
} from './player';

// Game specification and related types
export type {
  GameSpec,
  GameRule,
  WinCondition,
  GameMechanic,
  InteractionMapping,
  AssetReference,
  AccessibilityAdaptation,
  GameAction,
  GameEntityRef,
  GameState,
  GameContext,
  GameEnvironment,
  GameSegment,
} from './game';

// Barrier detection and adaptation
export type {
  BarrierEvent,
  UIElementRef,
  AdaptationAction,
  FrameData,
  FrameAnalysisResult,
} from './barrier';

// Emotion engine
export type {
  EmotionClassification,
  InputPatternWindow,
  Intervention,
  EmotionState,
  EmotionStateLog,
  EmotionStateEntry,
} from './emotion';

// Audio narrator
export type {
  VisualGameEvent,
  AudioDescription,
  SpatialSoundscape,
  SoundscapeLayer,
  SceneElement,
  SceneState,
} from './audio';

// Research analyzer
export type {
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
} from './research';

// Consent and data management
export type {
  ConsentState,
  ConsentRecord,
  ConsentForm,
  ConsentFormCategory,
  ConsentConfigurationExport,
  DataDashboard,
  DataCategoryInfo,
  PlayerDataExport,
  GameSessionSummary,
  ResearcherData,
  DataDeletionResult,
} from './consent';

// AI companion
export type {
  ControlDivision,
  CompanionPerformanceLog,
  LoggedAction,
  ControlTransferEvent,
  CompanionPlayerModel,
  MechanicPerformanceRecord,
  SessionMechanicResult,
  AssistanceOffer,
} from './companion';

// NL controller / dialogue
export type {
  DialogueContext,
  DialogueTurn,
  CommandInterpretation,
  GameStateResponse,
  ClarificationRequest,
  AmbiguityDescription,
} from './dialogue';

// Learning and adaptation
export type {
  AdaptationHistory,
  AdaptationHistoryEntry,
  AdaptationModel,
  ProactiveRule,
  ProactiveDecision,
  MechanicOutcome,
  TransferSuggestion,
  StrugglingDetection,
} from './learning';
