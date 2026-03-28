import type { EmotionCategory } from '../types/common';
import type { ConsentState } from '../types/consent';
import type {
  EmotionClassification,
  EmotionState,
  InputPatternWindow,
  Intervention,
  EmotionStateEntry,
} from '../types/emotion';
import type { GameContext } from '../types/game';

// ---------------------------------------------------------------------------
// Facial Expression Analyzer abstraction
// ---------------------------------------------------------------------------

/**
 * Abstraction over the TensorFlow.js facial expression model.
 * In production this runs client-side via WASM; in tests we swap in a stub.
 */
export interface FacialExpressionAnalyzer {
  /** Load the model (no-op for stubs). */
  load(): Promise<void>;
  /** Classify a webcam frame. Returns null if the model is unavailable. */
  classify(frame: ImageData): EmotionClassification | null;
}

/**
 * Default stub analyzer — returns a neutral classification.
 * Replace with a real TensorFlow.js implementation in the browser bundle.
 */
export class StubFacialExpressionAnalyzer implements FacialExpressionAnalyzer {
  async load(): Promise<void> {
    /* no-op */
  }
  classify(_frame: ImageData): EmotionClassification | null {
    return { category: 'neutral', confidence: 0.5, timestamp: Date.now() };
  }
}

// ---------------------------------------------------------------------------
// Intervention history record
// ---------------------------------------------------------------------------

export interface InterventionRecord {
  intervention: Intervention;
  emotionAtTrigger: EmotionCategory;
  timestamp: number;
  postInterventionState?: EmotionCategory;
}

// ---------------------------------------------------------------------------
// EmotionEngine implementation
// ---------------------------------------------------------------------------

export class EmotionEngine {
  private webcamConsented = false;
  private consentState: ConsentState | null = null;
  private analyzer: FacialExpressionAnalyzer;

  // State machine
  private currentState: EmotionState = {
    current: 'neutral',
    previous: 'neutral',
    durationMs: 0,
    lastUpdated: Date.now(),
    webcamEnabled: false,
  };

  // Tracking for time-based intervention triggers
  private stateEnteredAt: number = Date.now();

  // Intervention log
  private interventionLog: InterventionRecord[] = [];

  // Emotion state log entries (for session recording)
  private stateLog: EmotionStateEntry[] = [];

