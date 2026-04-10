'use client';

import { useState, useCallback, useEffect, useRef, useId } from 'react';
import type { AccessibilityProfile } from '../types/player';
import { getProfileAudioVolume } from '../utils/audio-volume';

export interface WhackAMoleProps {
  profile: AccessibilityProfile;
  onGameComplete?: (score: number, timeMs: number) => void;
}

const GAME_DURATION_MS = 30000;

function getAdaptations(profile: AccessibilityProfile) {
  const gridSize =
    profile.preferredPacing === 'slow' || profile.maxSimultaneousElements <= 3 ? 2
    : profile.maxSimultaneousElements <= 5 ? 3
    : 3;
  const moleDurationMs =
    profile.preferredPacing === 'slow' ? 4000
    : profile.responseTimeMs > 800 ? 3000
    : 2000;
  const spawnIntervalMs =
    profile.preferredPacing === 'slow' ? 3000
    : profile.responseTimeMs > 800 ? 2000
    : 1500;
  const holeSize = Math.max(100, profile.clickPrecision * 10, profile.minReadableTextSize * 5);
  const isRelaxedMode = profile.preferredPacing === 'slow' ||
    profile.preferredInstructionFormat === 'text' ||
    profile.hearingCapability === 'none';
  const highContrast = profile.minContrastRatio > 4.5;
  const audioEnabled = profile.hearingCapability !== 'none';
  const enhancedVisual = profile.hearingCapability === 'none' || profile.hearingCapability === 'partial';
  return { gridSize, moleDurationMs: isRelaxedMode ? 0 : moleDurationMs, spawnIntervalMs: isRelaxedMode ? 0 : spawnIntervalMs, holeSize, highContrast, audioEnabled, enhancedVisual, isRelaxedMode };
}

function createSoundEngine(masterVolume = 1) {
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
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, vol * masterVolume)), c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur / 1000);
    osc.connect(gain); gain.connect(c.destination); osc.start(); osc.stop(c.currentTime + dur / 1000);
  }
  return {
    pop() { playTone(600, 80, 'sine', 0.15); },
    whack() { playTone(150, 100, 'square', 0.2); setTimeout(() => playTone(100, 80, 'square', 0.15), 50); },
    miss() { playTone(220, 200, 'triangle', 0.1); },
    end() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 250, 'sine', 0.2), i * 120)); },
    cleanup() { ctx?.close().catch(() => {}); ctx = null; },
  };
}

interface Mole {
  holeIdx: number;
  spawnedAt: number;
  id: number;
}

interface SoundEvent { id: number; text: string; }

