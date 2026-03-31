'use client';

import { useState, useCallback, useEffect, useRef, useId } from 'react';
import type { AccessibilityProfile } from '../types/player';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MemoryGameProps {
  profile: AccessibilityProfile;
  onGameComplete?: (score: number, timeMs: number) => void;
}

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

interface Card {
  id: number;
  emoji: string;
  label: string;
  flipped: boolean;
  matched: boolean;
}

const CARD_PAIRS = [
  { emoji: '🌟', label: 'Star' },
  { emoji: '🎮', label: 'Game Controller' },
  { emoji: '🎵', label: 'Music Note' },
  { emoji: '🚀', label: 'Rocket' },
  { emoji: '🌈', label: 'Rainbow' },
  { emoji: '🎯', label: 'Target' },
  { emoji: '💎', label: 'Diamond' },
  { emoji: '🔥', label: 'Fire' },
];

function createDeck(pairCount: number): Card[] {
  const pairs = CARD_PAIRS.slice(0, pairCount);
  const cards: Card[] = [];
  let id = 0;
  for (const pair of pairs) {
    cards.push({ id: id++, emoji: pair.emoji, label: pair.label, flipped: false, matched: false });
    cards.push({ id: id++, emoji: pair.emoji, label: pair.label, flipped: false, matched: false });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Adapt game based on accessibility profile
// ---------------------------------------------------------------------------

function getAdaptations(profile: AccessibilityProfile) {
  const pairCount = profile.preferredPacing === 'slow' || profile.maxSimultaneousElements <= 3
    ? 4
    : profile.maxSimultaneousElements <= 5
      ? 6
      : 8;
  const cardSize = Math.max(80, profile.minReadableTextSize * 4, profile.clickPrecision * 8);
  const emojiSize = Math.max(32, profile.minReadableTextSize * 2);
  const isScreenReaderLikely = profile.preferredInstructionFormat === 'text' ||
    profile.hearingCapability === 'none' ||
    profile.preferredPacing === 'slow';
  const flipDelayMs = isScreenReaderLikely
    ? 0
    : profile.responseTimeMs > 800
      ? 1500
      : 1000;
  const highContrast = profile.minContrastRatio > 4.5;
  const showLabels = profile.preferredInstructionFormat === 'text' ||
    profile.preferredPacing === 'slow' ||
    profile.hearingCapability === 'none';
  const audioEnabled = profile.hearingCapability !== 'none';
  const enhancedVisual = profile.hearingCapability === 'none' || profile.hearingCapability === 'partial';
  const cols = 4;
  return { pairCount, cardSize, emojiSize, flipDelayMs, highContrast, showLabels, cols, audioEnabled, enhancedVisual, isScreenReaderLikely };
}

// ---------------------------------------------------------------------------
// Sound engine
// ---------------------------------------------------------------------------

function createSoundEngine() {
  let ctx: AudioContext | null = null;
  function getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
    return ctx;
  }
  function playTone(frequency: number, durationMs: number, type: OscillatorType = 'sine', volume = 0.3) {
    const c = getCtx(); if (!c) return;
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, c.currentTime);
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + durationMs / 1000);
    osc.connect(gain); gain.connect(c.destination); osc.start(); osc.stop(c.currentTime + durationMs / 1000);
  }
  return {
    flip() { playTone(600, 100, 'sine', 0.15); },
    match() { playTone(523, 150, 'sine', 0.25); setTimeout(() => playTone(659, 200, 'sine', 0.25), 120); },
    mismatch() { playTone(200, 250, 'triangle', 0.2); },
    win() { [523, 659, 784, 1047].forEach((freq, i) => setTimeout(() => playTone(freq, 300, 'sine', 0.2), i * 150)); },
    cleanup() { ctx?.close().catch(() => {}); ctx = null; },
  };
}

