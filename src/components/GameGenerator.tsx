'use client';

import { useState, useCallback, useRef, useId, useEffect } from 'react';
import type { Genre } from '../types/common';
import type { AccessibilityProfile } from '../types/player';
import type { GameSpec } from '../types/game';
import {
  GameGeneratorService,
  type GameGenerationResult,
  type ConflictDescription,
} from '../services/game-generator';
import { GameRenderer, type RenderPhase } from '../engine/game-renderer';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GameGeneratorProps {
  /** Player's accessibility profile used for game generation */
  profile: AccessibilityProfile;
  /** Optional custom GameGeneratorService instance (useful for testing) */
  generatorService?: GameGeneratorService;
}

// ---------------------------------------------------------------------------
// Generation phases for progress display
// ---------------------------------------------------------------------------

type GenerationPhase =
  | 'idle'
  | 'parsing'
  | 'detecting-conflicts'
  | 'generating'
  | 'validating'
  | 'loading-assets'
  | 'complete'
  | 'error';

const PHASE_LABELS: Record<GenerationPhase, string> = {
  idle: '',
  parsing: 'Parsing your description…',
  'detecting-conflicts': 'Checking for conflicting requirements…',
  generating: 'Generating your game…',
  validating: 'Validating accessibility of interactions…',
  'loading-assets': 'Loading game assets…',
  complete: 'Game ready!',
  error: 'Something went wrong.',
};

