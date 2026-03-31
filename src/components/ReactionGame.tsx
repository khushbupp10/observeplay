'use client';

import { useState, useCallback, useEffect, useRef, useId } from 'react';
import type { AccessibilityProfile } from '../types/player';

export interface ReactionGameProps {
  profile: AccessibilityProfile;
  onGameComplete?: (score: number, timeMs: number) => void;
}

interface Target {
  id: number;
  position: number; // 0-5 grid position
  color: string;
  spawnedAt: number;
}

const GRID_COLS = 3;
const GRID_ROWS = 2;
const GRID_POSITIONS = GRID_COLS * GRID_ROWS; // 6 positions
const COLORS_NORMAL = ['#e53935', '#43a047', '#1e88e5', '#fb8c00', '#8e24aa', '#00acc1'];
const COLORS_HIGH_CONTRAST = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
const GAME_DURATION_MS = 30000;

function getAdaptations(profile: AccessibilityProfile) {
  const isRelaxedMode = profile.preferredPacing === 'slow' ||
    profile.preferredInstructionFormat === 'text' ||
    profile.hearingCapability === 'none';
  const targetSize = Math.max(60, profile.clickPrecision * 6, profile.minReadableTextSize * 3);
  const displayDurationMs =
    isRelaxedMode ? 0
    : profile.responseTimeMs > 800 ? 2200
    : 1500;
  const spawnIntervalMs =
    isRelaxedMode ? 0
    : profile.responseTimeMs > 800 ? 1500
    : 1000;
  const maxSimultaneous = Math.min(profile.maxSimultaneousElements, profile.preferredPacing === 'slow' ? 1 : 3);
  const highContrast = profile.minContrastRatio > 4.5;
  const audioEnabled = profile.hearingCapability !== 'none';
  const enhancedVisual = profile.hearingCapability === 'none' || profile.hearingCapability === 'partial';
  return { targetSize, displayDurationMs, spawnIntervalMs, maxSimultaneous, highContrast, audioEnabled, enhancedVisual, isRelaxedMode };
}

function createSoundEngine() {
  let ctx: AudioContext | null = null;
  function getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
    return ctx;
  }
  function playTone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.25) {
    const c = getCtx(); if (!c) return;
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, c.currentTime);
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur / 1000);
    osc.connect(gain); gain.connect(c.destination); osc.start(); osc.stop(c.currentTime + dur / 1000);
  }
  return {
    appear() { playTone(880, 80, 'sine', 0.15); },
    hit() { playTone(523, 120, 'sine', 0.3); setTimeout(() => playTone(659, 150, 'sine', 0.25), 80); },
    miss() { playTone(220, 200, 'triangle', 0.15); },
    end() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 250, 'sine', 0.2), i * 120)); },
    cleanup() { ctx?.close().catch(() => {}); ctx = null; },
  };
}

interface SoundEvent { id: number; text: string; }