// ---------------------------------------------------------------------------
// Sound transcript entry
// ---------------------------------------------------------------------------
interface SoundEvent {
  id: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemoryGame({ profile, onGameComplete }: MemoryGameProps) {
  const adaptations = getAdaptations(profile);
  const [cards, setCards] = useState<Card[]>(() => createDeck(adaptations.pairCount));
  const [flippedIds, setFlippedIds] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameComplete, setGameComplete] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [flashEffect, setFlashEffect] = useState<'match' | 'mismatch' | 'win' | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [soundEvents, setSoundEvents] = useState<SoundEvent[]>([]);
  const soundEventIdRef = useRef(0);
  const pendingMismatchRef = useRef<number[] | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const statusId = useId();

  const totalPairs = adaptations.pairCount;
  const totalCards = cards.length;

  const addSoundEvent = useCallback((text: string) => {
    setSoundEvents(prev => {
      const next = [...prev, { id: soundEventIdRef.current++, text }];
      return next.slice(-5);
    });
  }, []);

  useEffect(() => {
    if (adaptations.audioEnabled) soundRef.current = createSoundEngine();
    return () => { soundRef.current?.cleanup(); soundRef.current = null; };
  }, [adaptations.audioEnabled]);

  useEffect(() => {
    if (flashEffect) {
      const timeout = setTimeout(() => setFlashEffect(null), flashEffect === 'win' ? 1500 : 600);
      return () => clearTimeout(timeout);
    }
  }, [flashEffect]);

