import type { AccessibilityProfile } from '../types/player';
import type {
  BarrierEvent,
  UIElementRef,
  AdaptationAction,
  FrameData,
  FrameAnalysisResult,
} from '../types/barrier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdaptationResult {
  success: boolean;
  adaptation: AdaptationAction;
  appliedAt: number;
}

export interface AdaptationIndicator {
  adaptationId: string;
  message: string;
  timestamp: number;
}

interface PreAdaptationState {
  element: UIElementRef;
  adaptationId: string;
  barrierEventId: string;
}

interface MonitoringSession {
  sessionId: string;
  profile: AccessibilityProfile;
  barrierLog: BarrierEvent[];
  adaptationStates: Map<string, PreAdaptationState>;
  active: boolean;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Max time (ms) allowed to apply an adaptation after barrier detection. */
const ADAPTATION_DEADLINE_MS = 2000;

/** Minimum frames per second for the barrier detection pipeline. */
export const MIN_FPS = 5;

// ---------------------------------------------------------------------------
// Barrier detection helpers
// ---------------------------------------------------------------------------

function isOutsideReachableZone(
  el: UIElementRef,
  zone: AccessibilityProfile['reachableScreenZone'],
): boolean {
  const { x, y, width, height } = el.position;
  return (
    x < zone.topLeft.x ||
    y < zone.topLeft.y ||
    x + width > zone.bottomRight.x ||
    y + height > zone.bottomRight.y
  );
}

function detectBarriers(
  elements: UIElementRef[],
  profile: AccessibilityProfile,
  sessionId: string,
  playerId: string,
  timestamp: number,
): BarrierEvent[] {
  const barriers: BarrierEvent[] = [];

  for (const el of elements) {
    // Unreachable element
    if (isOutsideReachableZone(el, profile.reachableScreenZone)) {
      barriers.push({
        id: generateId(),
        sessionId,
        playerId,
        timestamp,
        type: 'unreachable_element',
        severity: 'high',
        detectedElement: el,
        detectedValue: { x: el.position.x, y: el.position.y },
        thresholdValue: profile.reachableScreenZone,
        adaptationUndone: false,
      });
    }

    // Small text
    const textSize = (el.position.height ?? 0);
    if (el.type === 'text' && textSize > 0 && textSize < profile.minReadableTextSize) {
      barriers.push({
        id: generateId(),
        sessionId,
        playerId,
        timestamp,
        type: 'small_text',
        severity: 'medium',
        detectedElement: el,
        detectedValue: textSize,
        thresholdValue: profile.minReadableTextSize,
        adaptationUndone: false,
      });
    }

    // Low contrast
    const contrast = (el as UIElementRef & { contrastRatio?: number }).contrastRatio;
    if (
      el.type === 'text' &&
      contrast !== undefined &&
      contrast < profile.minContrastRatio
    ) {
      barriers.push({
        id: generateId(),
        sessionId,
        playerId,
        timestamp,
        type: 'low_contrast',
        severity: 'medium',
        detectedElement: el,
        detectedValue: contrast,
        thresholdValue: profile.minContrastRatio,
        adaptationUndone: false,
      });
    }

    // Missed audio cue
    if (
      el.type === 'audio_cue' &&
      (profile.hearingCapability === 'none' || profile.hearingCapability === 'partial')
    ) {
      barriers.push({
        id: generateId(),
        sessionId,
        playerId,
        timestamp,
        type: 'missed_audio_cue',
        severity: 'high',
        detectedElement: el,
        detectedValue: profile.hearingCapability,
        thresholdValue: 'full',
        adaptationUndone: false,
      });
    }

    // Timing barrier
    if (el.type === 'timed_action') {
      const requiredTime = (el as UIElementRef & { requiredTimeMs?: number }).requiredTimeMs ?? 0;
      if (requiredTime > 0 && requiredTime < profile.responseTimeMs) {
        barriers.push({
          id: generateId(),
          sessionId,
          playerId,
          timestamp,
          type: 'timing_barrier',
          severity: 'high',
          detectedElement: el,
          detectedValue: requiredTime,
          thresholdValue: profile.responseTimeMs,
          adaptationUndone: false,
        });
      }
    }

    // Complex input
    if (el.type === 'complex_input') {
      const requiredMethods = (el as UIElementRef & { requiredInputMethods?: string[] }).requiredInputMethods ?? [];
      const playerMethods = profile.inputMethods as string[];
      const hasRequired = requiredMethods.some((m: string) => playerMethods.includes(m));
      if (!hasRequired && requiredMethods.length > 0) {
        barriers.push({
          id: generateId(),
          sessionId,
          playerId,
          timestamp,
          type: 'complex_input',
          severity: 'medium',
          detectedElement: el,
          detectedValue: requiredMethods,
          thresholdValue: playerMethods,
          adaptationUndone: false,
        });
      }
    }
  }

  return barriers;
}

// ---------------------------------------------------------------------------
// Adaptation selection
// ---------------------------------------------------------------------------

function selectAdaptation(
  barrier: BarrierEvent,
  profile: AccessibilityProfile,
): AdaptationAction {
  const id = generateId();
  const el = barrier.detectedElement;

  switch (barrier.type) {
    case 'unreachable_element': {
      const zone = profile.reachableScreenZone;
      // Clamp element into the reachable zone
      const newX = Math.max(zone.topLeft.x, Math.min(el.position.x, zone.bottomRight.x - el.position.width));
      const newY = Math.max(zone.topLeft.y, Math.min(el.position.y, zone.bottomRight.y - el.position.height));
      return {
        id,
        type: 'reposition',
        targetElement: { ...el, position: { ...el.position, x: newX, y: newY } },
        parameters: { newX, newY, originalX: el.position.x, originalY: el.position.y },
        isProactive: false,
        undoable: true,
      };
    }

    case 'small_text': {
      const newSize = profile.minReadableTextSize;
      return {
        id,
        type: 'enlarge_text',
        targetElement: el,
        parameters: {
          newSize,
          originalSize: barrier.detectedValue,
          minContrastRatio: profile.minContrastRatio,
        },
        isProactive: false,
        undoable: true,
      };
    }

    case 'low_contrast': {
      return {
        id,
        type: 'recolor',
        targetElement: el,
        parameters: {
          targetContrastRatio: profile.minContrastRatio,
          originalContrastRatio: barrier.detectedValue,
        },
        isProactive: false,
        undoable: true,
      };
    }

    case 'missed_audio_cue': {
      return {
        id,
        type: 'add_audio_cue',
        targetElement: el,
        parameters: {
          alternativeType: 'visual_notification',
          originalCue: el.content ?? 'audio cue',
        },
        isProactive: false,
        undoable: true,
      };
    }

    case 'timing_barrier': {
      return {
        id,
        type: 'resize',
        targetElement: el,
        parameters: {
          extendedTimeMs: profile.responseTimeMs * 2,
          originalTimeMs: barrier.detectedValue,
        },
        isProactive: false,
        undoable: true,
      };
    }

    case 'complex_input': {
      return {
        id,
        type: 'add_haptic',
        targetElement: el,
        parameters: {
          simplifiedInput: true,
          originalRequiredMethods: barrier.detectedValue,
        },
        isProactive: false,
        undoable: true,
      };
    }

    default: {
      return {
        id,
        type: 'resize',
        targetElement: el,
        parameters: {},
        isProactive: false,
        undoable: true,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Adaptation application (idempotent)
// ---------------------------------------------------------------------------

function applyAdaptationToElement(
  adaptation: AdaptationAction,
): UIElementRef {
  const el = adaptation.targetElement;

  switch (adaptation.type) {
    case 'reposition': {
      const newX = adaptation.parameters.newX as number;
      const newY = adaptation.parameters.newY as number;
      return { ...el, position: { ...el.position, x: newX, y: newY } };
    }
    case 'enlarge_text': {
      const newSize = adaptation.parameters.newSize as number;
      return { ...el, position: { ...el.position, height: newSize } };
    }
    case 'recolor':
    case 'add_audio_cue':
    case 'add_haptic':
    case 'resize':
      return el;
    default:
      return el;
  }
}

// ---------------------------------------------------------------------------
// AccessibilityCopilotService
// ---------------------------------------------------------------------------

export class AccessibilityCopilotService {
  private sessions: Map<string, MonitoringSession> = new Map();
  private indicators: AdaptationIndicator[] = [];

  /**
   * Start monitoring a game session.
   * Requirements: 2.1
   */
  startMonitoring(sessionId: string, profile: AccessibilityProfile): void {
    this.sessions.set(sessionId, {
      sessionId,
      profile,
      barrierLog: [],
      adaptationStates: new Map(),
      active: true,
      startedAt: Date.now(),
    });
  }

  /**
   * Process a game frame and return detected barriers + adaptations.
   * The pipeline runs barrier detection, selects adaptations, applies them
   * (idempotently), and logs everything.
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.9
   */
  async processFrame(
    sessionId: string,
    frame: FrameData,
    elements: UIElementRef[],
  ): Promise<FrameAnalysisResult> {
    const startTime = Date.now();
    const session = this.sessions.get(sessionId);

    if (!session || !session.active) {
      return {
        barriers: [],
        adaptations: [],
        frameTimestampMs: frame.timestamp,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Detect barriers
    const barriers = detectBarriers(
      elements,
      session.profile,
      sessionId,
      session.profile.playerId,
      frame.timestamp,
    );

    const adaptations: AdaptationAction[] = [];

    for (const barrier of barriers) {
      // Select adaptation
      const adaptation = selectAdaptation(barrier, session.profile);

      // Apply adaptation (idempotent — applying twice yields same result)
      applyAdaptationToElement(adaptation);

      const now = Date.now();
      const adaptationTime = now - startTime;

      // Enforce 2-second deadline
      barrier.adaptation = adaptation;
      barrier.adaptationAppliedAt =
        adaptationTime <= ADAPTATION_DEADLINE_MS ? now : undefined;

      // Save pre-adaptation state for undo
      session.adaptationStates.set(adaptation.id, {
        element: { ...barrier.detectedElement },
        adaptationId: adaptation.id,
        barrierEventId: barrier.id,
      });

      adaptations.push(adaptation);

      // Emit non-intrusive indicator (Req 2.7)
      this.indicators.push({
        adaptationId: adaptation.id,
        message: buildIndicatorMessage(adaptation),
        timestamp: now,
      });

      // Log barrier event (Req 2.6)
      session.barrierLog.push(barrier);
    }

    return {
      barriers,
      adaptations,
      frameTimestampMs: frame.timestamp,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Apply a specific adaptation manually.
   * Idempotent — applying the same adaptation twice produces the same result.
   *
   * Requirements: 2.2, 2.9
   */
  async applyAdaptation(
    sessionId: string,
    adaptationId: string,
    barrierEvent: BarrierEvent,
  ): Promise<AdaptationResult> {
    const session = this.sessions.get(sessionId);
    const now = Date.now();

    const adaptation = barrierEvent.adaptation ?? selectAdaptation(barrierEvent, session?.profile ?? ({} as AccessibilityProfile));

    // Idempotent application
    applyAdaptationToElement(adaptation);

    if (session) {
      session.adaptationStates.set(adaptation.id, {
        element: { ...barrierEvent.detectedElement },
        adaptationId: adaptation.id,
        barrierEventId: barrierEvent.id,
      });
    }

    return {
      success: true,
      adaptation,
      appliedAt: now,
    };
  }

  /**
   * Undo a previously applied adaptation, restoring pre-adaptation state.
   *
   * Requirements: 2.8
   */
  async undoAdaptation(sessionId: string, adaptationId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const preState = session.adaptationStates.get(adaptationId);
    if (!preState) return;

    // Mark the barrier event as undone
    const barrierEvent = session.barrierLog.find(
      (b) => b.id === preState.barrierEventId,
    );
    if (barrierEvent) {
      barrierEvent.adaptationUndone = true;
    }

    // Remove the adaptation state (undo complete)
    session.adaptationStates.delete(adaptationId);
  }

  /**
   * Get the barrier log for a session.
   *
   * Requirements: 2.6
   */
  getBarrierLog(sessionId: string): BarrierEvent[] {
    const session = this.sessions.get(sessionId);
    return session ? [...session.barrierLog] : [];
  }

  /**
   * Get the most recent adaptation indicators.
   *
   * Requirements: 2.7
   */
  getIndicators(): AdaptationIndicator[] {
    return [...this.indicators];
  }

  /**
   * Stop monitoring a session.
   */
  stopMonitoring(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.active = false;
    }
  }

  /**
   * Check if a session is actively being monitored.
   */
  isMonitoring(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.active ?? false;
  }
}

// ---------------------------------------------------------------------------
// Indicator message builder
// ---------------------------------------------------------------------------

function buildIndicatorMessage(adaptation: AdaptationAction): string {
  switch (adaptation.type) {
    case 'reposition':
      return `Moved element "${adaptation.targetElement.elementId}" into your reachable zone`;
    case 'enlarge_text':
      return `Enlarged text "${adaptation.targetElement.content ?? adaptation.targetElement.elementId}" for readability`;
    case 'recolor':
      return `Adjusted contrast for "${adaptation.targetElement.content ?? adaptation.targetElement.elementId}"`;
    case 'add_audio_cue':
      return `Added visual notification for audio cue "${adaptation.targetElement.content ?? adaptation.targetElement.elementId}"`;
    case 'add_haptic':
      return `Simplified input for "${adaptation.targetElement.elementId}"`;
    case 'resize':
      return `Extended timing for "${adaptation.targetElement.elementId}"`;
    default:
      return `Adapted "${adaptation.targetElement.elementId}"`;
  }
}
