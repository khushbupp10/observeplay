'use client';

import { useState, useCallback, useEffect, useRef, useId } from 'react';
import type { AccessibilityProfile } from '../types/player';
import { getProfileAudioVolume } from '../utils/audio-volume';

export interface WordScrambleProps {
  profile: AccessibilityProfile;
  onGameComplete?: (score: number, timeMs: number) => void;
}

const WORD_BANK = {
  easy: [
    { word: 'CAT', category: 'animals' }, { word: 'DOG', category: 'animals' },
    { word: 'RED', category: 'colors' }, { word: 'SUN', category: 'foods' },
    { word: 'HAT', category: 'animals' }, { word: 'CUP', category: 'foods' },
    { word: 'BIG', category: 'colors' }, { word: 'RUN', category: 'animals' },
  ],
  medium: [
    { word: 'TIGER', category: 'animals' }, { word: 'GREEN', category: 'colors' },
    { word: 'BREAD', category: 'foods' }, { word: 'HORSE', category: 'animals' },
    { word: 'GRAPE', category: 'foods' }, { word: 'BLACK', category: 'colors' },
    { word: 'MOUSE', category: 'animals' }, { word: 'PEACH', category: 'foods' },
  ],
  hard: [
    { word: 'DOLPHIN', category: 'animals' }, { word: 'MAGENTA', category: 'colors' },
    { word: 'AVOCADO', category: 'foods' }, { word: 'PENGUIN', category: 'animals' },
    { word: 'CRIMSON', category: 'colors' }, { word: 'CHICKEN', category: 'foods' },
    { word: 'GIRAFFE', category: 'animals' }, { word: 'BISCUIT', category: 'foods' },
  ],
};

const TOTAL_ROUNDS = 8;

function scramble(word: string): string {
  const arr = word.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const result = arr.join('');
  return result === word ? scramble(word) : result;
}

function getAdaptations(profile: AccessibilityProfile) {
  const difficulty: 'easy' | 'medium' | 'hard' =
    profile.preferredPacing === 'slow' ? 'easy'
    : profile.maxSimultaneousElements <= 3 ? 'easy'
    : profile.preferredPacing === 'fast' ? 'hard'
    : 'medium';
  const timeLimitMs =
    profile.preferredPacing === 'slow' ? 0
    : profile.responseTimeMs > 800 ? 45000
    : 30000;
  const textSize = Math.max(24, profile.minReadableTextSize * 1.5);
  const showHints = profile.preferredPacing === 'slow' || profile.maxSimultaneousElements <= 3;
  const highContrast = profile.minContrastRatio > 4.5;
  const audioEnabled = profile.hearingCapability !== 'none';
  const enhancedVisual = profile.hearingCapability === 'none' || profile.hearingCapability === 'partial';
  return { difficulty, timeLimitMs, textSize, showHints, highContrast, audioEnabled, enhancedVisual };
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
    correct() { playTone(523, 150); setTimeout(() => playTone(659, 200), 100); },
    wrong() { playTone(200, 300, 'triangle', 0.2); },
    hint() { playTone(440, 100, 'sine', 0.15); },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 250, 'sine', 0.2), i * 120)); },
    letterSpeak(letter: string) {
      const base = 300;
      const offset = (letter.charCodeAt(0) - 65) * 20;
      playTone(base + offset, 150, 'sine', 0.2);
    },
    cleanup() { ctx?.close().catch(() => {}); ctx = null; },
  };
}

interface SoundEvent { id: number; text: string; }