  useEffect(() => {
    if (gameStarted && !gameComplete) {
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTime), 100);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameStarted, gameComplete, startTime]);

  useEffect(() => {
    if (matchedCount === totalPairs && matchedCount > 0) {
      setGameComplete(true);
      const finalTime = Date.now() - startTime;
      setElapsedMs(finalTime);
      setStatusMessage(`Congratulations! You matched all ${totalPairs} pairs in ${moves} moves and ${formatTime(finalTime)}!`);
      if (adaptations.audioEnabled) { soundRef.current?.win(); }
      else { addSoundEvent('🔊 Victory fanfare'); }
      setFlashEffect('win');
      onGameComplete?.(moves, finalTime);
    }
  }, [matchedCount, totalPairs, moves, startTime, onGameComplete, adaptations.audioEnabled, addSoundEvent]);

  const handleCardClick = useCallback((cardId: number) => {
    if (isProcessing || gameComplete) return;
    const card = cards.find(c => c.id === cardId);
    if (!card || card.flipped || card.matched) return;

    // Clear pending mismatch cards (screen-reader-friendly: no auto-timeout)
    if (pendingMismatchRef.current) {
      const [pid1, pid2] = pendingMismatchRef.current;
      setCards(prev => prev.map(c =>
        c.id === pid1 || c.id === pid2 ? { ...c, flipped: false } : c
      ));
      pendingMismatchRef.current = null;
    }

    if (!gameStarted) { setGameStarted(true); setStartTime(Date.now()); }

    if (adaptations.audioEnabled) { soundRef.current?.flip(); }
    else { addSoundEvent('🔊 Card flip'); }

    const newFlipped = [...flippedIds, cardId];
    setFlippedIds(newFlipped);
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, flipped: true } : c));
    setStatusMessage(`Card ${cardId + 1} flipped: ${card.label}. ${flippedIds.length === 0 ? 'Find the matching card.' : ''}`);

    if (newFlipped.length === 2) {
      setMoves(m => m + 1);
      setIsProcessing(true);
      const [first] = newFlipped;
      const card1 = cards.find(c => c.id === first)!;
      const card2 = card;

      if (card1.emoji === card2.emoji) {
        setTimeout(() => {
          if (adaptations.audioEnabled) { soundRef.current?.match(); }
          else { addSoundEvent('🔊 Match chime'); }
          setFlashEffect('match');
          setCards(prev => prev.map(c =>
            c.id === first || c.id === cardId ? { ...c, matched: true } : c
          ));
          setMatchedCount(m => m + 1);
          setFlippedIds([]);
          setIsProcessing(false);
          const pos1 = cards.findIndex(c => c.id === first) + 1;
          const pos2 = cards.findIndex(c => c.id === cardId) + 1;
          setStatusMessage(`Match found! ${card1.label} at positions ${pos1} and ${pos2}.`);
        }, 500);
      } else {
        if (adaptations.audioEnabled) { setTimeout(() => soundRef.current?.mismatch(), 300); }
        else { addSoundEvent('🔊 Wrong buzz'); }
        setFlashEffect('mismatch');
        setStatusMessage(`No match. Card ${cards.findIndex(c => c.id === first) + 1} was ${card1.label}, Card ${cards.findIndex(c => c.id === cardId) + 1} was ${card2.label}. ${adaptations.flipDelayMs === 0 ? 'Press any card to continue.' : 'Cards flipping back.'}`);
        if (adaptations.flipDelayMs === 0) {
          // No auto-timeout: cards stay visible until next interaction
          setFlippedIds([]);
          setIsProcessing(false);
          pendingMismatchRef.current = [first, cardId];
        } else {
          setTimeout(() => {
            setCards(prev => prev.map(c =>
              c.id === first || c.id === cardId ? { ...c, flipped: false } : c
            ));
            setFlippedIds([]);
            setIsProcessing(false);
            setStatusMessage('Cards flipped back. Choose another card.');
          }, adaptations.flipDelayMs);
        }
      }
    }
  }, [cards, flippedIds, isProcessing, gameComplete, gameStarted, adaptations.flipDelayMs, adaptations.audioEnabled, addSoundEvent]);

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    const cols = adaptations.cols;
    let newIndex = focusedIndex;
    switch (e.key) {
      case 'ArrowRight': newIndex = Math.min(focusedIndex + 1, totalCards - 1); break;
      case 'ArrowLeft': newIndex = Math.max(focusedIndex - 1, 0); break;
      case 'ArrowDown': newIndex = Math.min(focusedIndex + cols, totalCards - 1); break;
      case 'ArrowUp': newIndex = Math.max(focusedIndex - cols, 0); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleCardClick(cards[focusedIndex].id);
        return;
      default: return;
    }
    e.preventDefault();
    setFocusedIndex(newIndex);
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]');
    buttons?.[newIndex]?.focus();
  }, [focusedIndex, totalCards, adaptations.cols, handleCardClick, cards]);

  const handleRestart = useCallback(() => {
    setCards(createDeck(adaptations.pairCount));
    setFlippedIds([]); setMoves(0); setMatchedCount(0);
    setGameStarted(false); setGameComplete(false);
    setStartTime(0); setElapsedMs(0); setIsProcessing(false);
    setFocusedIndex(0); setSoundEvents([]);
    setStatusMessage('New game started. Find matching pairs!');
  }, [adaptations.pairCount]);

  const cardBg = adaptations.highContrast ? '#1a1a1a' : '#1a73e8';
  const cardFrontBg = adaptations.highContrast ? '#ffffff' : '#f5f5f5';
  const matchedBg = '#c8e6c9';

  return (
    <section aria-labelledby={headingId} style={{ maxWidth: '600px', margin: '0 auto' }}>
      <style>{`
        @keyframes memoryPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @media (prefers-reduced-motion: reduce) {
          .memory-start-btn { animation: none !important; }
          .memory-bg-pattern { animation: none !important; }
        }
      `}</style>

      <h2 id={headingId} style={{ fontSize: '24px', marginBottom: '8px', color: '#1a1a1a' }}>
        Memory Match
      </h2>
      <p style={{ fontSize: '15px', color: '#555', marginBottom: '16px' }}>
        Find all matching pairs. Click or press Enter/Space on a card to flip it. Use arrow keys to navigate the grid.
        {adaptations.showLabels && ' Card names are shown for accessibility.'}
      </p>

      {/* Live status region */}
      <div id={statusId} aria-live="assertive" aria-atomic="true" role="status" style={srOnly}>
        {statusMessage}
      </div>

      {/* Visible status */}
      {statusMessage && !gameComplete && (
        <p style={{ padding: '8px 12px', marginBottom: '12px', borderRadius: '4px', backgroundColor: '#e3f2fd', color: '#0d47a1', fontSize: '14px', border: '1px solid #90caf9' }}>
          {statusMessage}
        </p>
      )}

      {/* Score bar */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', fontSize: '15px', color: '#333', flexWrap: 'wrap' }}>
        <span>Moves: <strong>{moves}</strong></span>
        <span>Matched: <strong>{matchedCount}/{totalPairs}</strong></span>
        <span>Time: <strong>{formatTime(elapsedMs)}</strong></span>
      </div>

      {/* Start button */}
      {!gameStarted && !gameComplete && (
        <button
          type="button"
          className="memory-start-btn"
          onClick={() => { setGameStarted(true); setStartTime(Date.now()); setStatusMessage('Game started! Find matching pairs. Use arrow keys to navigate, Enter to flip.'); }}
          style={{
            padding: '16px 40px', fontSize: '20px', fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #1a73e8, #1565c0)',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            animation: 'memoryPulse 2s ease-in-out infinite',
            marginBottom: '16px', display: 'inline-block',
          }}
        >
          🎮 Start Game
        </button>
      )}

      {/* Game complete banner */}
      {gameComplete && (
        <div style={{ padding: '16px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#e8f5e9', border: '2px solid #4caf50', textAlign: 'center' }}>
          <p style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32', margin: '0 0 8px 0' }}>🎉 You Win!</p>
          <p style={{ fontSize: '15px', color: '#333', margin: '0 0 12px 0' }}>{moves} moves in {formatTime(elapsedMs)}</p>
          <button type="button" onClick={handleRestart} style={restartButtonStyle}>Play Again</button>
        </div>
      )}

      {/* Visual flash feedback */}
      {adaptations.enhancedVisual && flashEffect && (
        <div aria-hidden="true" style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999,
          backgroundColor: flashEffect === 'match' ? 'rgba(76,175,80,0.25)' : flashEffect === 'mismatch' ? 'rgba(244,67,54,0.2)' : 'rgba(255,215,0,0.3)',
          transition: 'opacity 0.3s',
        }} />
      )}

      {/* Audio feedback indicator for deaf players */}
      {!adaptations.audioEnabled && flashEffect && (
        <div style={{
          padding: '6px 12px', marginBottom: '8px', borderRadius: '4px', textAlign: 'center',
          fontWeight: 600, fontSize: '14px',
          backgroundColor: flashEffect === 'match' ? '#e8f5e9' : flashEffect === 'mismatch' ? '#fdecea' : '#fff8e1',
          color: flashEffect === 'match' ? '#2e7d32' : flashEffect === 'mismatch' ? '#c62828' : '#f57f17',
          border: `2px solid ${flashEffect === 'match' ? '#4caf50' : flashEffect === 'mismatch' ? '#f44336' : '#ffc107'}`,
        }}>
          {flashEffect === 'match' && '✅ Match!'}
          {flashEffect === 'mismatch' && '❌ No match'}
          {flashEffect === 'win' && '🎉 You win!'}
        </div>
      )}

      {/* Card grid with background pattern */}
      <div
        ref={gridRef}
        role="grid"
        aria-label={`Memory card grid, ${adaptations.cols} columns, ${totalCards} cards. Use arrow keys to navigate, Enter to flip.`}
        onKeyDown={handleGridKeyDown}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${adaptations.cols}, 1fr)`,
          gap: '12px',
          marginBottom: '20px',
          padding: '16px',
          borderRadius: '12px',
          position: 'relative',
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 40px, rgba(0,0,0,0.015) 40px, rgba(0,0,0,0.015) 80px)',
          backgroundColor: '#fafafa',
        }}
      >
        {/* Decorative card suit watermark */}
        <div aria-hidden="true" className="memory-bg-pattern" style={{
          position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
          opacity: 0.04, fontSize: '48px', lineHeight: '60px', color: '#000',
          display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
          borderRadius: '12px', zIndex: 0,
        }}>
          {'♠♥♦♣'.repeat(20).split('').map((s, i) => <span key={i}>{s}</span>)}
        </div>

        {cards.map((card, index) => {
          const isRevealed = card.flipped || card.matched;
          return (
            <button
              key={card.id}
              type="button"
              role="gridcell"
              tabIndex={index === focusedIndex ? 0 : -1}
              onClick={() => handleCardClick(card.id)}
              onFocus={() => setFocusedIndex(index)}
              disabled={card.matched || isProcessing}
              aria-label={
                card.matched
                  ? `Card ${index + 1}: ${card.label} — matched!`
                  : card.flipped
                    ? `Card ${index + 1}: ${card.label} — flipped. Remember this position.`
                    : `Card ${index + 1} of ${totalCards} — face down. Press Enter to flip.`
              }
              style={{
                position: 'relative', zIndex: 1,
                width: '100%', aspectRatio: '1',
                maxWidth: `${adaptations.cardSize}px`, minHeight: '60px',
                borderRadius: '12px',
                border: card.matched ? '3px solid #4caf50' : isRevealed ? '3px solid #1a73e8' : `3px solid ${adaptations.highContrast ? '#333' : '#ccc'}`,
                backgroundColor: card.matched ? matchedBg : isRevealed ? cardFrontBg : cardBg,
                cursor: card.matched || isProcessing ? 'default' : 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                fontSize: `${adaptations.emojiSize}px`,
                transition: 'all 0.2s ease',
                opacity: card.matched ? 0.7 : 1,
                outline: 'none',
                boxShadow: index === focusedIndex ? '0 0 0 3px #1a73e8, 0 0 0 5px #fff' : 'none',
              }}
            >
              {isRevealed ? (
                <>
                  <span aria-hidden="true">{card.emoji}</span>
                  {adaptations.showLabels && (
                    <span style={{ fontSize: '11px', color: '#333', marginTop: '2px', fontWeight: 500 }}>{card.label}</span>
                  )}
                </>
              ) : (
                <span style={{ color: '#fff', fontSize: '20px', fontWeight: 700 }} aria-hidden="true">?</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Restart button */}
      {!gameComplete && gameStarted && (
        <button type="button" onClick={handleRestart} style={restartButtonStyle}>Restart Game</button>
      )}

      {/* Sound Transcript panel for deaf players */}
      {profile.hearingCapability === 'none' && soundEvents.length > 0 && (
        <div
          role="log"
          aria-label="Sound transcript"
          aria-live="polite"
          style={{
            marginTop: '16px', padding: '10px 14px', borderRadius: '8px',
            backgroundColor: '#f5f5f5', border: '1px solid #e0e0e0',
            maxHeight: '120px', overflowY: 'auto',
          }}
        >
          <p style={{ fontSize: '12px', fontWeight: 600, color: '#666', margin: '0 0 6px 0' }}>Sound Transcript</p>
          {soundEvents.map(ev => (
            <p key={ev.id} style={{ fontSize: '13px', color: '#333', margin: '2px 0' }}>{ev.text}</p>
          ))}
        </div>
      )}

      {/* Accessibility info */}
      <details style={{ marginTop: '16px', fontSize: '13px', color: '#666' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Accessibility Adaptations Applied</summary>
        <ul style={{ marginTop: '8px', paddingLeft: '20px', lineHeight: 1.8 }}>
          <li>Pairs: {adaptations.pairCount} (based on cognitive preferences)</li>
          <li>Card size: {adaptations.cardSize}px (based on text size and click precision)</li>
          <li>Flip delay: {adaptations.flipDelayMs === 0 ? 'None — cards stay visible until you choose the next card (screen reader friendly)' : `${adaptations.flipDelayMs}ms (based on response time and pacing)`}</li>
          <li>High contrast: {adaptations.highContrast ? 'Yes' : 'No'}</li>
          <li>Text labels: {adaptations.showLabels ? 'Shown' : 'Hidden'}</li>
          <li>Audio feedback: {adaptations.audioEnabled ? 'Enabled' : 'Disabled — using visual flash feedback instead'}</li>
          <li>Arrow key navigation: Enabled (ArrowUp/Down/Left/Right)</li>
          <li>Input: keyboard (Enter/Space + arrow keys) + mouse + touch</li>
        </ul>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

const srOnly: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
};

const restartButtonStyle: React.CSSProperties = {
  padding: '12px 24px', fontSize: '16px', fontWeight: 600, color: '#fff',
  backgroundColor: '#1a73e8', border: 'none', borderRadius: '6px', cursor: 'pointer',
};

export default MemoryGame;