export function WhackAMole({ profile, onGameComplete }: WhackAMoleProps) {
  const adapt = getAdaptations(profile);
  const audioVolume = getProfileAudioVolume(profile);
  const totalHoles = adapt.gridSize * adapt.gridSize;

  const [moles, setMoles] = useState<Mole[]>([]);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'done'>('idle');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_MS);
  const [statusMessage, setStatusMessage] = useState('');
  const [flashEffect, setFlashEffect] = useState<'whack' | 'miss' | null>(null);
  const [bounceHole, setBounceHole] = useState<number | null>(null);
  const [focusedHole, setFocusedHole] = useState(0);
  const [soundEvents, setSoundEvents] = useState<SoundEvent[]>([]);
  const soundEventIdRef = useRef(0);

  const startTimeRef = useRef(0);
  const nextIdRef = useRef(0);
  const spawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const statusId = useId();

  const addSoundEvent = useCallback((text: string) => {
    setSoundEvents(prev => [...prev, { id: soundEventIdRef.current++, text }].slice(-5));
  }, []);

  useEffect(() => {
    if (adapt.audioEnabled) soundRef.current = createSoundEngine(audioVolume);
    return () => { soundRef.current?.cleanup(); soundRef.current = null; };
  }, [adapt.audioEnabled, audioVolume]);

  useEffect(() => {
    if (flashEffect) {
      const t = setTimeout(() => setFlashEffect(null), 400);
      return () => clearTimeout(t);
    }
  }, [flashEffect]);

  useEffect(() => {
    if (bounceHole !== null) {
      const t = setTimeout(() => setBounceHole(null), 300);
      return () => clearTimeout(t);
    }
  }, [bounceHole]);

  // Remove expired moles (disabled in relaxed mode — moles stay until whacked)
  useEffect(() => {
    if (gameState !== 'playing' || adapt.isRelaxedMode || adapt.moleDurationMs === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setMoles(prev => {
        const expired = prev.filter(m => now - m.spawnedAt > adapt.moleDurationMs);
        if (expired.length > 0) {
          setMisses(m => m + expired.length);
          if (adapt.audioEnabled) { soundRef.current?.miss(); }
          else { addSoundEvent('🔊 Mole escape'); }
          for (const m of expired) {
            setStatusMessage(`Mole in hole ${m.holeIdx + 1} escaped.`);
          }
        }
        return prev.filter(m => now - m.spawnedAt <= adapt.moleDurationMs);
      });
    }, 200);
    return () => clearInterval(interval);
  }, [gameState, adapt.moleDurationMs, adapt.audioEnabled, adapt.isRelaxedMode, addSoundEvent]);

  const spawnMole = useCallback(() => {
    setMoles(prev => {
      const occupiedHoles = new Set(prev.map(m => m.holeIdx));
      const available = Array.from({ length: totalHoles }, (_, i) => i).filter(i => !occupiedHoles.has(i));
      if (available.length === 0) return prev;
      const holeIdx = available[Math.floor(Math.random() * available.length)];
      if (adapt.audioEnabled) { soundRef.current?.pop(); }
      else { addSoundEvent(`🔊 Mole pop at hole ${holeIdx + 1}`); }
      setBounceHole(holeIdx);
      setStatusMessage(`Mole in hole ${holeIdx + 1}! Press ${holeIdx + 1} to whack.`);
      return [...prev, { holeIdx, spawnedAt: Date.now(), id: nextIdRef.current++ }];
    });
  }, [totalHoles, adapt.audioEnabled, addSoundEvent]);

  const RELAXED_MOLE_COUNT = 10;

  const startGame = useCallback(() => {
    setScore(0); setMisses(0); setMoles([]);
    setGameState('playing'); setTimeLeft(adapt.isRelaxedMode ? 0 : GAME_DURATION_MS);
    startTimeRef.current = Date.now(); nextIdRef.current = 0;
    setFocusedHole(0); setSoundEvents([]);
    if (adapt.isRelaxedMode) {
      setStatusMessage(`Relaxed mode! Whack ${RELAXED_MOLE_COUNT} moles at your own pace. No time limit.`);
      spawnMole();
    } else {
      setStatusMessage('Whack the moles! Use number keys or arrow keys to navigate and Enter to whack.');
      spawnTimerRef.current = setInterval(spawnMole, adapt.spawnIntervalMs);
      tickTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        const left = Math.max(0, GAME_DURATION_MS - elapsed);
        setTimeLeft(left);
        if (left <= 0) setGameState('done');
      }, 100);
    }
  }, [spawnMole, adapt.spawnIntervalMs, adapt.isRelaxedMode]);

  useEffect(() => {
    if (gameState === 'done') {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      setMoles([]);
      const totalMs = Date.now() - startTimeRef.current;
      setStatusMessage(`Game over! You whacked ${score} moles and missed ${misses}.`);
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

  const handleWhack = useCallback((holeIdx: number) => {
    setMoles(prev => {
      const mole = prev.find(m => m.holeIdx === holeIdx);
      if (!mole) return prev;
      setScore(s => {
        const newScore = s + 1;
        setStatusMessage(`Whacked mole in hole ${holeIdx + 1}! Score: ${newScore}.`);
        if (adapt.isRelaxedMode && newScore >= RELAXED_MOLE_COUNT) {
          setGameState('done');
        }
        return newScore;
      });
      if (adapt.audioEnabled) { soundRef.current?.whack(); }
      else { addSoundEvent(`🔊 Whack at hole ${holeIdx + 1}`); }
      setFlashEffect('whack');
      if (adapt.isRelaxedMode) {
        setTimeout(() => spawnMole(), 500);
      }
      return prev.filter(m => m.id !== mole.id);
    });
  }, [adapt.audioEnabled, adapt.isRelaxedMode, addSoundEvent, spawnMole]);

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (gameState !== 'playing') return;
    const cols = adapt.gridSize;

    // Number keys for direct whack
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= totalHoles) {
      e.preventDefault();
      handleWhack(num - 1);
      return;
    }

    // Arrow key navigation
    let newFocus = focusedHole;
    switch (e.key) {
      case 'ArrowRight': newFocus = Math.min(focusedHole + 1, totalHoles - 1); break;
      case 'ArrowLeft': newFocus = Math.max(focusedHole - 1, 0); break;
      case 'ArrowDown': newFocus = Math.min(focusedHole + cols, totalHoles - 1); break;
      case 'ArrowUp': newFocus = Math.max(focusedHole - cols, 0); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleWhack(focusedHole);
        return;
      default: return;
    }
    e.preventDefault();
    setFocusedHole(newFocus);
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]');
    buttons?.[newFocus]?.focus();
  }, [gameState, focusedHole, totalHoles, adapt.gridSize, handleWhack]);

  const hasMole = (holeIdx: number) => moles.some(m => m.holeIdx === holeIdx);

  return (
    <section aria-labelledby={headingId} style={{ maxWidth: '600px', margin: '0 auto' }}>
      <style>{`
        @keyframes molePulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mole-start-btn { animation: none !important; }
        }
      `}</style>

      <h2 id={headingId} style={{ fontSize: '24px', marginBottom: '8px', color: '#1a1a1a' }}>Whack-a-Mole</h2>
      <p style={{ fontSize: '15px', color: '#555', marginBottom: '16px' }}>
        Moles pop up from holes — click, press Enter, or use number keys 1-{totalHoles} to whack them!
      </p>
      <div id={statusId} aria-live="assertive" aria-atomic="true" role="status" style={srOnly}>{statusMessage}</div>

      {adapt.enhancedVisual && flashEffect && (
        <div aria-hidden="true" style={{
          padding: '6px 12px', marginBottom: '8px', borderRadius: '4px', textAlign: 'center',
          fontWeight: 600, fontSize: '14px',
          backgroundColor: flashEffect === 'whack' ? '#e8f5e9' : '#fdecea',
          color: flashEffect === 'whack' ? '#2e7d32' : '#c62828',
          border: `2px solid ${flashEffect === 'whack' ? '#4caf50' : '#f44336'}`,
        }}>
          {flashEffect === 'whack' ? '🔨 Whacked!' : '❌ Missed!'}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '15px', color: '#333', flexWrap: 'wrap' }}>
        <span>Score: <strong>{score}</strong></span>
        <span>Missed: <strong>{misses}</strong></span>
        <span>Time: <strong>{adapt.isRelaxedMode ? 'No limit' : `${Math.ceil(timeLeft / 1000)}s`}</strong></span>
      </div>

      {gameState === 'idle' && (
        <button
          type="button"
          className="mole-start-btn"
          onClick={startGame}
          style={{
            padding: '16px 40px', fontSize: '20px', fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #43a047, #2e7d32)',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            animation: 'molePulse 2s ease-in-out infinite',
            marginBottom: '16px',
          }}
        >
          🔨 Start Game
        </button>
      )}

      {gameState === 'done' && (
        <div style={{ padding: '16px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#e8f5e9', border: '2px solid #4caf50', textAlign: 'center' }}>
          <p style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32', margin: '0 0 8px 0' }}>🔨 Game Over!</p>
          <p style={{ fontSize: '15px', color: '#333', margin: '0 0 4px 0' }}>Whacked: {score} | Missed: {misses}</p>
          <button type="button" onClick={startGame} style={{ ...actionBtnStyle, marginTop: '12px' }}>Play Again</button>
        </div>
      )}

      {/* Mole grid with grass texture background */}
      <div
        ref={gridRef}
        role="grid"
        aria-label={`Whack-a-mole ${adapt.gridSize} by ${adapt.gridSize} grid. Use arrow keys to navigate, Enter to whack, or number keys 1-${totalHoles}.`}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${adapt.gridSize}, 1fr)`,
          gap: '12px',
          marginBottom: '20px',
          maxWidth: `${adapt.gridSize * (adapt.holeSize + 12)}px`,
          margin: '0 auto 20px',
          padding: '16px',
          borderRadius: '12px',
          outline: 'none',
          backgroundColor: adapt.highContrast ? '#111' : '#4a7c3f',
          backgroundImage: adapt.highContrast ? 'none' : `
            linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%),
            linear-gradient(-45deg, rgba(255,255,255,0.05) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.05) 75%),
            linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.05) 75%)
          `,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        }}
      >
        {Array.from({ length: totalHoles }, (_, i) => {
          const molePresent = hasMole(i);
          const isBouncing = bounceHole === i && adapt.enhancedVisual;
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              tabIndex={i === focusedHole ? 0 : -1}
              onClick={() => handleWhack(i)}
              onFocus={() => setFocusedHole(i)}
              disabled={gameState !== 'playing'}
              aria-label={molePresent
                ? `Hole ${i + 1}: Mole! Press ${i + 1} or Enter to whack.`
                : `Hole ${i + 1}: Empty.`
              }
              style={{
                width: `${adapt.holeSize}px`, height: `${adapt.holeSize}px`,
                borderRadius: '50%',
                backgroundColor: molePresent
                  ? (adapt.highContrast ? '#8B4513' : '#795548')
                  : (adapt.highContrast ? '#1a1a1a' : '#3d6b34'),
                border: molePresent
                  ? `3px solid ${adapt.highContrast ? '#fff' : '#4e342e'}`
                  : `3px solid ${adapt.highContrast ? '#555' : '#2d5a27'}`,
                cursor: gameState === 'playing' && molePresent ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                fontSize: molePresent ? `${Math.max(32, adapt.holeSize * 0.45)}px` : '14px',
                outline: 'none',
                transform: isBouncing ? 'scale(1.15)' : 'scale(1)',
                transition: 'all 0.15s ease',
                boxShadow: i === focusedHole ? '0 0 0 3px #fff, 0 0 0 5px #1a73e8' : (molePresent ? 'inset 0 -4px 8px rgba(0,0,0,0.3)' : 'inset 0 2px 6px rgba(0,0,0,0.3)'),
              }}
            >
              {molePresent ? (
                <span aria-hidden="true">🐹</span>
              ) : (
                <span aria-hidden="true" style={{ color: adapt.highContrast ? '#555' : 'rgba(255,255,255,0.3)', fontWeight: 600 }}>{i + 1}</span>
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
          <li>Grid: {adapt.gridSize}×{adapt.gridSize} ({totalHoles} holes)</li>
          <li>Mole duration: {adapt.isRelaxedMode ? 'No limit — moles stay until whacked' : `${adapt.moleDurationMs}ms`}</li>
          <li>Spawn interval: {adapt.spawnIntervalMs}ms</li>
          <li>Hole size: {adapt.holeSize}px</li>
          <li>High contrast: {adapt.highContrast ? 'Yes' : 'No'}</li>
          <li>Audio: {adapt.audioEnabled ? 'Enabled' : 'Disabled — visual bounce active'}</li>
          <li>Audio volume: {Math.round(audioVolume * 100)}%</li>
          <li>Keyboard: Arrow keys + Enter, or number keys 1-{totalHoles}</li>
          <li>Screen reader: Mole positions announced via aria-live</li>
        </ul>
      </details>
    </section>
  );
}

const srOnly: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};

const actionBtnStyle: React.CSSProperties = {
  padding: '12px 24px', fontSize: '16px', fontWeight: 600, color: '#fff',
  backgroundColor: '#1a73e8', border: 'none', borderRadius: '6px', cursor: 'pointer',
};

export default WhackAMole;
