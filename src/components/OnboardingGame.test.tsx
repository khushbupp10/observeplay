import { describe, it, expect, vi } from 'vitest';
import {
  deriveMinTextSize,
  deriveMinContrastRatio,
  deriveHearingCapability,
  buildObservations,
  createInputState,
  STEPS,
  STEP_LABELS,
  TEXT_SIZES,
  CONTRAST_LEVELS,
  AUDIO_TESTS,
  TARGET_COUNT,
} from './OnboardingGame';
import type {
  InputAssessmentState,
  VisualAssessmentState,
  AudioAssessmentState,
} from './OnboardingGame';

// ---------------------------------------------------------------------------
// Pure helper function tests
// ---------------------------------------------------------------------------

describe('deriveMinTextSize', () => {
  it('returns the smallest readable size when first size is readable', () => {
    // Player can read 12px (first size)
    expect(deriveMinTextSize([true, true, true, true, true])).toBe(TEXT_SIZES[0]); // 12
  });

  it('returns a larger size when small sizes are not readable', () => {
    // Cannot read 12, 14 — can read 16
    expect(deriveMinTextSize([false, false, true, true, true])).toBe(16);
  });

  it('returns the largest size when nothing is readable', () => {
    expect(deriveMinTextSize([false, false, false, false, false])).toBe(TEXT_SIZES[TEXT_SIZES.length - 1]);
  });

  it('returns the largest size for empty results', () => {
    expect(deriveMinTextSize([])).toBe(TEXT_SIZES[TEXT_SIZES.length - 1]);
  });
});

describe('deriveMinContrastRatio', () => {
  it('returns the lowest contrast when first level is readable', () => {
    expect(deriveMinContrastRatio([true, true, true, true, true])).toBe(CONTRAST_LEVELS[0].ratio);
  });

  it('returns a higher contrast when low contrasts are not readable', () => {
    // Cannot read 2:1, 3:1 — can read 4.5:1
    expect(deriveMinContrastRatio([false, false, true, true, true])).toBe(4.5);
  });

  it('returns the highest contrast for empty results', () => {
    expect(deriveMinContrastRatio([])).toBe(CONTRAST_LEVELS[CONTRAST_LEVELS.length - 1].ratio);
  });
});

describe('deriveHearingCapability', () => {
  it('returns "full" when all sounds are heard', () => {
    expect(deriveHearingCapability([true, true, true])).toBe('full');
  });

  it('returns "partial" when some sounds are heard', () => {
    expect(deriveHearingCapability([true, false, true])).toBe('partial');
  });

  it('returns "none" when no sounds are heard', () => {
    expect(deriveHearingCapability([false, false, false])).toBe('none');
  });

  it('returns "full" for empty results (default)', () => {
    expect(deriveHearingCapability([])).toBe('full');
  });
});

describe('createInputState', () => {
  it('creates state with correct number of targets', () => {
    const state = createInputState();
    expect(state.targets).toHaveLength(TARGET_COUNT);
  });

  it('starts with no detected methods', () => {
    const state = createInputState();
    expect(state.detectedMethods.size).toBe(0);
  });

  it('starts at target index 0', () => {
    const state = createInputState();
    expect(state.activeTargetIndex).toBe(0);
  });

  it('all targets start as not hit', () => {
    const state = createInputState();
    expect(state.targets.every((t) => !t.hit)).toBe(true);
  });
});