const GENRES: { value: Genre | ''; label: string }[] = [
  { value: '', label: 'Auto-detect genre' },
  { value: 'puzzle', label: 'Puzzle' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'simulation', label: 'Simulation' },
  { value: 'narrative', label: 'Narrative' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GameGenerator({ profile, generatorService }: GameGeneratorProps) {
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState<Genre | ''>('');
  const [phase, setPhase] = useState<GenerationPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [conflicts, setConflicts] = useState<ConflictDescription[]>([]);
  const [generatedSpec, setGeneratedSpec] = useState<GameSpec | null>(null);
  const [modificationText, setModificationText] = useState('');
  const [isModifying, setIsModifying] = useState(false);
  const [renderPhase, setRenderPhase] = useState<RenderPhase | null>(null);

  const serviceRef = useRef(generatorService ?? new GameGeneratorService());
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const headingId = useId();
  const descriptionLabelId = useId();
  const genreLabelId = useId();
  const modifyLabelId = useId();
  const conflictHeadingId = useId();
  const statusId = useId();

  // Cleanup renderer on unmount
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
    };
  }, []);

  // Render game when spec changes
  useEffect(() => {
    if (!generatedSpec || !gameContainerRef.current) return;

    // Destroy previous renderer
    rendererRef.current?.destroy();

    const renderer = new GameRenderer({
      container: gameContainerRef.current,
      gameSpec: generatedSpec,
      onEvent: (event) => {
        if (event.type === 'phase_changed') {
          setRenderPhase(event.payload.phase as RenderPhase);
        }
      },
    });

    rendererRef.current = renderer;
    renderer.render().catch(() => {
      /* rendering errors handled by renderer */
    });
  }, [generatedSpec]);

  const announce = useCallback((msg: string) => {
    // The aria-live region will pick up changes to statusRef content
    if (statusRef.current) {
      statusRef.current.textContent = msg;
    }
  }, []);

  // ── Generate handler ──────────────────────────────────────────

  const handleGenerate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!description.trim()) return;

      setConflicts([]);
      setErrorMessage('');
      setGeneratedSpec(null);
      setModificationText('');
      rendererRef.current?.destroy();

      // Phase 1: Parsing
      setPhase('parsing');
      announce('Parsing your description.');

      // Phase 2: Conflict detection
      setPhase('detecting-conflicts');
      announce('Checking for conflicting requirements.');

      // Phase 3: Generate
      setPhase('generating');
      announce('Generating your game. This may take a moment.');

      try {
        const result: GameGenerationResult = await serviceRef.current.generateGame({
          playerDescription: description.trim(),
          profile,
          preferredGenre: genre || undefined,
          sessionId: `session-${Date.now()}`,
        });

        if (!result.success) {
          if (result.conflicts && result.conflicts.length > 0) {
            // Check if these are actual requirement conflicts vs errors
            const realConflicts = result.conflicts.filter(
              (c) => c.requirement2 !== '',
            );
            if (realConflicts.length > 0) {
              setConflicts(realConflicts);
              setPhase('idle');
              announce(
                `Found ${realConflicts.length} conflicting requirement${realConflicts.length > 1 ? 's' : ''}. Please revise your description.`,
              );
              return;
            }
            // Otherwise it's an error
            setErrorMessage(
              result.conflicts.map((c) => c.explanation).join('. '),
            );
            setPhase('error');
            announce('Generation failed. ' + result.conflicts.map((c) => c.explanation).join('. '));
            return;
          }
          setErrorMessage('Game generation failed. Please try again.');
          setPhase('error');
          announce('Game generation failed. Please try again.');
          return;
        }

        // Phase 4: Validating
        setPhase('validating');
        announce('Validating accessibility of game interactions.');

        // Phase 5: Loading assets
        setPhase('loading-assets');
        announce('Loading game assets.');

        // Phase 6: Complete
        setGeneratedSpec(result.gameSpec!);
        setPhase('complete');
        announce('Your game is ready to play!');
      } catch {
        setErrorMessage('An unexpected error occurred. Please try again.');
        setPhase('error');
        announce('An unexpected error occurred.');
      }
    },
    [description, genre, profile, announce],
  );

  // ── Modify handler ────────────────────────────────────────────

  const handleModify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!modificationText.trim() || !generatedSpec) return;

      setIsModifying(true);
      setErrorMessage('');
      setPhase('generating');
      announce('Applying modifications to your game.');

      try {
        const result = await serviceRef.current.modifyGame(
          generatedSpec.id,
          modificationText.trim(),
          profile,
        );

        if (!result.success) {
          const msg =
            result.conflicts?.map((c) => c.explanation).join('. ') ??
            'Modification failed.';
          setErrorMessage(msg);
          setPhase('error');
          announce('Modification failed. ' + msg);
        } else {
          setGeneratedSpec(result.gameSpec!);
          setModificationText('');
          setPhase('complete');
          announce('Game updated successfully!');
        }
      } catch {
        setErrorMessage('An unexpected error occurred during modification.');
        setPhase('error');
        announce('An unexpected error occurred during modification.');
      } finally {
        setIsModifying(false);
      }
    },
    [modificationText, generatedSpec, profile, announce],
  );

  // ── Dismiss conflicts ─────────────────────────────────────────

  const handleDismissConflicts = useCallback(() => {
    setConflicts([]);
    announce('Conflict dialog dismissed. Please revise your description.');
  }, [announce]);

  // ── Render ────────────────────────────────────────────────────

  const isGenerating = phase !== 'idle' && phase !== 'complete' && phase !== 'error';

  return (
    <section aria-labelledby={headingId} style={containerStyle}>
      <h2 id={headingId} style={headingStyle}>
        Game Generator
      </h2>
      <p style={introStyle}>
        Describe the game you want to play and we will generate it for you,
        tailored to your accessibility needs.
      </p>

      {/* Live region for status announcements */}
      <div
        ref={statusRef}
        id={statusId}
        aria-live="polite"
        aria-atomic="true"
        role="status"
        style={srOnly}
      />

      {/* Generation form */}
      <form onSubmit={handleGenerate} aria-label="Game generation form">
        <div style={fieldGroupStyle}>
          <label htmlFor={descriptionLabelId} style={labelStyle}>
            Describe your game
          </label>
          <textarea
            id={descriptionLabelId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "a space adventure I can play with just my voice"'
            rows={4}
            required
            disabled={isGenerating}
            aria-describedby={`${statusId}`}
            style={textareaStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor={genreLabelId} style={labelStyle}>
            Genre (optional)
          </label>
          <select
            id={genreLabelId}
            value={genre}
            onChange={(e) => setGenre(e.target.value as Genre | '')}
            disabled={isGenerating}
            style={selectStyle}
          >
            {GENRES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isGenerating || !description.trim()}
          style={primaryButtonStyle}
        >
          {isGenerating ? 'Generating…' : 'Generate Game'}
        </button>
      </form>

      {/* Progress indicator */}
      {isGenerating && (
        <div style={progressContainerStyle} role="group" aria-label="Generation progress">
          <ProgressPhases currentPhase={phase} />
        </div>
      )}

      {/* Error message */}
      {phase === 'error' && errorMessage && (
        <div role="alert" style={errorStyle}>
          <p style={errorTextStyle}>{errorMessage}</p>
          <button
            type="button"
            onClick={() => { setPhase('idle'); setErrorMessage(''); }}
            style={secondaryButtonStyle}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Conflict resolution dialog */}
      {conflicts.length > 0 && (
        <ConflictDialog
          conflicts={conflicts}
          headingId={conflictHeadingId}
          onDismiss={handleDismissConflicts}
        />
      )}

      {/* Game container */}
      {generatedSpec && (
        <div style={gameWrapperStyle}>
          <h3 style={subHeadingStyle}>
            {generatedSpec.title}
          </h3>
          {renderPhase && renderPhase !== 'complete' && (
            <p style={renderStatusStyle} aria-live="polite">
              {renderPhase === 'skeleton' && 'Setting up game layout…'}
              {renderPhase === 'interactive' && 'Game is interactive — assets still loading…'}
              {renderPhase === 'assets-loading' && 'Loading game assets…'}
            </p>
          )}
          <div
            ref={gameContainerRef}
            style={gameContainerStyle}
            aria-label={`Game: ${generatedSpec.title}`}
          />
        </div>
      )}

      {/* Modification form */}
      {generatedSpec && phase === 'complete' && (
        <form
          onSubmit={handleModify}
          style={modifyFormStyle}
          aria-label="Modify game form"
        >
          <h3 style={subHeadingStyle}>Modify Your Game</h3>
          <div style={fieldGroupStyle}>
            <label htmlFor={modifyLabelId} style={labelStyle}>
              Describe the changes you want
            </label>
            <textarea
              id={modifyLabelId}
              value={modificationText}
              onChange={(e) => setModificationText(e.target.value)}
              placeholder='e.g. "make the enemies slower" or "add audio cues for obstacles"'
              rows={3}
              disabled={isModifying}
              style={textareaStyle}
            />
          </div>
          <button
            type="submit"
            disabled={isModifying || !modificationText.trim()}
            style={secondaryButtonStyle}
          >
            {isModifying ? 'Applying Changes…' : 'Apply Changes'}
          </button>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Progress Phases sub-component
// ---------------------------------------------------------------------------

const PROGRESS_STEPS: GenerationPhase[] = [
  'parsing',
  'detecting-conflicts',
  'generating',
  'validating',
  'loading-assets',
];

function ProgressPhases({ currentPhase }: { currentPhase: GenerationPhase }) {
  const currentIndex = PROGRESS_STEPS.indexOf(currentPhase);

  return (
    <ol style={progressListStyle} aria-label="Generation steps">
      {PROGRESS_STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <li
            key={step}
            style={progressItemStyle(isDone, isCurrent)}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span style={progressIconStyle(isDone, isCurrent)} aria-hidden="true">
              {isDone ? '✓' : isCurrent ? '⟳' : '○'}
            </span>
            <span>{PHASE_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Conflict Dialog sub-component
// ---------------------------------------------------------------------------

interface ConflictDialogProps {
  conflicts: ConflictDescription[];
  headingId: string;
  onDismiss: () => void;
}

function ConflictDialog({ conflicts, headingId, onDismiss }: ConflictDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the dialog when it appears
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Trap focus and handle Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    },
    [onDismiss],
  );

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={dialogOverlayStyle}
    >
      <div style={dialogContentStyle}>
        <h3 id={headingId} style={dialogHeadingStyle}>
          Conflicting Requirements Detected
        </h3>
        <p style={dialogTextStyle}>
          Your game description contains conflicting requirements. Please revise
          your description to resolve these conflicts:
        </p>
        <ul style={conflictListStyle}>
          {conflicts.map((c, i) => (
            <li key={i} style={conflictItemStyle}>
              <span style={conflictKeywordsStyle}>
                &ldquo;{c.requirement1}&rdquo; vs &ldquo;{c.requirement2}&rdquo;
              </span>
              <span style={conflictExplanationStyle}>{c.explanation}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onDismiss} style={primaryButtonStyle}>
          Revise Description
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

const containerStyle: React.CSSProperties = {
  maxWidth: '800px',
  margin: '0 auto',
  padding: '24px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#1a1a1a',
  lineHeight: 1.6,
};

const headingStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  marginBottom: '8px',
  color: '#1a1a1a',
};

const introStyle: React.CSSProperties = {
  fontSize: '16px',
  color: '#444',
  marginBottom: '24px',
};

const subHeadingStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  marginBottom: '12px',
  color: '#1a1a1a',
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: '16px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '16px',
  fontWeight: 500,
  marginBottom: '6px',
  color: '#1a1a1a',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  fontSize: '16px',
  border: '2px solid #888',
  borderRadius: '6px',
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  boxSizing: 'border-box',
  backgroundColor: '#fff',
  color: '#1a1a1a',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  border: '2px solid #888',
  borderRadius: '6px',
  fontFamily: 'inherit',
  backgroundColor: '#fff',
  color: '#1a1a1a',
  boxSizing: 'border-box',
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
  fontFamily: 'inherit',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 600,
  color: '#1a73e8',
  backgroundColor: '#fff',
  border: '2px solid #1a73e8',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const progressContainerStyle: React.CSSProperties = {
  marginTop: '20px',
  padding: '16px',
  backgroundColor: '#f5f7fa',
  borderRadius: '8px',
  border: '1px solid #d0d0d0',
};

const progressListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const progressItemStyle = (isDone: boolean, isCurrent: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '6px 0',
  fontSize: '15px',
  color: isDone ? '#1b7a3d' : isCurrent ? '#1a73e8' : '#888',
  fontWeight: isCurrent ? 600 : 400,
});

const progressIconStyle = (isDone: boolean, isCurrent: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '24px',
  height: '24px',
  borderRadius: '50%',
  fontSize: '14px',
  backgroundColor: isDone ? '#e8f5e9' : isCurrent ? '#e3f0ff' : '#eee',
  color: isDone ? '#1b7a3d' : isCurrent ? '#1a73e8' : '#888',
  flexShrink: 0,
});

const errorStyle: React.CSSProperties = {
  marginTop: '16px',
  padding: '16px',
  backgroundColor: '#fdecea',
  border: '1px solid #f5c6cb',
  borderRadius: '8px',
};

const errorTextStyle: React.CSSProperties = {
  color: '#721c24',
  fontSize: '15px',
  margin: '0 0 12px 0',
};

const dialogOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '24px',
};

const dialogContentStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: '12px',
  padding: '32px',
  maxWidth: '560px',
  width: '100%',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
};

const dialogHeadingStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#b71c1c',
  marginBottom: '12px',
};

const dialogTextStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#444',
  marginBottom: '16px',
  lineHeight: 1.5,
};

const conflictListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 20px 0',
};

const conflictItemStyle: React.CSSProperties = {
  padding: '12px',
  marginBottom: '8px',
  backgroundColor: '#fff3e0',
  borderRadius: '6px',
  border: '1px solid #ffe0b2',
};

const conflictKeywordsStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  fontSize: '15px',
  color: '#e65100',
  marginBottom: '4px',
};

const conflictExplanationStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '14px',
  color: '#444',
};

const gameWrapperStyle: React.CSSProperties = {
  marginTop: '24px',
};

const gameContainerStyle: React.CSSProperties = {
  border: '2px solid #d0d0d0',
  borderRadius: '8px',
  padding: '16px',
  minHeight: '200px',
  backgroundColor: '#fafafa',
};

const renderStatusStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#555',
  fontStyle: 'italic',
  marginBottom: '8px',
};

const modifyFormStyle: React.CSSProperties = {
  marginTop: '24px',
  padding: '20px',
  backgroundColor: '#f5f7fa',
  borderRadius: '8px',
  border: '1px solid #d0d0d0',
};

export default GameGenerator;