export function ReactionGame({ profile, onGameComplete }: ReactionGameProps) {
  const adapt = getAdaptations(profile);
  const colors = adapt.highContrast ? COLORS_HIGH_CONTRAST : COLORS_NORMAL;

  const [targets, setTargets] = useState<Target[]>([]);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [reactionTimes, setReactionTimes] = useState<number[]>([]);
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'done'>('idle');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_MS);
  const [statusMessage, setStatusMessage] = useState('');
  const [flashEffect, setFlashEffect] = useState<'hit' | 'miss' | null>(null);
  const [soundEvents, setSoundEvents] = useState<SoundEvent[]>([]);
  const soundEventIdRef = useRef(0);

  const startTimeRef = useRef(0);
  const nextIdRef = useRef(0);
  const spawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);
  const headingId = useId();
  const statusId = useId();

  const addSoundEvent = useCallback((text: string) => {
    setSoundEvents(prev => [...prev, { id: soundEventIdRef.current++, text }].slice(-5));
  }, []);

  useEffect(() => {
    if (adapt.audioEnabled) soundRef.current = createSoundEngine();
    return () => { soundRef.current?.cleanup(); soundRef.current = null; };
  }, [adapt.audioEnabled]);

  useEffect(() => {
    if (flashEffect) {
      const t = setTimeout(() => setFlashEffect(null), 400);
      return () => clearTimeout(t);
    }
  }, [flashEffect]);

  // Remove expired targets (disabled in relaxed mode — targets stay until clicked)
  useEffect(() => {
    if (gameState !== 'playing' || adapt.isRelaxedMode || adapt.displayDurationMs === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setTargets(prev => {
        const expired = prev.filter(t => now - t.spawnedAt > adapt.displayDurationMs);
        if (expired.length > 0) {
          setMisses(m => m + expired.length);
          if (adapt.audioEnabled) { soundRef.current?.miss(); }
          else { addSoundEvent('🔊 Miss buzz'); }
          if (adapt.enhancedVisual) setFlashEffect('miss');
          const posNames = expired.map(t => t.position + 1).join(', ');
          setStatusMessage(`Missed target${expired.length > 1 ? 's' : ''} at position ${posNames}!`);
        }
        return prev.filter(t => now - t.spawnedAt <= adapt.displayDurationMs);
      });
    }, 200);
    return () => clearInterval(interval);
  }, [gameState, adapt.displayDurationMs, adapt.audioEnabled, adapt.enhancedVisual, adapt.isRelaxedMode, addSoundEvent]);

  const spawnTarget = useCallback(() => {
    setTargets(prev => {
      if (prev.length >= adapt.maxSimultaneous) return prev;
      const occupied = new Set(prev.map(t => t.position));
      const available = Array.from({ length: GRID_POSITIONS }, (_, i) => i).filter(i => !occupied.has(i));
      if (available.length === 0) return prev;
      const position = available[Math.floor(Math.random() * available.length)];
      const t: Target = {
        id: nextIdRef.current++,
        position,
        color: colors[Math.floor(Math.random() * colors.length)],
        spawnedAt: Date.now(),
      };
      if (adapt.audioEnabled) { soundRef.current?.appear(); }
      else { addSoundEvent(`🔊 Target pop at position ${position + 1}`); }
      setStatusMessage(`Target in position ${position + 1}! Press ${position + 1} to hit.`);
      return [...prev, t];
    });
  }, [adapt.maxSimultaneous, adapt.audioEnabled, colors, addSoundEvent]);

  const RELAXED_TARGET_COUNT = 10;

  const startGame = useCallback(() => {
    setScore(0); setMisses(0); setReactionTimes([]); setTargets([]);
    setGameState('playing'); setTimeLeft(adapt.isRelaxedMode ? 0 : GAME_DURATION_MS);
    startTimeRef.current = Date.now(); nextIdRef.current = 0;
    setSoundEvents([]);
    if (adapt.isRelaxedMode) {
      setStatusMessage(`Relaxed mode! Hit ${RELAXED_TARGET_COUNT} targets at your own pace. No time limit.`);
      spawnTarget();
    } else {
      setStatusMessage('Game started! Hit targets by clicking or pressing number keys 1-6.');
      spawnTimerRef.current = setInterval(spawnTarget, adapt.spawnIntervalMs);
      tickTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        const left = Math.max(0, GAME_DURATION_MS - elapsed);
        setTimeLeft(left);
        if (left <= 0) setGameState('done');
      }, 100);
    }
  }, [spawnTarget, adapt.spawnIntervalMs, adapt.isRelaxedMode]);

  useEffect(() => {
    if (gameState === 'done') {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      setTargets([]);
      const totalMs = Date.now() - startTimeRef.current;
      setStatusMessage(`Game over! You hit ${score} targets with average reaction ${avgReactionCalc(reactionTimes)}ms.`);
      if (adapt.audioEnabled) { soundRef.current?.end(); }
      else { addSoundEvent('🔊 Game over fanfare'); }
      onGameComplete?.(score, totalMs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  useEffect(() => {
    return () => {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    };
  }, []);

  const handleHit = useCallback((position: number) => {
    setTargets(prev => {
      const t = prev.find(x => x.position === position);
      if (!t) return prev;
      const rt = Date.now() - t.spawnedAt;
      setReactionTimes(rts => [...rts, rt]);
      setScore(s => {
        const newScore = s + 1;
        if (adapt.isRelaxedMode && newScore >= RELAXED_TARGET_COUNT) {
          setGameState('done');
        }
        return newScore;
      });
      if (adapt.audioEnabled) { soundRef.current?.hit(); }
      else { addSoundEvent(`🔊 Hit chime at position ${position + 1}`); }
      setFlashEffect('hit');
      setStatusMessage(`Hit at position ${position + 1}! Reaction: ${rt}ms.`);
      if (adapt.isRelaxedMode) {
        setTimeout(() => spawnTarget(), 500);
      }
      return prev.filter(x => x.id !== t.id);
    });
  }, [adapt.audioEnabled, adapt.isRelaxedMode, addSoundEvent, spawnTarget]);

  // Keyboard handler for number keys
  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (gameState !== 'playing') return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= GRID_POSITIONS) {
      e.preventDefault();
      handleHit(num - 1);
    }
  }, [gameState, handleHit]);

  const avgReaction = reactionTimes.length > 0
    ? Math.round(reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length)
    : 0;

  const hasTarget = (pos: number) => targets.find(t => t.position === pos);

  return (
    <section aria-labelledby={headingId} style={{ maxWidth: '600px', margin: '0 auto' }}>
      <style>{`
        @keyframes reactionPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes reactionRipple {
          0% { box-shadow: 0 0 0 0 rgba(233,57,53,0.3); }
          100% { box-shadow: 0 0 0 20px rgba(233,57,53,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .reaction-start-btn { animation: none !important; }
          .reaction-target { animation: none !important; }
        }
      `}</style>

      <h2 id={headingId} style={{ fontSize: '24px', marginBottom: '8px', color: '#1a1a1a' }}>Reaction Speed</h2>
      <p style={{ fontSize: '15px', color: '#555', marginBottom: '16px' }}>
        Hit targets as they appear in the grid. Click the position or press number keys 1-6.
      </p>
      <div id={statusId} aria-live="assertive" aria-atomic="true" role="status" style={srOnly}>{statusMessage}</div>

      {adapt.enhancedVisual && flashEffect && (
        <div aria-hidden="true" style={{
          padding: '6px 12px', marginBottom: '8px', borderRadius: '4px', textAlign: 'center',
          fontWeight: 600, fontSize: '14px',
          backgroundColor: flashEffect === 'hit' ? '#e8f5e9' : '#fdecea',
          color: flashEffect === 'hit' ? '#2e7d32' : '#c62828',
          border: `2px solid ${flashEffect === 'hit' ? '#4caf50' : '#f44336'}`,
        }}>
          {flashEffect === 'hit' ? '✅ Hit!' : '❌ Missed!'}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '15px', color: '#333', flexWrap: 'wrap' }}>
        <span>Hits: <strong>{score}</strong></span>
        <span>Misses: <strong>{misses}</strong></span>
        <span>Avg Reaction: <strong>{avgReaction}ms</strong></span>
        <span>Time: <strong>{adapt.isRelaxedMode ? 'No limit' : `${Math.ceil(timeLeft / 1000)}s`}</strong></span>
      </div>

      {gameState === 'idle' && (
        <button
          type="button"
          className="reaction-start-btn"
          onClick={startGame}
          style={{
            padding: '16px 40px', fontSize: '20px', fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #e53935, #8e24aa)',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            animation: 'reactionPulse 2s ease-in-out infinite',
            marginBottom: '16px',
          }}
        >
          ⚡ Start Game
        </button>
      )}

      {gameState === 'done' && (
        <div style={{ padding: '16px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#e8f5e9', border: '2px solid #4caf50', textAlign: 'center' }}>
          <p style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32', margin: '0 0 8px 0' }}>🎯 Game Over!</p>
          <p style={{ fontSize: '15px', color: '#333', margin: '0 0 4px 0' }}>Hits: {score} | Misses: {misses} | Avg Reaction: {avgReaction}ms</p>
          <button type="button" onClick={startGame} style={{ ...actionBtnStyle, marginTop: '12px' }}>Play Again</button>
        </div>
      )}

      {/* Numbered grid — accessible for blind players via number keys */}
      <div
        role="grid"
        aria-label={`Reaction game grid, ${GRID_COLS} columns by ${GRID_ROWS} rows. Press number keys 1-6 to hit targets by position.`}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gap: '12px',
          marginBottom: '20px',
          padding: '16px',
          borderRadius: '12px',
          backgroundColor: adapt.highContrast ? '#000' : '#f0f4f8',
          border: `2px solid ${adapt.highContrast ? '#fff' : '#ccc'}`,
          position: 'relative',
          outline: 'none',
          backgroundImage: gameState === 'playing'
            ? 'radial-gradient(circle, rgba(233,57,53,0.03) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(142,36,170,0.03) 0%, transparent 50%)'
            : 'none',
        }}
      >
        {Array.from({ length: GRID_POSITIONS }, (_, pos) => {
          const target = hasTarget(pos);
          return (
            <button
              key={pos}
              type="button"
              role="gridcell"
              onClick={() => handleHit(pos)}
              disabled={gameState !== 'playing'}
              aria-label={target
                ? `Position ${pos + 1}: Target! Press ${pos + 1} or click to hit.`
                : `Position ${pos + 1}: Empty.`
              }
              className={target ? 'reaction-target' : ''}
              style={{
                width: '100%',
                aspectRatio: '1',
                maxWidth: `${adapt.targetSize + 40}px`,
                minHeight: '80px',
                borderRadius: '50%',
                backgroundColor: target
                  ? target.color
                  : (adapt.highContrast ? '#1a1a1a' : '#e8e8e8'),
                border: target
                  ? `3px solid ${adapt.highContrast ? '#fff' : 'rgba(0,0,0,0.2)'}`
                  : `2px dashed ${adapt.highContrast ? '#555' : '#ccc'}`,
                cursor: gameState === 'playing' && target ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                outline: 'none',
                animation: target ? 'reactionRipple 1s ease-out infinite' : 'none',
                transition: 'background-color 0.15s ease',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: '16px', fontWeight: 700,
                  color: target ? '#fff' : (adapt.highContrast ? '#888' : '#999'),
                }}
              >
                {pos + 1}
              </span>
              {target && (
                <span aria-hidden="true" style={{ fontSize: '10px', color: '#fff', opacity: 0.8, marginTop: '2px' }}>
                  HIT!
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sound Transcript panel for deaf players */}
      {profile.hearingCapability === 'none' && soundEvents.length > 0 && (
        <div role="log" aria-label="Sound transcript" aria-live="polite" style={{
          marginTop: '16px', padding: '10px 14px', borderRadius: '8px',
          backgroundColor: '#f5f5f5', border: '1px solid #e0e0e0',
          maxHeight: '120px', overflowY: 'auto',
        }}>
          <p style={{ fontSize: '12px', fontWeight: 600, color: '#666', margin: '0 0 6px 0' }}>Sound Transcript</p>
          {soundEvents.map(ev => (
            <p key={ev.id} style={{ fontSize: '13px', color: '#333', margin: '2px 0' }}>{ev.text}</p>
          ))}
        </div>
      )}

      <details style={{ marginTop: '16px', fontSize: '13px', color: '#666' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Accessibility Adaptations Applied</summary>
        <ul style={{ marginTop: '8px', paddingLeft: '20px', lineHeight: 1.8 }}>
          <li>Grid: {GRID_COLS}×{GRID_ROWS} numbered positions (keyboard accessible via 1-6)</li>
          <li>Target display duration: {adapt.isRelaxedMode ? 'No limit — targets stay until clicked' : `${adapt.displayDurationMs}ms`}</li>
          <li>Spawn interval: {adapt.spawnIntervalMs}ms</li>
          <li>Max simultaneous: {adapt.maxSimultaneous}</li>
          <li>High contrast: {adapt.highContrast ? 'Yes' : 'No'}</li>
          <li>Audio: {adapt.audioEnabled ? 'Enabled' : 'Disabled — visual feedback active'}</li>
          <li>Screen reader: Positions announced via aria-live</li>
        </ul>
      </details>
    </section>
  );
}

function avgReactionCalc(times: number[]): number {
  if (times.length === 0) return 0;
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}

const srOnly: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};

const actionBtnStyle: React.CSSProperties = {
  padding: '12px 24px', fontSize: '16px', fontWeight: 600, color: '#fff',
  backgroundColor: '#1a73e8', border: 'none', borderRadius: '6px', cursor: 'pointer',
};

export default ReactionGame;
