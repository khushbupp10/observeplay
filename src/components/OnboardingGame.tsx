'use client';

import { useState, useCallback, useRef, useEffect, useId } from 'react';
import type { InputMethod } from '../types/common';
import type { AccessibilityProfile } from '../types/player';
import {
  computeMedian,
  type OnboardingObservations,
  type VisualTrackingResult,
  type AudioResponsivenessResult,
} from '../services/profile-learner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OnboardingStep = 'welcome' | 'input' | 'visual' | 'audio' | 'results';

const STEPS: OnboardingStep[] = ['welcome', 'input', 'visual', 'audio', 'results'];

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: 'Welcome',
  input: 'Input Detection',
  visual: 'Visual Assessment',
  audio: 'Audio Assessment',
  results: 'Review Profile',
};

export interface OnboardingGameProps {
  /** Called when onboarding completes with the collected observations */
  onGenerateProfile: (observations: OnboardingObservations) => Promise<AccessibilityProfile>;
  /** Called when the player confirms the final profile */
  onSaveProfile: (profile: AccessibilityProfile) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface InputAssessmentState {
  detectedMethods: Set<InputMethod>;
  responseTimes: number[];
  accuracyHits: number;
  accuracyTotal: number;
  targets: TargetItem[];
  activeTargetIndex: number;
  targetShownAt: number;
}

interface TargetItem {
  id: number;
  label: string;
  hit: boolean;
}

interface VisualAssessmentState {
  currentSizeIndex: number;
  sizeResults: boolean[];
  currentContrastIndex: number;
  contrastResults: boolean[];
  phase: 'size' | 'contrast';
}

interface AudioAssessmentState {
  currentTestIndex: number;
  results: boolean[];
  phase: 'testing' | 'done';
}

interface OnboardingPreferences {
  skipVisualAssessment: boolean;
  skipAudioAssessment: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_COUNT = 5;
const TEXT_SIZES = [12, 14, 16, 20, 24];
const CONTRAST_LEVELS = [
  { ratio: 2.0, fg: '#999', bg: '#ccc', label: 'Low contrast (2:1)' },
  { ratio: 3.0, fg: '#666', bg: '#ccc', label: 'Medium-low contrast (3:1)' },
  { ratio: 4.5, fg: '#444', bg: '#ddd', label: 'Standard contrast (4.5:1)' },
  { ratio: 7.0, fg: '#222', bg: '#eee', label: 'High contrast (7:1)' },
  { ratio: 12.0, fg: '#111', bg: '#f5f5f5', label: 'Very high contrast (12:1)' },
];
const AUDIO_TESTS = [
  { frequency: 440, label: 'Mid-range tone (440 Hz)' },
  { frequency: 200, label: 'Low tone (200 Hz)' },
  { frequency: 1000, label: 'High tone (1000 Hz)' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingGame({ onGenerateProfile, onSaveProfile }: OnboardingGameProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [generatedProfile, setGeneratedProfile] = useState<AccessibilityProfile | null>(null);
  const [profileOverrides, setProfileOverrides] = useState<Partial<AccessibilityProfile>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [assessmentPrefs, setAssessmentPrefs] = useState<OnboardingPreferences>({
    skipVisualAssessment: false,
    skipAudioAssessment: false,
  });

  // Input assessment state
  const [inputState, setInputState] = useState<InputAssessmentState>(() => createInputState());
  // Visual assessment state
  const [visualState, setVisualState] = useState<VisualAssessmentState>(() => ({
    currentSizeIndex: 0,
    sizeResults: [],
    currentContrastIndex: 0,
    contrastResults: [],
    phase: 'size',
  }));
  // Audio assessment state
  const [audioState, setAudioState] = useState<AudioAssessmentState>(() => ({
    currentTestIndex: 0,
    results: [],
    phase: 'testing',
  }));

  const liveRegionRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const progressId = useId();

  const announce = useCallback((message: string) => {
    setStatusMessage(message);
  }, []);

  const goToStep = useCallback((step: OnboardingStep) => {
    setCurrentStep(step);
    // Focus the main heading on step change
    setTimeout(() => {
      mainRef.current?.focus();
    }, 100);
  }, []);

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(currentStep);
    if (idx > 0) {
      goToStep(STEPS[idx - 1]);
      announce(`Returned to ${STEP_LABELS[STEPS[idx - 1]]}`);
    }
  }, [currentStep, goToStep, announce]);

  // ── Input detection handlers ──────────────────────────────────

  const recordInputMethod = useCallback((method: InputMethod) => {
    setInputState((prev) => {
      const next = { ...prev, detectedMethods: new Set(prev.detectedMethods) };
      next.detectedMethods.add(method);
      return next;
    });
  }, []);

  const handleTargetActivation = useCallback((targetIndex: number) => {
    const now = Date.now();
    setInputState((prev) => {
      if (targetIndex !== prev.activeTargetIndex) return prev;
      const responseTime = prev.targetShownAt > 0 ? now - prev.targetShownAt : 500;
      const newTargets = [...prev.targets];
      newTargets[targetIndex] = { ...newTargets[targetIndex], hit: true };
      const nextIndex = targetIndex + 1;
      return {
        ...prev,
        responseTimes: [...prev.responseTimes, responseTime],
        accuracyHits: prev.accuracyHits + 1,
        accuracyTotal: prev.accuracyTotal + 1,
        targets: newTargets,
        activeTargetIndex: nextIndex,
        targetShownAt: now,
      };
    });
  }, []);

  const handleTargetMiss = useCallback(() => {
    setInputState((prev) => ({
      ...prev,
      accuracyTotal: prev.accuracyTotal + 1,
    }));
  }, []);

  // ── Visual assessment handlers ────────────────────────────────

  const handleVisualResponse = useCallback((canSee: boolean) => {
    setVisualState((prev) => {
      if (prev.phase === 'size') {
        const newSizeResults = [...prev.sizeResults, canSee];
        const nextSizeIndex = prev.currentSizeIndex + 1;
        if (nextSizeIndex >= TEXT_SIZES.length) {
          return { ...prev, sizeResults: newSizeResults, currentSizeIndex: nextSizeIndex, phase: 'contrast' };
        }
        return { ...prev, sizeResults: newSizeResults, currentSizeIndex: nextSizeIndex };
      }
      const newContrastResults = [...prev.contrastResults, canSee];
      const nextContrastIndex = prev.currentContrastIndex + 1;
      return { ...prev, contrastResults: newContrastResults, currentContrastIndex: nextContrastIndex };
    });
  }, []);

  // ── Audio assessment handlers ─────────────────────────────────

  const handleAudioResponse = useCallback((canHear: boolean) => {
    setAudioState((prev) => {
      const newResults = [...prev.results, canHear];
      const nextIndex = prev.currentTestIndex + 1;
      if (nextIndex >= AUDIO_TESTS.length) {
        return { ...prev, results: newResults, currentTestIndex: nextIndex, phase: 'done' };
      }
      return { ...prev, results: newResults, currentTestIndex: nextIndex };
    });
  }, []);

  // ── Step completion & profile generation ──────────────────────

  const handleCompleteOnboarding = useCallback(async (
    options?: Partial<OnboardingPreferences>,
  ) => {
    setIsProcessing(true);
    announce('Generating your accessibility profile…');

    const effectivePrefs: OnboardingPreferences = {
      ...assessmentPrefs,
      ...options,
    };
    const observations = buildObservations(inputState, visualState, audioState, effectivePrefs);
    try {
      const profile = await onGenerateProfile(observations);
      setGeneratedProfile(profile);
      setProfileOverrides({});
      goToStep('results');
      announce('Your accessibility profile is ready for review.');
    } catch {
      announce('Failed to generate profile. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [inputState, visualState, audioState, assessmentPrefs, onGenerateProfile, goToStep, announce]);

  const handleStartAssessment = useCallback(() => {
    goToStep('input');
    const skipBits: string[] = [];
    if (assessmentPrefs.skipVisualAssessment) skipBits.push('visual');
    if (assessmentPrefs.skipAudioAssessment) skipBits.push('audio');
    announce(
      skipBits.length > 0
        ? `Starting input detection. ${skipBits.join(' and ')} assessment${skipBits.length > 1 ? 's' : ''} will be skipped.`
        : 'Starting input detection. Activate the targets as they appear.',
    );
  }, [goToStep, assessmentPrefs, announce]);

  const handleInputComplete = useCallback(() => {
    if (assessmentPrefs.skipVisualAssessment && assessmentPrefs.skipAudioAssessment) {
      announce('Input detection complete. Skipping visual and audio checks as requested.');
      handleCompleteOnboarding({
        skipVisualAssessment: true,
        skipAudioAssessment: true,
      });
      return;
    }
    if (assessmentPrefs.skipVisualAssessment) {
      goToStep('audio');
      announce('Input detection complete. Visual assessment skipped; starting audio assessment.');
      return;
    }
    goToStep('visual');
    announce('Input detection complete. Starting visual assessment.');
  }, [assessmentPrefs, goToStep, announce, handleCompleteOnboarding]);

  const handleSkipVisualAssessment = useCallback(() => {
    setAssessmentPrefs((prev) => ({ ...prev, skipVisualAssessment: true }));
    goToStep('audio');
    announce('Visual assessment skipped. Starting audio assessment.');
  }, [goToStep, announce]);

  const handleSkipAudioAssessment = useCallback(() => {
    setAssessmentPrefs((prev) => ({ ...prev, skipAudioAssessment: true }));
    announce('Audio assessment skipped. Generating your profile now.');
    handleCompleteOnboarding({
      skipAudioAssessment: true,
      skipVisualAssessment:
        assessmentPrefs.skipVisualAssessment ||
        visualState.currentSizeIndex < TEXT_SIZES.length ||
        visualState.currentContrastIndex < CONTRAST_LEVELS.length,
    });
  }, [announce, handleCompleteOnboarding, assessmentPrefs.skipVisualAssessment, visualState.currentSizeIndex, visualState.currentContrastIndex]);

  const handleConfirmProfile = useCallback(async () => {
    if (!generatedProfile) return;
    setIsProcessing(true);
    announce('Saving your profile…');
    const manualOverrides: Record<string, unknown> = {};
    for (const key of Object.keys(profileOverrides) as (keyof AccessibilityProfile)[]) {
      if (key === 'learnedPreferences' || key === 'manualOverrides') {
        continue;
      }
      const v = profileOverrides[key];
      if (v !== undefined) {
        manualOverrides[key as string] = v;
      }
    }
    const finalProfile: AccessibilityProfile = {
      ...generatedProfile,
      ...profileOverrides,
      manualOverrides: { ...generatedProfile.manualOverrides, ...manualOverrides },
      lastUpdated: Date.now(),
    };
    try {
      await onSaveProfile(finalProfile);
      announce('Profile saved successfully! You are ready to play.');
    } catch {
      announce('Failed to save profile. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [generatedProfile, profileOverrides, onSaveProfile, announce]);

  // ── Render ────────────────────────────────────────────────────

  const stepIndex = STEPS.indexOf(currentStep);
  const canGoBack = stepIndex > 0 && currentStep !== 'results';

  return (
    <main ref={mainRef} tabIndex={-1} style={mainStyle} aria-labelledby={headingId}>
      <h1 id={headingId}>Accessibility Onboarding</h1>

      {/* Accessible progress indicator */}
      <div
        role="progressbar"
        aria-valuenow={stepIndex + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-label={`Step ${stepIndex + 1} of ${STEPS.length}: ${STEP_LABELS[currentStep]}`}
        id={progressId}
        style={progressContainerStyle}
      >
        {STEPS.map((step, i) => (
          <div key={step} style={progressStepStyle(i, stepIndex)}>
            <span style={progressDotStyle(i, stepIndex)} aria-hidden="true">
              {i < stepIndex ? '✓' : i + 1}
            </span>
            <span style={progressLabelStyle(i, stepIndex)}>{STEP_LABELS[step]}</span>
          </div>
        ))}
      </div>

      {/* Live region for announcements */}
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" role="status" style={srOnly}>
        {statusMessage}
      </div>

      {/* Visible status */}
      {statusMessage && (
        <p style={statusBannerStyle} role="presentation">{statusMessage}</p>
      )}

      {/* Back button */}
      {canGoBack && (
        <button type="button" onClick={goBack} style={backButtonStyle}>
          ← Back to {STEP_LABELS[STEPS[stepIndex - 1]]}
        </button>
      )}

      {/* Step content */}
      <section aria-label={STEP_LABELS[currentStep]}>
        {currentStep === 'welcome' && (
          <WelcomeStep
            preferences={assessmentPrefs}
            onPreferencesChange={setAssessmentPrefs}
            onStart={handleStartAssessment}
          />
        )}
        {currentStep === 'input' && (
          <InputStep
            state={inputState}
            onTargetActivation={handleTargetActivation}
            onTargetMiss={handleTargetMiss}
            onRecordInput={recordInputMethod}
            onComplete={handleInputComplete}
          />
        )}
        {currentStep === 'visual' && (
          <VisualStep
            state={visualState}
            onResponse={handleVisualResponse}
            onComplete={() => { goToStep('audio'); announce('Visual assessment complete. Starting audio assessment.'); }}
            onSkip={handleSkipVisualAssessment}
          />
        )}
        {currentStep === 'audio' && (
          <AudioStep
            state={audioState}
            onResponse={handleAudioResponse}
            onComplete={handleCompleteOnboarding}
            isProcessing={isProcessing}
            onSkip={handleSkipAudioAssessment}
          />
        )}
        {currentStep === 'results' && generatedProfile && (
          <ResultsStep
            profile={generatedProfile}
            overrides={profileOverrides}
            onOverrideChange={setProfileOverrides}
            onConfirm={handleConfirmProfile}
            isProcessing={isProcessing}
          />
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Step Components
// ---------------------------------------------------------------------------

interface WelcomeStepProps {
  preferences: OnboardingPreferences;
  onPreferencesChange: (prefs: OnboardingPreferences) => void;
  onStart: () => void;
}

function WelcomeStep({ preferences, onPreferencesChange, onStart }: WelcomeStepProps) {
  return (
    <div>
      <h2>Welcome to the Accessibility Assessment</h2>
      <p style={paragraphStyle}>
        This short interactive session will help us understand how you interact with games.
        We will observe your input methods, response times, visual preferences, and audio
        responsiveness through a series of simple activities.
      </p>
      <p style={paragraphStyle}>
        No raw recordings are stored — only the derived accessibility preferences.
        You can review and adjust everything at the end.
      </p>
      <ul style={listStyle}>
        <li>Input detection — activate targets to measure your input methods and speed</li>
        <li>Visual assessment — identify text at different sizes and contrast levels</li>
        <li>Audio assessment — respond to sounds at different frequencies</li>
        <li>Review — see your generated profile and make adjustments</li>
      </ul>
      <fieldset style={preferenceFieldsetStyle}>
        <legend style={preferenceLegendStyle}>Optional quick-start preferences</legend>
        <label style={preferenceLabelStyle}>
          <input
            type="checkbox"
            checked={preferences.skipVisualAssessment}
            onChange={(e) =>
              onPreferencesChange({
                ...preferences,
                skipVisualAssessment: e.target.checked,
              })
            }
          />
          <span> I am blind / use a screen reader — skip visual assessment</span>
        </label>
        <label style={preferenceLabelStyle}>
          <input
            type="checkbox"
            checked={preferences.skipAudioAssessment}
            onChange={(e) =>
              onPreferencesChange({
                ...preferences,
                skipAudioAssessment: e.target.checked,
              })
            }
          />
          <span> I am Deaf / hard of hearing — skip audio assessment</span>
        </label>
      </fieldset>
      <button type="button" onClick={onStart} style={primaryButtonStyle}>
        Start Assessment
      </button>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Input Step
// ---------------------------------------------------------------------------

interface InputStepProps {
  state: InputAssessmentState;
  onTargetActivation: (index: number) => void;
  onTargetMiss: () => void;
  onRecordInput: (method: InputMethod) => void;
  onComplete: () => void;
}

function InputStep({ state, onTargetActivation, onTargetMiss, onRecordInput, onComplete }: InputStepProps) {
  const allDone = state.activeTargetIndex >= TARGET_COUNT;

  const handleInteraction = useCallback(
    (index: number, event: React.MouseEvent | React.KeyboardEvent | React.TouchEvent) => {
      // Detect input method from event type
      if ('touches' in event) {
        onRecordInput('touch');
      } else if ('key' in event) {
        onRecordInput('keyboard');
      } else {
        onRecordInput('mouse');
      }
      onTargetActivation(index);
    },
    [onRecordInput, onTargetActivation],
  );

  const handleMissClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only count as miss if clicking the target area background, not a target button
      if ((e.target as HTMLElement).dataset.targetArea === 'true') {
        onTargetMiss();
      }
    },
    [onTargetMiss],
  );

  return (
    <div>
      <h2>Input Detection</h2>
      <p style={paragraphStyle}>
        Activate each target as it appears. Use any input method you prefer — keyboard, mouse,
        touch, or other assistive devices. We are measuring which methods you use and your
        response speed.
      </p>

      <p style={paragraphStyle}>
        Targets completed: {Math.min(state.activeTargetIndex, TARGET_COUNT)} of {TARGET_COUNT}
        {state.detectedMethods.size > 0 && (
          <span> — Detected inputs: {[...state.detectedMethods].join(', ')}</span>
        )}
      </p>

      {!allDone ? (
        <div
          style={targetAreaStyle}
          onClick={handleMissClick}
          data-target-area="true"
          aria-label="Target area. Activate the highlighted target."
        >
          {state.targets.map((target, i) => (
            <button
              key={target.id}
              type="button"
              disabled={i !== state.activeTargetIndex || target.hit}
              onClick={(e) => handleInteraction(i, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleInteraction(i, e);
                }
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                handleInteraction(i, e);
              }}
              style={targetButtonStyle(i === state.activeTargetIndex && !target.hit, target.hit)}
              aria-label={
                target.hit
                  ? `Target ${i + 1}: completed`
                  : i === state.activeTargetIndex
                    ? `Target ${i + 1}: activate now`
                    : `Target ${i + 1}: waiting`
              }
            >
              {target.hit ? '✓' : target.label}
            </button>
          ))}
        </div>
      ) : (
        <div>
          <p style={paragraphStyle}>
            Input detection complete.
            {state.responseTimes.length > 0 && (
              <span>
                {' '}Median response time:{' '}
                {Math.round(computeMedian(state.responseTimes))}ms.
              </span>
            )}
          </p>
          <button type="button" onClick={onComplete} style={primaryButtonStyle}>
            Continue to Visual Assessment
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual Step
// ---------------------------------------------------------------------------

interface VisualStepProps {
  state: VisualAssessmentState;
  onResponse: (canSee: boolean) => void;
  onComplete: () => void;
  onSkip: () => void;
}

function VisualStep({ state, onResponse, onComplete, onSkip }: VisualStepProps) {
  const sizesDone = state.currentSizeIndex >= TEXT_SIZES.length;
  const contrastsDone = state.currentContrastIndex >= CONTRAST_LEVELS.length;
  const allDone = sizesDone && contrastsDone;

  if (allDone) {
    return (
      <div>
        <h2>Visual Assessment</h2>
        <p style={paragraphStyle}>Visual assessment complete.</p>
        <button type="button" onClick={onComplete} style={primaryButtonStyle}>
          Continue to Audio Assessment
        </button>
      </div>
    );
  }

  if (state.phase === 'size' && !sizesDone) {
    const size = TEXT_SIZES[state.currentSizeIndex];
    return (
      <div>
        <h2>Visual Assessment — Text Size</h2>
        <p style={paragraphStyle}>
          Can you comfortably read the text below? ({state.currentSizeIndex + 1} of {TEXT_SIZES.length})
        </p>
        <div style={visualSampleStyle}>
          <p style={{ fontSize: `${size}px`, color: '#1a1a1a', margin: '16px 0' }}>
            The quick brown fox jumps over the lazy dog.
          </p>
          <p style={sampleMetaStyle}>Text size: {size}px</p>
        </div>
        <div style={buttonGroupStyle}>
          <button type="button" onClick={() => onResponse(true)} style={primaryButtonStyle}>
            Yes, I can read it
          </button>
          <button type="button" onClick={() => onResponse(false)} style={secondaryButtonStyle}>
            No, it is too small
          </button>
          <button type="button" onClick={onSkip} style={tertiaryButtonStyle}>
            Skip visual assessment
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'contrast' && !contrastsDone) {
    const contrast = CONTRAST_LEVELS[state.currentContrastIndex];
    return (
      <div>
        <h2>Visual Assessment — Contrast</h2>
        <p style={paragraphStyle}>
          Can you comfortably read the text below? ({state.currentContrastIndex + 1} of {CONTRAST_LEVELS.length})
        </p>
        <div style={{ ...visualSampleStyle, backgroundColor: contrast.bg }}>
          <p style={{ fontSize: '18px', color: contrast.fg, margin: '16px 0' }}>
            The quick brown fox jumps over the lazy dog.
          </p>
          <p style={{ ...sampleMetaStyle, color: contrast.fg }}>{contrast.label}</p>
        </div>
        <div style={buttonGroupStyle}>
          <button type="button" onClick={() => onResponse(true)} style={primaryButtonStyle}>
            Yes, I can read it
          </button>
          <button type="button" onClick={() => onResponse(false)} style={secondaryButtonStyle}>
            No, it is hard to read
          </button>
          <button type="button" onClick={onSkip} style={tertiaryButtonStyle}>
            Skip visual assessment
          </button>
        </div>
      </div>
    );
  }

  // Fallback: sizes done, move to contrast
  return (
    <div>
      <h2>Visual Assessment</h2>
      <p style={paragraphStyle}>Visual assessment complete.</p>
      <button type="button" onClick={onComplete} style={primaryButtonStyle}>
        Continue to Audio Assessment
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio Step
// ---------------------------------------------------------------------------

interface AudioStepProps {
  state: AudioAssessmentState;
  onResponse: (canHear: boolean) => void;
  onComplete: () => void;
  isProcessing: boolean;
  onSkip: () => void;
}

function AudioStep({ state, onResponse, onComplete, isProcessing, onSkip }: AudioStepProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playTone = useCallback((frequency: number) => {
    setIsPlaying(true);
    try {
      const ctx = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = ctx;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 1);
      setTimeout(() => setIsPlaying(false), 1000);
    } catch {
      setIsPlaying(false);
    }
  }, []);

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  if (state.phase === 'done' || state.currentTestIndex >= AUDIO_TESTS.length) {
    return (
      <div>
        <h2>Audio Assessment</h2>
        <p style={paragraphStyle}>Audio assessment complete.</p>
        <button type="button" onClick={onComplete} disabled={isProcessing} style={primaryButtonStyle}>
          {isProcessing ? 'Generating Profile…' : 'Generate My Profile'}
        </button>
      </div>
    );
  }

  const currentTest = AUDIO_TESTS[state.currentTestIndex];

  return (
    <div>
      <h2>Audio Assessment</h2>
      <p style={paragraphStyle}>
        Press the button to play a sound, then tell us if you could hear it.
        ({state.currentTestIndex + 1} of {AUDIO_TESTS.length})
      </p>
      <p style={sampleMetaStyle}>{currentTest.label}</p>
      <div style={buttonGroupStyle}>
        <button
          type="button"
          onClick={() => playTone(currentTest.frequency)}
          disabled={isPlaying}
          style={secondaryButtonStyle}
          aria-label={`Play ${currentTest.label}`}
        >
          {isPlaying ? 'Playing…' : 'Play Sound'}
        </button>
      </div>
      <div style={{ ...buttonGroupStyle, marginTop: '16px' }}>
        <button type="button" onClick={() => onResponse(true)} style={primaryButtonStyle}>
          Yes, I heard it
        </button>
        <button type="button" onClick={() => onResponse(false)} style={secondaryButtonStyle}>
          No, I could not hear it
        </button>
        <button type="button" onClick={onSkip} style={tertiaryButtonStyle}>
          Skip audio assessment
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Results Step
// ---------------------------------------------------------------------------

interface ResultsStepProps {
  profile: AccessibilityProfile;
  overrides: Partial<AccessibilityProfile>;
  onOverrideChange: (overrides: Partial<AccessibilityProfile>) => void;
  onConfirm: () => void;
  isProcessing: boolean;
}

function ResultsStep({ profile, overrides, onOverrideChange, onConfirm, isProcessing }: ResultsStepProps) {
  const merged = { ...profile, ...overrides };
  const headingId = useId();

  const handleFieldChange = useCallback(
    (field: keyof AccessibilityProfile, value: unknown) => {
      onOverrideChange({ ...overrides, [field]: value });
    },
    [overrides, onOverrideChange],
  );

  const audioVolumePercent = (() => {
    const v = merged.learnedPreferences?.audioVolume;
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Math.round(Math.max(0, Math.min(1, v)) * 100);
    }
    return 70;
  })();

  return (
    <div>
      <h2 id={headingId}>Your Accessibility Profile</h2>
      <p style={paragraphStyle}>
        Review the profile generated from your assessment. You can adjust any setting before
        confirming.
      </p>

      <div style={profileSectionStyle}>
        <h3>Input Capabilities</h3>
        <ProfileField
          label="Input Methods"
          value={merged.inputMethods.join(', ')}
          fieldKey="inputMethods"
        />
        <ProfileNumberField
          label="Median response time (ms)"
          value={merged.responseTimeMs}
          onChange={(v) => handleFieldChange('responseTimeMs', v)}
          min={50}
          max={10000}
        />
        <ProfileNumberField
          label="Input Accuracy"
          value={Math.round(merged.inputAccuracy * 100)}
          onChange={(v) => handleFieldChange('inputAccuracy', v / 100)}
          min={0}
          max={100}
          suffix="%"
        />
      </div>

      <div style={profileSectionStyle}>
        <h3>Visual Capabilities</h3>
        <ProfileNumberField
          label="Minimum Readable Text Size (px)"
          value={merged.minReadableTextSize}
          onChange={(v) => handleFieldChange('minReadableTextSize', v)}
          min={8}
          max={72}
        />
        <ProfileNumberField
          label="Minimum Contrast Ratio"
          value={merged.minContrastRatio}
          onChange={(v) => handleFieldChange('minContrastRatio', v)}
          min={1}
          max={21}
          step={0.5}
        />
        <ProfileSelectField
          label="Hearing Capability"
          value={merged.hearingCapability}
          options={[
            { value: 'full', label: 'Full hearing' },
            { value: 'partial', label: 'Partial hearing' },
            { value: 'none', label: 'No hearing' },
          ]}
          onChange={(v) => handleFieldChange('hearingCapability', v)}
        />
        <ProfileNumberField
          label="Audio volume (all game sounds)"
          value={audioVolumePercent}
          onChange={(v) =>
            handleFieldChange('learnedPreferences', {
              ...merged.learnedPreferences,
              audioVolume: Math.max(0, Math.min(1, v / 100)),
            })
          }
          min={0}
          max={100}
          suffix="%"
        />
      </div>

      <div style={profileSectionStyle}>
        <h3>Cognitive Preferences</h3>
        <ProfileSelectField
          label="Preferred Pacing"
          value={merged.preferredPacing}
          options={[
            { value: 'slow', label: 'Slow' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'fast', label: 'Fast' },
          ]}
          onChange={(v) => handleFieldChange('preferredPacing', v)}
        />
        <ProfileSelectField
          label="Preferred Instruction Format"
          value={merged.preferredInstructionFormat}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'audio', label: 'Audio' },
            { value: 'visual', label: 'Visual' },
            { value: 'multimodal', label: 'Multimodal' },
          ]}
          onChange={(v) => handleFieldChange('preferredInstructionFormat', v)}
        />
      </div>

      <button type="button" onClick={onConfirm} disabled={isProcessing} style={primaryButtonStyle}>
        {isProcessing ? 'Saving…' : 'Confirm Profile'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile field sub-components
// ---------------------------------------------------------------------------

function ProfileField({ label, value, fieldKey }: { label: string; value: string; fieldKey: string }) {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle} id={`field-${fieldKey}`}>{label}</span>
      <span style={fieldValueStyle} aria-labelledby={`field-${fieldKey}`}>{value}</span>
    </div>
  );
}

function ProfileNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div style={fieldRowStyle}>
      <label htmlFor={id} style={fieldLabelStyle}>
        {label}
      </label>
      <span style={fieldInputWrapStyle}>
        <input
          id={id}
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          style={numberInputStyle}
        />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </span>
    </div>
  );
}

function ProfileSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div style={fieldRowStyle}>
      <label htmlFor={id} style={fieldLabelStyle}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInputState(): InputAssessmentState {
  const targets: TargetItem[] = Array.from({ length: TARGET_COUNT }, (_, i) => ({
    id: i,
    label: `${i + 1}`,
    hit: false,
  }));
  return {
    detectedMethods: new Set(),
    responseTimes: [],
    accuracyHits: 0,
    accuracyTotal: 0,
    targets,
    activeTargetIndex: 0,
    targetShownAt: Date.now(),
  };
}

function buildObservations(
  inputState: InputAssessmentState,
  visualState: VisualAssessmentState,
  audioState: AudioAssessmentState,
  prefs: OnboardingPreferences = {
    skipVisualAssessment: false,
    skipAudioAssessment: false,
  },
): OnboardingObservations {
  // Determine minimum readable text size from visual results
  const minReadableTextSize = prefs.skipVisualAssessment
    ? 24
    : deriveMinTextSize(visualState.sizeResults);
  const minContrastRatio = prefs.skipVisualAssessment
    ? 7.0
    : deriveMinContrastRatio(visualState.contrastResults);
  const hearingCapability = prefs.skipAudioAssessment
    ? 'none'
    : deriveHearingCapability(audioState.results);

  return {
    detectedInputMethods: [...inputState.detectedMethods] as InputMethod[],
    responseTimeSamples: inputState.responseTimes,
    inputAccuracySamples:
      inputState.accuracyTotal > 0
        ? [inputState.accuracyHits / inputState.accuracyTotal]
        : [0.8],
    visualTrackingResults: {
      minReadableTextSize,
      minContrastRatio,
      colorBlindnessType: null,
      visualFieldRestriction: null,
    },
    audioResponsivenessResults: {
      hearingCapability,
      preferredAudioChannel: hearingCapability === 'full' ? 'stereo' : 'mono',
    },
    motorAssessment: {
      reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1920, y: 1080 } },
      clickPrecision: 10,
      holdDuration: 1000,
    },
    cognitiveAssessment: {
      preferredPacing: 'moderate',
      maxSimultaneousElements: 5,
      preferredInstructionFormat: prefs.skipVisualAssessment ? 'audio' : 'multimodal',
    },
  };
}

/** Find the smallest text size the player could read. */
function deriveMinTextSize(sizeResults: boolean[]): number {
  for (let i = 0; i < sizeResults.length; i++) {
    if (sizeResults[i]) return TEXT_SIZES[i];
  }
  // Default: if no sizes were readable or no data, use largest
  return TEXT_SIZES[TEXT_SIZES.length - 1];
}

/** Find the minimum contrast ratio the player could read. */
function deriveMinContrastRatio(contrastResults: boolean[]): number {
  for (let i = 0; i < contrastResults.length; i++) {
    if (contrastResults[i]) return CONTRAST_LEVELS[i].ratio;
  }
  return CONTRAST_LEVELS[CONTRAST_LEVELS.length - 1].ratio;
}

/** Derive hearing capability from audio test results. */
function deriveHearingCapability(results: boolean[]): 'full' | 'partial' | 'none' {
  if (results.length === 0) return 'full';
  const heard = results.filter(Boolean).length;
  if (heard === results.length) return 'full';
  if (heard > 0) return 'partial';
  return 'none';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const mainStyle: React.CSSProperties = {
  maxWidth: '720px',
  margin: '0 auto',
  padding: '24px 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#1a1a1a',
  lineHeight: 1.6,
  outline: 'none',
};

const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const statusBannerStyle: React.CSSProperties = {
  padding: '8px 12px',
  marginBottom: '16px',
  borderRadius: '4px',
  backgroundColor: '#e8f5e9',
  color: '#1b5e20',
  border: '1px solid #a5d6a7',
  fontSize: '14px',
};

const paragraphStyle: React.CSSProperties = {
  fontSize: '16px',
  color: '#333',
  marginBottom: '12px',
};

const listStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#444',
  marginBottom: '20px',
  paddingLeft: '24px',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 600,
  color: '#fff',
  backgroundColor: '#1a73e8',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  minWidth: '44px',
  minHeight: '44px',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 500,
  color: '#333',
  backgroundColor: '#e0e0e0',
  border: '1px solid #bbb',
  borderRadius: '6px',
  cursor: 'pointer',
  minWidth: '44px',
  minHeight: '44px',
};

const tertiaryButtonStyle: React.CSSProperties = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 500,
  color: '#1a73e8',
  backgroundColor: '#f5f9ff',
  border: '1px solid #90caf9',
  borderRadius: '6px',
  cursor: 'pointer',
  minWidth: '44px',
  minHeight: '44px',
};

const preferenceFieldsetStyle: React.CSSProperties = {
  marginBottom: '18px',
  border: '1px solid #dbe6f9',
  borderRadius: '8px',
  backgroundColor: '#f7fbff',
  padding: '12px 14px',
};

const preferenceLegendStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#1a73e8',
  padding: '0 6px',
};

const preferenceLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '14px',
  color: '#333',
  marginBottom: '8px',
};

const backButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '14px',
  color: '#1a73e8',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  marginBottom: '12px',
  textDecoration: 'underline',
};

const buttonGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  marginTop: '12px',
};

const progressContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '24px',
  padding: '12px 0',
  borderBottom: '1px solid #ddd',
};

const progressStepStyle = (index: number, currentIndex: number): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '4px',
  flex: 1,
  opacity: index <= currentIndex ? 1 : 0.5,
});

const progressDotStyle = (index: number, currentIndex: number): React.CSSProperties => ({
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
  fontWeight: 600,
  color: index <= currentIndex ? '#fff' : '#666',
  backgroundColor: index < currentIndex ? '#2e7d32' : index === currentIndex ? '#1a73e8' : '#ccc',
});

const progressLabelStyle = (index: number, currentIndex: number): React.CSSProperties => ({
  fontSize: '12px',
  fontWeight: index === currentIndex ? 600 : 400,
  color: index <= currentIndex ? '#1a1a1a' : '#888',
  textAlign: 'center',
});

const targetAreaStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '16px',
  padding: '24px',
  border: '2px solid #ddd',
  borderRadius: '8px',
  backgroundColor: '#fafafa',
  minHeight: '120px',
  justifyContent: 'center',
  alignItems: 'center',
};

const targetButtonStyle = (isActive: boolean, isHit: boolean): React.CSSProperties => ({
  width: '64px',
  height: '64px',
  borderRadius: '8px',
  fontSize: '20px',
  fontWeight: 700,
  border: isActive ? '3px solid #1a73e8' : '2px solid #ccc',
  backgroundColor: isHit ? '#c8e6c9' : isActive ? '#e3f2fd' : '#f5f5f5',
  color: isHit ? '#2e7d32' : isActive ? '#1a73e8' : '#999',
  cursor: isActive ? 'pointer' : 'default',
  transition: 'all 0.15s ease',
  minWidth: '44px',
  minHeight: '44px',
});

const visualSampleStyle: React.CSSProperties = {
  padding: '24px',
  border: '1px solid #ddd',
  borderRadius: '8px',
  marginBottom: '16px',
  backgroundColor: '#fff',
};

const sampleMetaStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
  fontStyle: 'italic',
};

const profileSectionStyle: React.CSSProperties = {
  marginBottom: '24px',
  padding: '16px',
  border: '1px solid #ddd',
  borderRadius: '8px',
  backgroundColor: '#fafafa',
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 0',
  borderBottom: '1px solid #eee',
  gap: '12px',
  flexWrap: 'wrap',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: '#333',
  minWidth: '180px',
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#555',
};

const fieldInputWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

const numberInputStyle: React.CSSProperties = {
  width: '80px',
  padding: '6px 8px',
  fontSize: '14px',
  border: '1px solid #ccc',
  borderRadius: '4px',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: '14px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  minWidth: '120px',
};

export default OnboardingGame;

// Exported for testing
export {
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
};
export type {
  InputAssessmentState,
  VisualAssessmentState,
  AudioAssessmentState,
};
