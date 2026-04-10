'use client';

import { useState, useCallback, useEffect, useRef, useId } from 'react';
import type { AccessibilityProfile } from '../types/player';
import { getProfileAudioVolume } from '../utils/audio-volume';

export interface SimonGameProps {
  profile: AccessibilityProfile;
  onGameComplete?: (score: number, timeMs: number) => void;
}

const QUADRANTS = [
  { idx: 0, color: '#e53935', activeColor: '#ff5252', label: 'Red', tone: 329.63 },
  { idx: 1, color: '#43a047', activeColor: '#69f0ae', label: 'Green', tone: 261.63 },
  { idx: 2, color: '#1e88e5', activeColor: '#448aff', label: 'Blue', tone: 220.0 },
  { idx: 3, color: '#fb8c00', activeColor: '#ffab40', label: 'Yellow', tone: 164.81 },
];

const HC_QUADRANTS = [
  { idx: 0, color: '#cc0000', activeColor: '#ff4444', label: 'Red', tone: 329.63, pattern: '■' },
  { idx: 1, color: '#006600', activeColor: '#44ff44', label: 'Green', tone: 261.63, pattern: '●' },
  { idx: 2, color: '#0000cc', activeColor: '#4444ff', label: 'Blue', tone: 220.0, pattern: '▲' },
  { idx: 3, color: '#cc8800', activeColor: '#ffcc44', label: 'Yellow', tone: 164.81, pattern: '◆' },
];

function getAdaptations(profile: AccessibilityProfile) {
  const flashDurationMs =
    profile.preferredPacing === 'slow' ? 1000
    : profile.responseTimeMs > 800 ? 700
    : 500;
  const pauseBetweenMs =
    profile.preferredPacing === 'slow' ? 600
    : 300;
  const maxSequence =
    profile.preferredPacing === 'slow' ? 8
    : profile.maxSimultaneousElements <= 3 ? 10
    : 20;
  const quadrantSize = Math.max(120, profile.clickPrecision * 10, profile.minReadableTextSize * 6);
  const highContrast = profile.minContrastRatio > 4.5;
  const audioEnabled = profile.hearingCapability !== 'none';
  const enhancedVisual = profile.hearingCapability === 'none' || profile.hearingCapability === 'partial';
  const showLabels = true; // Always show labels — they help everyone, not just screen reader users
  return { flashDurationMs, pauseBetweenMs, maxSequence, quadrantSize, highContrast, audioEnabled, enhancedVisual, showLabels };
}

function createSoundEngine(masterVolume = 1) {
  let ctx: AudioContext | null = null;
  function getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
    return ctx;
  }
  function playTone(freq: number, dur: number, vol = 0.3) {
    const c = getCtx(); if (!c) return;
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(freq, c.currentTime);
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, vol * masterVolume)), c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur / 1000);
    osc.connect(gain); gain.connect(c.destination); osc.start(); osc.stop(c.currentTime + dur / 1000);
  }
  return {
    playQuadrant(idx: number) { playTone(QUADRANTS[idx].tone, 300); },
    error() { playTone(100, 500, 0.2); },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 250, 0.2), i * 120)); },
    cleanup() { ctx?.close().catch(() => {}); ctx = null; },
  };
}

interface SoundEvent { id: number; text: string; }

