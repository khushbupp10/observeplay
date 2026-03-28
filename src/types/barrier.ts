export interface BarrierEvent {
  id: string;
  sessionId: string;
  playerId: string;
  timestamp: number;

  type:
    | 'unreachable_element'
    | 'missed_audio_cue'
    | 'small_text'
    | 'low_contrast'
    | 'timing_barrier'
    | 'complex_input';
  severity: 'low' | 'medium' | 'high' | 'critical';

  // What was detected
  detectedElement: UIElementRef;
  detectedValue: unknown;
  thresholdValue: unknown;

  // Resolution
  adaptation?: AdaptationAction;
  adaptationAppliedAt?: number;
  adaptationUndone: boolean;
}

export interface UIElementRef {
  elementId: string;
  type: string;
  position: { x: number; y: number; width: number; height: number };
  content?: string;
}

export interface AdaptationAction {
  id: string;
  type:
    | 'reposition'
    | 'resize'
    | 'recolor'
    | 'add_audio_cue'
    | 'add_haptic'
    | 'enlarge_text';
  targetElement: UIElementRef;
  parameters: Record<string, unknown>;
  isProactive: boolean;
  undoable: boolean;
}

export interface FrameData {
  imageData: ImageData | ArrayBuffer;
  timestamp: number;
  width: number;
  height: number;
}

export interface FrameAnalysisResult {
  barriers: BarrierEvent[];
  adaptations: AdaptationAction[];
  frameTimestampMs: number;
  processingTimeMs: number;
}