describe('buildObservations', () => {
  it('builds observations from assessment states', () => {
    const inputState: InputAssessmentState = {
      detectedMethods: new Set(['keyboard', 'mouse']),
      responseTimes: [300, 400, 500],
      accuracyHits: 4,
      accuracyTotal: 5,
      targets: [],
      activeTargetIndex: 5,
      targetShownAt: 0,
    };

    const visualState: VisualAssessmentState = {
      currentSizeIndex: TEXT_SIZES.length,
      sizeResults: [false, true, true, true, true],
      currentContrastIndex: CONTRAST_LEVELS.length,
      contrastResults: [false, false, true, true, true],
      phase: 'contrast',
    };

    const audioState: AudioAssessmentState = {
      currentTestIndex: AUDIO_TESTS.length,
      results: [true, true, false],
      phase: 'done',
    };

    const obs = buildObservations(inputState, visualState, audioState);

    // Input methods detected
    expect(obs.detectedInputMethods).toContain('keyboard');
    expect(obs.detectedInputMethods).toContain('mouse');

    // Response times passed through
    expect(obs.responseTimeSamples).toEqual([300, 400, 500]);

    // Accuracy: 4/5 = 0.8
    expect(obs.inputAccuracySamples).toEqual([0.8]);

    // Visual: smallest readable is 14px (index 1)
    expect(obs.visualTrackingResults.minReadableTextSize).toBe(14);

    // Contrast: first readable is 4.5:1 (index 2)
    expect(obs.visualTrackingResults.minContrastRatio).toBe(4.5);

    // Audio: heard 2 of 3 → partial
    expect(obs.audioResponsivenessResults.hearingCapability).toBe('partial');
    expect(obs.audioResponsivenessResults.preferredAudioChannel).toBe('mono');
  });

  it('uses defaults when no accuracy data', () => {
    const inputState: InputAssessmentState = {
      detectedMethods: new Set(),
      responseTimes: [],
      accuracyHits: 0,
      accuracyTotal: 0,
      targets: [],
      activeTargetIndex: 0,
      targetShownAt: 0,
    };

    const visualState: VisualAssessmentState = {
      currentSizeIndex: 0,
      sizeResults: [],
      currentContrastIndex: 0,
      contrastResults: [],
      phase: 'size',
    };

    const audioState: AudioAssessmentState = {
      currentTestIndex: 0,
      results: [],
      phase: 'testing',
    };

    const obs = buildObservations(inputState, visualState, audioState);
    expect(obs.inputAccuracySamples).toEqual([0.8]);
    expect(obs.audioResponsivenessResults.hearingCapability).toBe('full');
  });

  it('respects skip preferences for visual and audio assessments', () => {
    const inputState: InputAssessmentState = {
      detectedMethods: new Set(['keyboard']),
      responseTimes: [400, 450],
      accuracyHits: 2,
      accuracyTotal: 2,
      targets: [],
      activeTargetIndex: 5,
      targetShownAt: 0,
    };

    const visualState: VisualAssessmentState = {
      currentSizeIndex: 1,
      sizeResults: [true],
      currentContrastIndex: 1,
      contrastResults: [true],
      phase: 'size',
    };

    const audioState: AudioAssessmentState = {
      currentTestIndex: 1,
      results: [true],
      phase: 'testing',
    };

    const obs = buildObservations(inputState, visualState, audioState, {
      skipVisualAssessment: true,
      skipAudioAssessment: true,
    });

    expect(obs.visualTrackingResults.minReadableTextSize).toBe(24);
    expect(obs.visualTrackingResults.minContrastRatio).toBe(7);
    expect(obs.audioResponsivenessResults.hearingCapability).toBe('none');
    expect(obs.cognitiveAssessment.preferredInstructionFormat).toBe('audio');
  });
});

// ---------------------------------------------------------------------------
// Constants / configuration tests
// ---------------------------------------------------------------------------

describe('OnboardingGame constants', () => {
  it('has 5 steps in the correct order', () => {
    expect(STEPS).toEqual(['welcome', 'input', 'visual', 'audio', 'results']);
  });

  it('has labels for all steps', () => {
    for (const step of STEPS) {
      expect(STEP_LABELS[step]).toBeTruthy();
    }
  });

  it('TEXT_SIZES are in ascending order', () => {
    for (let i = 1; i < TEXT_SIZES.length; i++) {
      expect(TEXT_SIZES[i]).toBeGreaterThan(TEXT_SIZES[i - 1]);
    }
  });

  it('CONTRAST_LEVELS are in ascending ratio order', () => {
    for (let i = 1; i < CONTRAST_LEVELS.length; i++) {
      expect(CONTRAST_LEVELS[i].ratio).toBeGreaterThan(CONTRAST_LEVELS[i - 1].ratio);
    }
  });

  it('AUDIO_TESTS has at least one test', () => {
    expect(AUDIO_TESTS.length).toBeGreaterThan(0);
  });

  it('TARGET_COUNT is a positive number', () => {
    expect(TARGET_COUNT).toBeGreaterThan(0);
  });
});