export function WordScramble({ profile, onGameComplete }: WordScrambleProps) {
  const adapt = getAdaptations(profile);
  const audioVolume = getProfileAudioVolume(profile);
  const words = WORD_BANK[adapt.difficulty];

  const [currentWordIdx, setCurrentWordIdx] = useState(0);
  const [scrambledWord, setScrambledWord] = useState('');
  const [answer, setAnswer] = useState('');
  const [score, setScore] = useState(0);
  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'done'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [flashEffect, setFlashEffect] = useState<'correct' | 'wrong' | null>(null);
  const [hintRevealed, setHintRevealed] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [extraTimeMs, setExtraTimeMs] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [usedIndices, setUsedIndices] = useState<number[]>([]);
  const [soundEvents, setSoundEvents] = useState<SoundEvent[]>([]);
  const soundEventIdRef = useRef(0);

  const soundRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Timer
  useEffect(() => {
    if (gameState === 'playing' && adapt.timeLimitMs > 0) {
      const totalLimitMs = adapt.timeLimitMs + extraTimeMs;
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const left = Math.max(0, totalLimitMs - elapsed);
        setTimeLeft(left);
        if (left <= 0) setGameState('done');
      }, 100);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
  }, [gameState, startTime, adapt.timeLimitMs, extraTimeMs]);

  useEffect(() => {
    if (gameState === 'done') {
      if (timerRef.current) clearInterval(timerRef.current);
      setStatusMessage(`Game over! You got ${score} out of ${roundsPlayed} correct.`);
      if (adapt.audioEnabled) { soundRef.current?.win(); }
      else { addSoundEvent('🔊 Game over fanfare'); }
      onGameComplete?.(score, Date.now() - startTime);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  const pickNextWord = useCallback(() => {
    let idx: number;
    const available = words.map((_, i) => i).filter(i => !usedIndices.includes(i));
    if (available.length === 0) {
      setUsedIndices([]);
      idx = Math.floor(Math.random() * words.length);
    } else {
      idx = available[Math.floor(Math.random() * available.length)];
    }
    setUsedIndices(prev => [...prev, idx]);
    setCurrentWordIdx(idx);
    const sw = scramble(words[idx].word);
    setScrambledWord(sw);
    setAnswer('');
    setHintRevealed(0);
    // Announce the full scrambled word as a spelled-out string for screen readers
    const spelled = sw.split('').join('-');
    setStatusMessage(`Scrambled word: ${spelled}. Category: ${words[idx].category}. Type your answer.`);
  }, [words, usedIndices]);

  const startGame = useCallback(() => {
    setScore(0); setRoundsPlayed(0); setUsedIndices([]);
    setExtraTimeMs(0);
    setGameState('playing'); setStartTime(Date.now());
    setSoundEvents([]);
    if (adapt.timeLimitMs > 0) setTimeLeft(adapt.timeLimitMs);
    pickNextWord();
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [adapt.timeLimitMs, pickNextWord]);

  const currentWord = words[currentWordIdx];

  const handleSubmit = useCallback(() => {
    if (!currentWord || gameState !== 'playing') return;
    const isCorrect = answer.toUpperCase().trim() === currentWord.word;
    const newRounds = roundsPlayed + 1;
    setRoundsPlayed(newRounds);

    if (isCorrect) {
      setScore(s => s + 1);
      setFlashEffect('correct');
      if (adapt.audioEnabled) { soundRef.current?.correct(); }
      else { addSoundEvent('🔊 Correct chime'); }
      setStatusMessage(`Correct! The word was ${currentWord.word}.`);
    } else {
      setFlashEffect('wrong');
      if (adapt.audioEnabled) { soundRef.current?.wrong(); }
      else { addSoundEvent('🔊 Wrong buzz'); }
      setStatusMessage(`Wrong. The word was ${currentWord.word}. You typed ${answer.toUpperCase().trim() || '(nothing)'}.`);
    }

    if (newRounds >= TOTAL_ROUNDS) {
      setTimeout(() => setGameState('done'), 1000);
    } else {
      setTimeout(() => {
        pickNextWord();
        inputRef.current?.focus();
      }, 1200);
    }
  }, [answer, currentWord, gameState, roundsPlayed, adapt.audioEnabled, pickNextWord, addSoundEvent]);

  const handleHint = useCallback(() => {
    if (!currentWord) return;
    const nextHint = Math.min(hintRevealed + 1, currentWord.word.length - 1);
    setHintRevealed(nextHint);
    if (adapt.audioEnabled) { soundRef.current?.hint(); }
    else { addSoundEvent('🔊 Hint chime'); }
    const hintLetters = currentWord.word.slice(0, nextHint).split('').join('-');
    setStatusMessage(`Hint: the word starts with ${hintLetters}`);
  }, [currentWord, hintRevealed, adapt.audioEnabled, addSoundEvent]);

  const handleLetterAudio = useCallback((letter: string) => {
    if (adapt.audioEnabled) soundRef.current?.letterSpeak(letter);
  }, [adapt.audioEnabled]);

  const handleAddTime = useCallback(() => {
    if (adapt.timeLimitMs <= 0 || gameState !== 'playing') return;
    setExtraTimeMs((prev) => {
      const next = Math.min(prev + 10_000, 60_000);
      const added = next - prev;
      if (added > 0) {
        setStatusMessage(`Added ${Math.round(added / 1000)} seconds. Keep going!`);
      } else {
        setStatusMessage('Maximum extra time already added.');
      }
      return next;
    });
  }, [adapt.timeLimitMs, gameState]);

  return (
    <section aria-labelledby={headingId} style={{ maxWidth: '600px', margin: '0 auto' }}>
      <style>{`
        @keyframes wordPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes floatLetter {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.04; }
          50% { transform: translateY(-10px) rotate(5deg); opacity: 0.07; }
        }
        @media (prefers-reduced-motion: reduce) {
          .word-start-btn { animation: none !important; }
          .word-bg-letter { animation: none !important; }
        }
      `}</style>

      <h2 id={headingId} style={{ fontSize: '24px', marginBottom: '8px', color: '#1a1a1a' }}>Word Scramble</h2>
      <p style={{ fontSize: '15px', color: '#555', marginBottom: '16px' }}>
        Unscramble the letters to find the hidden word. Type your answer in the text field.
        {adapt.showHints ? ' Hints are available!' : ''}
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

      <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '15px', color: '#333', flexWrap: 'wrap' }}>
        <span>Score: <strong>{score}/{roundsPlayed}</strong></span>
        <span>Round: <strong>{Math.min(roundsPlayed + 1, TOTAL_ROUNDS)}/{TOTAL_ROUNDS}</strong></span>
        {adapt.timeLimitMs > 0 && (
          <span>
            Time: <strong>{Math.ceil(timeLeft / 1000)}s</strong>
            {extraTimeMs > 0 ? ` (+${Math.round(extraTimeMs / 1000)}s added)` : ''}
          </span>
        )}
        {currentWord && <span>Category: <strong>{currentWord.category}</strong></span>}
      </div>

      {gameState === 'idle' && (
        <button
          type="button"
          className="word-start-btn"
          onClick={startGame}
          style={{
            padding: '16px 40px', fontSize: '20px', fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #fb8c00, #f57c00)',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            animation: 'wordPulse 2s ease-in-out infinite',
            marginBottom: '16px',
          }}
        >
          📝 Start Game
        </button>
      )}

      {gameState === 'done' && (
        <div style={{ padding: '16px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#e8f5e9', border: '2px solid #4caf50', textAlign: 'center' }}>
          <p style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32', margin: '0 0 8px 0' }}>📝 Game Over!</p>
          <p style={{ fontSize: '15px', color: '#333', margin: '0 0 4px 0' }}>Score: {score}/{roundsPlayed} correct</p>
          <button type="button" onClick={startGame} style={{ ...actionBtnStyle, marginTop: '12px' }}>Play Again</button>
        </div>
      )}

      {gameState === 'playing' && currentWord && (
        <div style={{
          marginBottom: '20px', position: 'relative', padding: '20px',
          borderRadius: '12px', backgroundColor: '#fffbf0',
          backgroundImage: 'none', overflow: 'hidden',
        }}>
          {/* Floating letter background pattern */}
          <div aria-hidden="true" style={{
            position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0,
          }}>
            {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter, i) => (
              <span
                key={i}
                className="word-bg-letter"
                style={{
                  position: 'absolute',
                  left: `${(i * 47) % 90}%`,
                  top: `${(i * 31) % 85}%`,
                  fontSize: '28px',
                  fontWeight: 700,
                  color: '#000',
                  opacity: 0.04,
                  animation: `floatLetter ${3 + (i % 3)}s ease-in-out ${(i * 0.2) % 2}s infinite`,
                  transform: `rotate(${(i * 15) % 360}deg)`,
                }}
              >
                {letter}
              </span>
            ))}
          </div>

          {/* Scrambled word announced as full string */}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <p style={{ textAlign: 'center', fontSize: '13px', color: '#888', marginBottom: '8px', fontWeight: 500 }}>
              Scrambled word:
            </p>
            <div
              role="group"
              aria-label={`Scrambled letters: ${scrambledWord.split('').join(', ')}. Category: ${currentWord.category}. Type your answer below.`}
              style={{
                display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '16px', flexWrap: 'wrap',
              }}
            >
              {scrambledWord.split('').map((letter, i) => (
                <button
                  key={`${letter}-${i}`}
                  type="button"
                  onClick={() => handleLetterAudio(letter)}
                  aria-label={`Letter ${letter}${adapt.audioEnabled ? '. Click to hear pronunciation.' : ''}`}
                  style={{
                    width: `${Math.max(48, adapt.textSize * 1.8)}px`,
                    height: `${Math.max(48, adapt.textSize * 1.8)}px`,
                    fontSize: `${adapt.textSize}px`, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: adapt.highContrast ? '#1a1a1a' : '#e3f2fd',
                    color: adapt.highContrast ? '#fff' : '#0d47a1',
                    border: `2px solid ${adapt.highContrast ? '#fff' : '#90caf9'}`,
                    borderRadius: '8px', cursor: 'pointer', outline: 'none',
                  }}
                >
                  {letter}
                </button>
              ))}
            </div>

            {/* Hint display */}
            {hintRevealed > 0 && (
              <p style={{ textAlign: 'center', fontSize: '16px', color: '#1565c0', marginBottom: '12px', fontWeight: 600 }}>
                Hint: {currentWord.word.slice(0, hintRevealed)}{'_'.repeat(currentWord.word.length - hintRevealed)}
              </p>
            )}

            {/* Input */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="word-input" style={srOnly}>Type your answer</label>
              <input
                id="word-input"
                ref={inputRef}
                type="text"
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder="Type the word..."
                autoComplete="off"
                aria-describedby={hintRevealed > 0 ? 'word-hint-text' : undefined}
                style={{
                  padding: '10px 16px', fontSize: `${Math.max(18, adapt.textSize * 0.8)}px`,
                  border: `2px solid ${adapt.highContrast ? '#333' : '#ccc'}`, borderRadius: '6px',
                  outline: 'none', width: '200px', textTransform: 'uppercase',
                  backgroundColor: adapt.highContrast ? '#1a1a1a' : '#fff',
                  color: adapt.highContrast ? '#fff' : '#333',
                }}
              />
              <button type="button" onClick={handleSubmit} style={actionBtnStyle}>Submit</button>
              {adapt.showHints && (
                <button type="button" onClick={handleHint} style={{ ...actionBtnStyle, backgroundColor: '#fb8c00' }}>
                  Hint
                </button>
              )}
              {adapt.timeLimitMs > 0 && (
                <button type="button" onClick={handleAddTime} style={{ ...actionBtnStyle, backgroundColor: '#6d4c41' }}>
                  Need more time (+10s)
                </button>
              )}
            </div>
            {hintRevealed > 0 && (
              <p id="word-hint-text" style={srOnly}>
                Hint: the word starts with {currentWord.word.slice(0, hintRevealed).split('').join('-')}
              </p>
            )}
          </div>
        </div>
      )}

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
          <li>Difficulty: {adapt.difficulty} (word length based on pacing)</li>
          <li>Timer: {adapt.timeLimitMs > 0 ? `${adapt.timeLimitMs / 1000}s base (up to +60s extendable)` : 'Disabled'}</li>
          <li>Text size: {adapt.textSize}px</li>
          <li>Hints: {adapt.showHints ? 'Available' : 'Hidden'}</li>
          <li>Audio: {adapt.audioEnabled ? 'Enabled (letter pronunciation)' : 'Disabled — visual feedback active'}</li>
          <li>Audio volume: {Math.round(audioVolume * 100)}%</li>
          <li>Full scrambled word announced for screen readers</li>
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

export default WordScramble;