export function SimonGame({ profile, onGameComplete }: SimonGameProps) {
  const adapt = getAdaptations(profile);
  const audioVolume = getProfileAudioVolume(profile);
  const quads = adapt.highContrast ? HC_QUADRANTS : QUADRANTS;

  const [sequence, setSequence] = useState<number[]>([]);
  const [playerInput, setPlayerInput] = useState<number[]>([]);
  const [round, setRound] = useState(0);
  const [bestRound, setBestRound] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'showing' | 'input' | 'gameover'>('idle');
  const [activeQuadrant, setActiveQuadrant] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [flashEffect, setFlashEffect] = useState<'correct' | 'wrong' | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [activeGradientIdx, setActiveGradientIdx] = useState<number | null>(null);
  const [soundEvents, setSoundEvents] = useState<SoundEvent[]>([]);
  const soundEventIdRef = useRef(0);

  const soundRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);
  const showingRef = useRef(false);
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
      const t = setTimeout(() => setFlashEffect(null), 500);
      return () => clearTimeout(t);
    }
  }, [flashEffect]);

  const playSequence = useCallback(async (seq: number[]) => {
    showingRef.current = true;
    setPhase('showing');
    // Pre-announce the FULL sequence as text so VoiceOver doesn't miss rapid updates
    const seqNames = seq.map(idx => quads[idx].label).join(', ');
    setStatusMessage(`Sequence: ${seqNames}. Listen to the tones.`);
    await new Promise(r => setTimeout(r, 800));

    for (let i = 0; i < seq.length; i++) {
      if (!showingRef.current) return;
      const idx = seq[i];
      setActiveQuadrant(idx);
      setActiveGradientIdx(idx);
      if (adapt.audioEnabled) { soundRef.current?.playQuadrant(idx); }
      else { addSoundEvent(`🔊 ${quads[idx].label} tone`); }
      // Do NOT update aria-live per step — the pre-announcement is enough
      await new Promise(r => setTimeout(r, adapt.flashDurationMs));
      setActiveQuadrant(null);
      setActiveGradientIdx(null);
      await new Promise(r => setTimeout(r, adapt.pauseBetweenMs));
    }
    showingRef.current = false;
    setPhase('input');
    setPlayerInput([]);
    setStatusMessage(`Your turn. Repeat: ${seqNames}. Use arrow keys or number keys 1-4.`);
  }, [adapt.flashDurationMs, adapt.pauseBetweenMs, adapt.audioEnabled, quads, addSoundEvent]);

  const startGame = useCallback(() => {
    showingRef.current = false;
    const first = Math.floor(Math.random() * 4);
    const newSeq = [first];
    setSequence(newSeq);
    setRound(1);
    setPlayerInput([]);
    setStartTime(Date.now());
    setSoundEvents([]);
    playSequence(newSeq);
  }, [playSequence]);

  const handleQuadrantClick = useCallback((idx: number) => {
    if (phase !== 'input') return;
    const newInput = [...playerInput, idx];
    setPlayerInput(newInput);
    setActiveQuadrant(idx);
    if (adapt.audioEnabled) { soundRef.current?.playQuadrant(idx); }
    else { addSoundEvent(`🔊 ${quads[idx].label} tone`); }
    setTimeout(() => setActiveQuadrant(null), 200);

    const step = newInput.length - 1;
    if (sequence[step] !== idx) {
      setPhase('gameover');
      setFlashEffect('wrong');
      if (adapt.audioEnabled) { soundRef.current?.error(); }
      else { addSoundEvent('🔊 Error buzz'); }
      const finalRound = round - 1;
      setBestRound(prev => Math.max(prev, finalRound));
      setStatusMessage(`Wrong! You pressed ${quads[idx].label} but it should have been ${quads[sequence[step]].label}. Game over at round ${round}.`);
      onGameComplete?.(finalRound, Date.now() - startTime);
      return;
    }

    setStatusMessage(`You pressed ${quads[idx].label}. Correct. ${newInput.length} of ${sequence.length} done.`);

    if (newInput.length === sequence.length) {
      setFlashEffect('correct');
      if (round >= adapt.maxSequence) {
        setPhase('gameover');
        setBestRound(prev => Math.max(prev, round));
        setStatusMessage(`Amazing! You completed all ${adapt.maxSequence} rounds!`);
        if (adapt.audioEnabled) { soundRef.current?.win(); }
        else { addSoundEvent('🔊 Victory fanfare'); }
        onGameComplete?.(round, Date.now() - startTime);
        return;
      }
      const next = Math.floor(Math.random() * 4);
      const newSeq = [...sequence, next];
      setSequence(newSeq);
      setRound(r => r + 1);
      setStatusMessage(`Correct! Round ${round + 1} coming up...`);
      setTimeout(() => playSequence(newSeq), 800);
    }
  }, [phase, playerInput, sequence, round, adapt, quads, startTime, onGameComplete, playSequence, addSoundEvent]);

  // Radial gradient background that shifts with active quadrant
  const gradientBg = activeGradientIdx !== null
    ? `radial-gradient(circle at ${activeGradientIdx % 2 === 0 ? '30%' : '70%'} ${activeGradientIdx < 2 ? '30%' : '70%'}, ${quads[activeGradientIdx].activeColor}22, transparent 70%)`
    : 'none';

  return (
    <section aria-labelledby={headingId} style={{ maxWidth: '500px', margin: '0 auto' }}>
      <style>{`
        @keyframes simonPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @media (prefers-reduced-motion: reduce) {
          .simon-start-btn { animation: none !important; }
        }
      `}</style>

      <h2 id={headingId} style={{ fontSize: '24px', marginBottom: '8px', color: '#1a1a1a' }}>Simon Says</h2>
      <p style={{ fontSize: '15px', color: '#555', marginBottom: '16px' }}>
        Watch the color sequence, then repeat it. The sequence grows each round!
      </p>
      <div id={statusId} aria-live="assertive" aria-atomic="true" role="status" style={srOnly}>{statusMessage}</div>

      {adapt.enhancedVisual && flashEffect && (
        <div aria-hidden="true" style={{
          padding: '6px 12px', marginBottom: '8px', borderRadius: '4px', textAlign: 'center',
          fontWeight: 600, fontSize: '14px',
          backgroundColor: flashEffect === 'correct' ? '#e8f5e9' : '#fdecea',
          color: flashEffect === 'correct' ? '#2e7d32' : '#c62828',
          border: `2px solid ${flashEffect === 'correct' ? '#4caf50' : '#f44336'}`,
        }}>
          {flashEffect === 'correct' ? '✅ Correct!' : '❌ Wrong!'}
        </div>
      )}

      {statusMessage && phase !== 'idle' && (
        <p style={{ padding: '8px 12px', marginBottom: '12px', borderRadius: '4px', backgroundColor: '#e3f2fd', color: '#0d47a1', fontSize: '14px', border: '1px solid #90caf9' }}>
          {statusMessage}
        </p>
      )}

      <div style={{ display: 'flex', gap: '20px', marginBottom: '16px', fontSize: '15px', color: '#333', flexWrap: 'wrap' }}>
        <span>Round: <strong>{round}</strong></span>
        <span>Best: <strong>{bestRound}</strong></span>
        <span>Progress: <strong>{playerInput.length}/{sequence.length}</strong></span>
      </div>

      {phase === 'idle' && (
        <button
          type="button"
          className="simon-start-btn"
          onClick={startGame}
          style={{
            padding: '16px 40px', fontSize: '20px', fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #e53935, #fb8c00)',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            animation: 'simonPulse 2s ease-in-out infinite',
            marginBottom: '16px',
          }}
        >
          🎵 Start Game
        </button>
      )}
      {phase === 'gameover' && (
        <div style={{ padding: '16px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#e8f5e9', border: '2px solid #4caf50', textAlign: 'center' }}>
          <p style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32', margin: '0 0 8px 0' }}>🎵 Game Over!</p>
          <p style={{ fontSize: '15px', color: '#333', margin: '0 0 4px 0' }}>Reached round {round} | Best: {bestRound}</p>
          <button type="button" onClick={startGame} style={{ ...actionBtnStyle, marginTop: '12px' }}>Play Again</button>
        </div>
      )}

      {/* Simon board with radial gradient background */}
      <div
        role="group"
        aria-label="Simon game board with 4 colored quadrants. Use arrow keys: Up=Red, Right=Green, Down=Blue, Left=Yellow. Or number keys 1-4."
        tabIndex={0}
        onKeyDown={(e) => {
          if (phase !== 'input') return;
          const keyMap: Record<string, number> = {
            ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3,
            '1': 0, '2': 1, '3': 2, '4': 3,
          };
          const idx = keyMap[e.key];
          if (idx !== undefined) { e.preventDefault(); handleQuadrantClick(idx); }
        }}
        style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px',
          width: '100%',
          maxWidth: `${adapt.quadrantSize * 2 + 8}px`,
          margin: '0 auto 16px',
          outline: 'none', padding: '12px', borderRadius: '16px',
          backgroundImage: gradientBg,
          backgroundColor: '#f5f5f5',
          transition: 'background-image 0.3s ease',
          boxSizing: 'border-box',
        }}
      >
        {quads.map(q => {
          const isActive = activeQuadrant === q.idx;
          return (
            <button
              key={q.idx}
              type="button"
              onClick={() => handleQuadrantClick(q.idx)}
              disabled={phase !== 'input'}
              aria-label={`${q.label} quadrant${isActive ? ' — active' : ''}. ${phase === 'input' ? `Press to select ${q.label}.` : ''}`}
              style={{
                width: '100%',
                aspectRatio: '1',
                maxWidth: `${adapt.quadrantSize}px`,
                minHeight: '100px',
                backgroundColor: isActive ? q.activeColor : q.color,
                border: isActive ? '4px solid #fff' : '3px solid rgba(0,0,0,0.2)',
                borderRadius: '12px', cursor: phase === 'input' ? 'pointer' : 'default',
                fontSize: adapt.showLabels ? '16px' : '24px',
                fontWeight: 600, color: '#fff', outline: 'none',
                transform: isActive ? 'scale(1.05)' : 'scale(1)',
                transition: 'all 0.15s ease',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                opacity: phase === 'showing' && !isActive ? 0.5 : 1,
                boxShadow: isActive ? '0 0 20px rgba(255,255,255,0.5)' : 'none',
              }}
            >
              {'pattern' in q && <span aria-hidden="true" style={{ fontSize: '28px' }}>{(q as typeof HC_QUADRANTS[number]).pattern}</span>}
              {adapt.showLabels && <span>{q.label}</span>}
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
          <li>Flash duration: {adapt.flashDurationMs}ms</li>
          <li>Pause between: {adapt.pauseBetweenMs}ms</li>
          <li>Max sequence: {adapt.maxSequence}</li>
          <li>Quadrant size: {adapt.quadrantSize}px</li>
          <li>Labels: {adapt.showLabels ? 'Shown' : 'Hidden'}</li>
          <li>Audio: {adapt.audioEnabled ? 'Enabled' : 'Disabled — visual patterns active'}</li>
          <li>Audio volume: {Math.round(audioVolume * 100)}%</li>
          <li>Full sequence pre-announced for screen readers</li>
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

export default SimonGame;