  constructor(analyzer?: FacialExpressionAnalyzer) {
    this.analyzer = analyzer ?? new StubFacialExpressionAnalyzer();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Initialize with consent state — webcam analysis only when consent granted.
   */
  initialize(consentState: ConsentState): void {
    this.consentState = consentState;
    const webcamRecord = consentState.consents.webcam;
    this.webcamConsented = webcamRecord?.granted === true;
    this.currentState = {
      ...this.currentState,
      webcamEnabled: this.webcamConsented,
    };

    if (this.webcamConsented) {
      // Fire-and-forget model load — errors are swallowed (fallback to input patterns)
      this.analyzer.load().catch(() => {
        this.webcamConsented = false;
        this.currentState = { ...this.currentState, webcamEnabled: false };
      });
    }
  }

  /**
   * Process a webcam frame (runs locally — no raw imagery stored or transmitted).
   * Returns null when webcam consent is not granted.
   */
  processWebcamFrame(frame: ImageData): EmotionClassification | null {
    if (!this.webcamConsented) {
      return null;
    }
    const classification = this.analyzer.classify(frame);
    return classification;
  }

  /**
   * Analyze input patterns over a time window.
   * Classification rules:
   *  - High error rate (>0.5) + high hesitation (>2000ms) → frustrated
   *  - High hesitation (>2000ms) + low error rate (≤0.5) → confused
   *  - Low input frequency (pause freq >0.7) + low error rate (≤0.3) → disengaged
   *  - Otherwise → engaged or neutral based on activity level
   */
  analyzeInputPatterns(patterns: InputPatternWindow): EmotionClassification {
    const now = Date.now();
    const { errorRate, inputHesitationMs, pauseFrequency } = patterns;

    let category: EmotionCategory;
    let confidence: number;

    if (errorRate > 0.5 && inputHesitationMs > 2000) {
      category = 'frustrated';
      confidence = Math.min(1, 0.6 + errorRate * 0.3);
    } else if (inputHesitationMs > 2000 && errorRate <= 0.5) {
      category = 'confused';
      confidence = Math.min(1, 0.5 + (inputHesitationMs / 10000) * 0.3);
    } else if (pauseFrequency > 0.7 && errorRate <= 0.3) {
      category = 'disengaged';
      confidence = Math.min(1, 0.5 + pauseFrequency * 0.3);
    } else if (pauseFrequency <= 0.3 && errorRate <= 0.3) {
      category = 'engaged';
      confidence = Math.min(1, 0.6 + (1 - pauseFrequency) * 0.2);
    } else {
      category = 'neutral';
      confidence = 0.5;
    }

    return { category, confidence, timestamp: now };
  }

  /**
   * Fuse webcam + input pattern signals into a final EmotionState.
   * Prefers the higher-confidence signal. When webcam is null (consent not
   * granted), uses input pattern classification exclusively.
   */
  fuseSignals(
    webcam: EmotionClassification | null,
    input: EmotionClassification,
  ): EmotionState {
    const now = Date.now();
    let chosen: EmotionClassification;
    let source: 'webcam' | 'input_pattern' | 'fused';

    if (webcam === null) {
      chosen = input;
      source = 'input_pattern';
    } else if (webcam.confidence > input.confidence) {
      chosen = webcam;
      source = 'fused';
    } else if (input.confidence > webcam.confidence) {
      chosen = input;
      source = 'fused';
    } else {
      // Equal confidence — prefer input patterns (more reliable baseline)
      chosen = input;
      source = 'fused';
    }

    const previous = this.currentState.current;
    const stateChanged = chosen.category !== previous;

    if (stateChanged) {
      this.stateEnteredAt = now;
    }

    const durationMs = now - this.stateEnteredAt;

    this.currentState = {
      current: chosen.category,
      previous,
      durationMs,
      lastUpdated: now,
      webcamEnabled: this.webcamConsented,
    };

    // Record in state log
    this.stateLog.push({
      timestamp: now,
      category: chosen.category,
      confidence: chosen.confidence,
      source,
    });

    return { ...this.currentState };
  }

  /**
   * Trigger intervention based on emotion state.
   * Rules:
   *  - frustrated >10s → hint, difficulty_reduction, or pacing_adjustment
   *  - confused → objective_explanation
   *  - disengaged >20s → activity_change or break_suggestion
   */
  triggerIntervention(state: EmotionState, _context: GameContext): Intervention | null {
    const { current, durationMs } = state;

    let intervention: Intervention | null = null;

    if (current === 'frustrated' && durationMs > 10_000) {
      const types = ['hint', 'difficulty_reduction', 'pacing_adjustment'] as const;
      const type = types[Math.floor(durationMs / 5000) % types.length];
      intervention = {
        type,
        message: this.getInterventionMessage(type),
        priority: 'high',
      };
    } else if (current === 'confused') {
      intervention = {
        type: 'objective_explanation',
        message: 'Here is an explanation of the current objective and controls.',
        priority: 'medium',
      };
    } else if (current === 'disengaged' && durationMs > 20_000) {
      const type = durationMs > 40_000 ? 'break_suggestion' : 'activity_change';
      intervention = {
        type,
        message: this.getInterventionMessage(type),
        priority: 'medium',
      };
    }

    if (intervention) {
      this.recordIntervention(intervention, current);
    }

    return intervention;
  }

  /**
   * Revoke webcam consent — ceases webcam analysis immediately.
   */
  revokeWebcamConsent(): void {
    this.webcamConsented = false;
    this.currentState = { ...this.currentState, webcamEnabled: false };
  }

  /**
   * Update consent state (e.g. when ConsentManager notifies of a change).
   */
  updateConsent(consentState: ConsentState): void {
    this.consentState = consentState;
    const webcamRecord = consentState.consents.webcam;
    const wasConsented = this.webcamConsented;
    this.webcamConsented = webcamRecord?.granted === true;
    this.currentState = {
      ...this.currentState,
      webcamEnabled: this.webcamConsented,
    };

    // If consent was just revoked, stop immediately
    if (wasConsented && !this.webcamConsented) {
      this.revokeWebcamConsent();
    }

    // If consent was just granted, load model
    if (!wasConsented && this.webcamConsented) {
      this.analyzer.load().catch(() => {
        this.webcamConsented = false;
        this.currentState = { ...this.currentState, webcamEnabled: false };
      });
    }
  }

  /**
   * Record the post-intervention emotion state change for the most recent
   * intervention that doesn't yet have a post-intervention state.
   */
  recordPostInterventionState(state: EmotionCategory): void {
    for (let i = this.interventionLog.length - 1; i >= 0; i--) {
      if (this.interventionLog[i].postInterventionState === undefined) {
        this.interventionLog[i].postInterventionState = state;

        // Also update the corresponding state log entry
        const logEntry = this.stateLog.find(
          (e) =>
            e.intervention?.type === this.interventionLog[i].intervention.type &&
            e.postInterventionState === undefined,
        );
        if (logEntry) {
          logEntry.postInterventionState = state;
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  getCurrentState(): EmotionState {
    return { ...this.currentState };
  }

  getInterventionLog(): InterventionRecord[] {
    return [...this.interventionLog];
  }

  getStateLog(): EmotionStateEntry[] {
    return [...this.stateLog];
  }

  isWebcamEnabled(): boolean {
    return this.webcamConsented;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private recordIntervention(intervention: Intervention, emotionAtTrigger: EmotionCategory): void {
    const record: InterventionRecord = {
      intervention,
      emotionAtTrigger,
      timestamp: Date.now(),
    };
    this.interventionLog.push(record);

    // Also add to state log
    const lastEntry = this.stateLog[this.stateLog.length - 1];
    if (lastEntry) {
      lastEntry.intervention = intervention;
    }
  }

  private getInterventionMessage(
    type: Intervention['type'],
  ): string {
    switch (type) {
      case 'hint':
        return 'It looks like you might be stuck. Here is a hint to help you progress.';
      case 'difficulty_reduction':
        return 'The difficulty has been adjusted to help you enjoy the experience.';
      case 'pacing_adjustment':
        return 'The pacing has been adjusted to give you more time.';
      case 'objective_explanation':
        return 'Here is an explanation of the current objective and controls.';
      case 'break_suggestion':
        return 'You have been playing for a while. Would you like to take a break?';
      case 'activity_change':
        return 'Would you like to try a different activity or adjust the difficulty?';
    }
  }
}
