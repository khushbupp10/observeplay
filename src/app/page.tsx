'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { ConsentForm } from '../components/ConsentForm';
import { DataDashboard } from '../components/DataDashboard';
import { OnboardingGame } from '../components/OnboardingGame';
import { GameGenerator } from '../components/GameGenerator';
import { MemoryGame } from '../components/MemoryGame';
import { ReactionGame } from '../components/ReactionGame';
import { SimonGame } from '../components/SimonGame';
import { WordScramble } from '../components/WordScramble';
import { WhackAMole } from '../components/WhackAMole';
import type { ConsentCategory } from '../types/common';
import type { ConsentForm as ConsentFormData } from '../types/consent';
import type { AccessibilityProfile } from '../types/player';
import { buildProfileFromOnboardingObservations } from '../services/profile-learner';
import { clearAdaptationTelemetry } from '../utils/adaptation-telemetry';

// Apply accessibility profile settings to the document body as CSS classes
function applyProfileToBody(profile: AccessibilityProfile) {
  if (typeof document === 'undefined') return;
  const body = document.body;

  // Remove all profile classes first
  body.classList.remove('profile-large-text', 'profile-xlarge-text', 'profile-high-contrast', 'profile-slow-pacing');

  // Font size based on minReadableTextSize
  if (profile.minReadableTextSize >= 24) {
    body.classList.add('profile-xlarge-text');
  } else if (profile.minReadableTextSize >= 20) {
    body.classList.add('profile-large-text');
  }

  // High contrast based on minContrastRatio
  if (profile.minContrastRatio > 4.5) {
    body.classList.add('profile-high-contrast');
  }

  // Slow pacing
  if (profile.preferredPacing === 'slow') {
    body.classList.add('profile-slow-pacing');
  }
}

type AppView =
  | 'home' | 'consent' | 'onboarding' | 'dashboard' | 'play'
  | 'memory' | 'reaction' | 'simon' | 'wordscramble' | 'whackamole';

const CONSENT_FORM_DATA: ConsentFormData = {
  categories: [
    { category: 'webcam', title: 'Webcam & Facial Expression Analysis', description: 'Allows the platform to analyse your facial expressions locally on your device to detect frustration or confusion. No raw video is stored or transmitted.', required: false },
    { category: 'interaction_patterns', title: 'Interaction Pattern Tracking', description: 'Allows the platform to observe input timing, pause frequency, and error rates to adapt difficulty and pacing.', required: false },
    { category: 'profile_learning', title: 'Accessibility Profile Learning', description: 'Allows the platform to learn your accessibility preferences by observing how you interact.', required: false },
    { category: 'voice_input', title: 'Voice Input & Natural Language Control', description: 'Allows the platform to process your voice commands for conversational game control.', required: false },
  ],
  version: '1.0.0',
  lastUpdated: 0,
};

const DEFAULT_CONSENTS: Record<ConsentCategory, boolean> = {
  webcam: false,
  interaction_patterns: false,
  profile_learning: false,
  voice_input: false,
};

const DEFAULT_PROFILE: AccessibilityProfile = {
  playerId: 'demo-player',
  version: 1,
  lastUpdated: 0,
  inputMethods: ['keyboard', 'mouse'],
  responseTimeMs: 500,
  inputAccuracy: 0.85,
  minReadableTextSize: 16,
  minContrastRatio: 4.5,
  colorBlindnessType: null,
  visualFieldRestriction: null,
  hearingCapability: 'full',
  preferredAudioChannel: 'stereo',
  reachableScreenZone: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1920, y: 1080 } },
  clickPrecision: 10,
  holdDuration: 1000,
  preferredPacing: 'moderate',
  maxSimultaneousElements: 5,
  preferredInstructionFormat: 'multimodal',
  learnedPreferences: {},
  manualOverrides: {},
};

interface GameCardInfo {
  view: AppView;
  emoji: string;
  title: string;
  description: string;
  difficulty: string;
  difficultyColor: string;
}

const GAME_CARDS: GameCardInfo[] = [
  {
    view: 'play',
    emoji: '🤖',
    title: 'AI Game Generator',
    description: 'Describe the game you want in plain language. We generate a playable experience tailored to your accessibility profile.',
    difficulty: 'Featured',
    difficultyColor: '#5c6bc0',
  },
  { view: 'memory', emoji: '🃏', title: 'Memory Match', description: 'Find matching pairs of cards. Tests memory and pattern recognition.', difficulty: 'Easy', difficultyColor: '#2e7d32' },
  { view: 'reaction', emoji: '⚡', title: 'Reaction Speed', description: 'Click colored circles before they vanish. Tests reflexes and precision.', difficulty: 'Medium', difficultyColor: '#e65100' },
  { view: 'simon', emoji: '🎵', title: 'Simon Says', description: 'Watch and repeat growing color sequences. Tests memory and focus.', difficulty: 'Medium', difficultyColor: '#e65100' },
  { view: 'wordscramble', emoji: '📝', title: 'Word Scramble', description: 'Unscramble letters to find hidden words. Tests language skills.', difficulty: 'Easy', difficultyColor: '#2e7d32' },
  { view: 'whackamole', emoji: '🔨', title: 'Whack-a-Mole', description: 'Whack moles as they pop up from holes. Tests speed and accuracy.', difficulty: 'Medium', difficultyColor: '#e65100' },
];

const FEATURES = [
  { emoji: '👁️', title: 'Observation Profiling', description: 'Learns your accessibility needs by watching how you play — no questionnaires needed.' },
  { emoji: '🔊', title: 'Adaptive Audio', description: 'Spatial audio cues and tones adapt to your hearing capability in real time.' },
  { emoji: '✨', title: 'Visual Feedback', description: 'Screen flashes, text indicators, and high-contrast modes for deaf and low-vision players.' },
  { emoji: '⌨️', title: 'Keyboard First', description: 'Every game is fully navigable and playable with keyboard alone.' },
];

const heroBannerStyle: CSSProperties = {
  padding: '80px 24px 72px',
  textAlign: 'center',
  color: '#ffffff',
  position: 'relative',
  overflow: 'hidden',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 40%, #f093fb 70%, #667eea 100%)',
  backgroundSize: '300% 300%',
  animation: 'gradientShift 8s ease infinite',
};

const heroShapeBase: CSSProperties = {
  position: 'absolute',
  borderRadius: '50%',
  opacity: 0.12,
  pointerEvents: 'none',
};

function useClickRipple() {
  const spawn = useCallback((x: number, y: number) => {
    const el = document.createElement('div');
    el.className = 'a11y-ripple';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }, []);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => spawn(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) spawn(t.clientX, t.clientY);
    };
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('touchstart', onTouch, { passive: true, capture: true });
    return () => {
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('touchstart', onTouch, true);
    };
  }, [spawn]);
}

export default function Home() {
  const [view, setView] = useState<AppView>('home');
  const [consents, setConsents] = useState(DEFAULT_CONSENTS);
  const [playerProfile, setPlayerProfile] = useState<AccessibilityProfile | null>(null);

  useClickRipple();

  const handleConsentChange = async (category: ConsentCategory, granted: boolean) => {
    setConsents((prev) => ({ ...prev, [category]: granted }));
  };

  const handleGenerateProfile = async (observations: Parameters<typeof buildProfileFromOnboardingObservations>[0]): Promise<AccessibilityProfile> => {
    return buildProfileFromOnboardingObservations(observations, 'demo-player');
  };

  const handleSaveProfile = async (profile: AccessibilityProfile) => {
    setPlayerProfile(profile);
    // Apply profile-driven CSS classes to the body element
    applyProfileToBody(profile);
    setView('home');
  };

  const handleGameComplete = (score: number, timeMs: number) => {
    console.log(`Game complete: ${score} score in ${timeMs}ms`);
  };

  const activeProfile = playerProfile ?? DEFAULT_PROFILE;
  const isGameView = view !== 'home' && view !== 'consent' && view !== 'onboarding' && view !== 'dashboard' && view !== 'play';

  return (
    <div data-app-root style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: 'inherit',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
    }}>

      {view === 'home' && (
        <div role="region" aria-label="Home">
          {/* Hero Section */}
          <section aria-label="Welcome to ObservePlay" data-hero-banner style={heroBannerStyle}>
            <A11yBackgroundIcons icons={HERO_SCATTERED} />
            <div
              data-hero-shape
              style={{
                ...heroShapeBase,
                width: 300,
                height: 300,
                background: 'radial-gradient(circle, #fff 0%, transparent 70%)',
                top: -80,
                right: -60,
                animation: 'float 7s ease-in-out infinite',
              }}
            />
            <div
              data-hero-shape
              style={{
                ...heroShapeBase,
                width: 200,
                height: 200,
                background: 'radial-gradient(circle, #f093fb 0%, transparent 70%)',
                bottom: -40,
                left: -30,
                animation: 'float 9s ease-in-out infinite reverse',
              }}
            />
            <div
              data-hero-shape
              style={{
                ...heroShapeBase,
                width: 120,
                height: 120,
                background: 'radial-gradient(circle, #667eea 0%, transparent 70%)',
                top: '40%',
                left: '15%',
                animation: 'float 6s ease-in-out infinite 1s',
              }}
            />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <p style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', opacity: 0.85, margin: '0 0 12px 0' }}>
                AI-Powered Accessible Gaming
              </p>
              <h1 style={{ fontSize: '56px', fontWeight: 800, margin: '0 0 16px 0', letterSpacing: '-1px', lineHeight: 1.1 }}>
                ObservePlay
              </h1>
              <p style={{ fontSize: '20px', margin: '0 0 36px 0', opacity: 0.92, maxWidth: '540px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                Games that watch how you play and adapt in real time. Designed from the ground up so everyone can play.
              </p>
              <button
                type="button"
                onClick={() => setView('onboarding')}
                style={{
                  padding: '16px 40px', fontSize: '18px', fontWeight: 700,
                  color: '#667eea', backgroundColor: '#ffffff',
                  border: 'none', borderRadius: '12px', cursor: 'pointer',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 12px 40px rgba(0,0,0,0.22)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 30px rgba(0,0,0,0.18)'; }}
              >
                Get Started
              </button>
            </div>
          </section>

          {/* Profile Banner */}
          {playerProfile && (
            <div style={profileBannerStyle} role="status">
              <p style={{ margin: 0, fontSize: '14px' }}>
                Profile active — Input: {playerProfile.inputMethods.join(', ')} |
                Response: {playerProfile.responseTimeMs}ms |
                Hearing: {playerProfile.hearingCapability}
              </p>
            </div>
          )}

          {/* Game Hub */}
          <section aria-labelledby="game-hub-heading" style={{ padding: '56px 24px', maxWidth: '1000px', margin: '0 auto', width: '100%', position: 'relative' }}>
            <A11yBackgroundIcons icons={HUB_SCATTERED} />
            <div style={{ textAlign: 'center', marginBottom: '40px' }}>
              <span style={{ display: 'inline-block', fontSize: '13px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#667eea', marginBottom: '8px' }}>
                Pick Your Game
              </span>
              <h2 id="game-hub-heading" style={{ fontSize: '32px', fontWeight: 800, margin: '0 0 8px 0', color: '#1a1a1a', letterSpacing: '-0.3px' }}>
                Game Hub
              </h2>
              <p style={{ color: '#555', fontSize: '16px', margin: '0 auto', maxWidth: '480px' }}>
                Every game adapts to your accessibility profile in real time.
              </p>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '24px',
            }}>
              {GAME_CARDS.map(card => (
                <GameCard key={card.view} card={card} onPlay={() => setView(card.view)} />
              ))}
            </div>
          </section>

          {/* Features Section */}
          <section
            aria-labelledby="features-heading"
            className="section-pattern"
            style={{ padding: '56px 24px' }}
          >
            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                <span style={{ display: 'inline-block', fontSize: '13px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#764ba2', marginBottom: '8px' }}>
                  Why ObservePlay
                </span>
                <h2 id="features-heading" style={{ fontSize: '32px', fontWeight: 800, margin: '0', color: '#1a1a1a', letterSpacing: '-0.3px' }}>
                  Designed for Everyone
                </h2>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '20px',
              }}>
                {FEATURES.map(f => (
                  <article key={f.title} className="feature-card">
                    <div className="feature-icon" aria-hidden="true">{f.emoji}</div>
                    <h3 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 6px 0', color: '#1a1a1a' }}>{f.title}</h3>
                    <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.5, margin: 0 }}>{f.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* Utility Nav */}
          <section aria-labelledby="utility-heading" style={{ padding: '40px 24px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
            <h2 id="utility-heading" style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 20px 0', color: '#1a1a1a' }}>
              Settings &amp; Data
            </h2>
            <nav aria-label="Platform settings">
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                <li>
                  <button type="button" onClick={() => setView('onboarding')} className="util-btn-creative">
                    <span style={utilNavTitleStyle}>🎯 {playerProfile ? 'Redo Assessment' : 'Accessibility Onboarding'}</span>
                    <span style={utilNavDescStyle}>Interactive assessment that learns your accessibility needs</span>
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setView('consent')} className="util-btn-creative">
                    <span style={utilNavTitleStyle}>🔒 Privacy &amp; Consent</span>
                    <span style={utilNavDescStyle}>Control what data the platform collects</span>
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setView('dashboard')} className="util-btn-creative">
                    <span style={utilNavTitleStyle}>📊 Data Dashboard</span>
                    <span style={utilNavDescStyle}>View, download, or delete your data</span>
                  </button>
                </li>
              </ul>
            </nav>
          </section>

          {/* Footer */}
          <footer className="footer-creative" style={{
            padding: '28px', textAlign: 'center',
            marginTop: 'auto',
            color: '#666', fontSize: '14px',
          }}>
            <p style={{ margin: 0 }}>
              ♿ Built for accessibility — <strong style={{ color: '#667eea' }}>ObservePlay</strong>
            </p>
          </footer>
        </div>
      )}

      {/* Sub-views */}
      {view !== 'home' && (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0', width: '100%', flex: 1, overflow: 'hidden' }}>
          {/* Large accessible back button */}
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            padding: '12px 24px',
            marginBottom: '0',
          }}>
            <button
              type="button"
              onClick={() => setView('home')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '10px',
                padding: '12px 24px', fontSize: '16px', fontWeight: 700,
                color: '#667eea', backgroundColor: '#ffffff',
                border: 'none', borderRadius: '8px', cursor: 'pointer',
                minHeight: '48px', minWidth: '160px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}
              aria-label="Back to Home"
            >
              ← Back to Home
            </button>
          </div>

          {playerProfile && isGameView && (
            <div style={{ ...profileBannerStyle, margin: '0 0 16px 0' }} role="status">
              <p style={{ margin: 0, fontSize: '14px' }}>
                ♿ Profile active — Input: {playerProfile.inputMethods.join(', ')} |
                Response: {playerProfile.responseTimeMs}ms |
                Hearing: {playerProfile.hearingCapability}
              </p>
            </div>
          )}

          {view === 'play' && (
            <div style={{ padding: '16px' }}>
              <GameGenerator profile={activeProfile} />
            </div>
          )}
          {view === 'memory' && (
            <GameWrapper theme={{ gradient: 'linear-gradient(135deg, #1a237e 0%, #283593 100%)', emoji: '🃏', title: 'Memory Match' }}>
              <MemoryGame profile={activeProfile} onGameComplete={handleGameComplete} />
            </GameWrapper>
          )}
          {view === 'reaction' && (
            <GameWrapper theme={{ gradient: 'linear-gradient(135deg, #b71c1c 0%, #e53935 100%)', emoji: '⚡', title: 'Reaction Speed' }}>
              <ReactionGame profile={activeProfile} onGameComplete={handleGameComplete} />
            </GameWrapper>
          )}
          {view === 'simon' && (
            <GameWrapper theme={{ gradient: 'linear-gradient(135deg, #1b5e20 0%, #388e3c 100%)', emoji: '🎵', title: 'Simon Says' }}>
              <SimonGame profile={activeProfile} onGameComplete={handleGameComplete} />
            </GameWrapper>
          )}
          {view === 'wordscramble' && (
            <GameWrapper theme={{ gradient: 'linear-gradient(135deg, #4a148c 0%, #7b1fa2 100%)', emoji: '📝', title: 'Word Scramble' }}>
              <WordScramble profile={activeProfile} onGameComplete={handleGameComplete} />
            </GameWrapper>
          )}
          {view === 'whackamole' && (
            <GameWrapper theme={{ gradient: 'linear-gradient(135deg, #e65100 0%, #f57c00 100%)', emoji: '🔨', title: 'Whack-a-Mole' }}>
              <WhackAMole profile={activeProfile} onGameComplete={handleGameComplete} />
            </GameWrapper>
          )}

          {view === 'consent' && (
            <div style={{ padding: '16px' }}>
              <ConsentForm
                formData={CONSENT_FORM_DATA}
                currentConsents={consents}
                onConsentChange={handleConsentChange}
              />
            </div>
          )}

          {view === 'onboarding' && (
            <div style={{ padding: '16px' }}>
              <OnboardingGame
                onGenerateProfile={handleGenerateProfile}
                onSaveProfile={handleSaveProfile}
              />
            </div>
          )}

          {view === 'dashboard' && (
            <div style={{ padding: '16px' }}>
              <DataDashboard
              data={{
                collectedData: Object.entries(consents)
                  .filter(([, granted]) => granted)
                  .map(([cat]) => ({
                    category: cat,
                    description: `Data collected for ${cat.replace(/_/g, ' ')}`,
                    dataPointCount: Math.floor(Math.random() * 50),
                    lastCollected: Date.now() - Math.floor(Math.random() * 86400000),
                    retentionDays: 90,
                  })),
                lastAccessed: {},
                storageUsed: 0,
              }}
              onExportData={async () => ({
                exportedAt: Date.now(),
                format: 'json' as const,
                player: { demo: true },
                gameHistory: [],
              })}
              onDeleteAccount={async () => {
                clearAdaptationTelemetry();
                setView('home');
              }}
            />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GameWrapper — themed header for each game
// ---------------------------------------------------------------------------

interface GameWrapperProps {
  theme: { gradient: string; emoji: string; title: string };
  children: React.ReactNode;
}

function GameWrapper({ theme, children }: GameWrapperProps) {
  return (
    <div>
      {/* Themed game header */}
      <div style={{
        background: theme.gradient,
        padding: '24px',
        marginBottom: '24px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        <span aria-hidden="true" style={{ fontSize: '48px', lineHeight: 1 }}>{theme.emoji}</span>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.3px' }}>
            {theme.title}
          </h2>
          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', margin: '4px 0 0 0' }}>
            Adapted to your accessibility profile
          </p>
        </div>
      </div>
      {/* Decorative dots pattern */}
      <div className="game-wrapper-content" style={{
        padding: '16px',
        background: 'radial-gradient(circle, rgba(102,126,234,0.06) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        borderRadius: '0 0 12px 12px',
        marginBottom: '8px',
        maxWidth: '100%',
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  );
}

function GameCard({ card, onPlay }: { card: GameCardInfo; onPlay: () => void }) {
  return (
    <article className="card-creative" style={{ display: 'flex', flexDirection: 'column', gap: '10px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div className="feature-icon" aria-hidden="true" style={{ width: '52px', height: '52px', borderRadius: '14px', fontSize: '26px', flexShrink: 0 }}>
          {card.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#1a1a1a' }}>{card.title}</h3>
          <span style={{
            display: 'inline-block', fontSize: '11px', fontWeight: 700, padding: '2px 8px', marginTop: '3px',
            borderRadius: '10px', color: '#fff', backgroundColor: card.difficultyColor, letterSpacing: '0.3px',
          }}>
            {card.difficulty}
          </span>
        </div>
      </div>
      <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.5, margin: 0, flex: 1 }}>{card.description}</p>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${card.title}`}
        style={{
          padding: '10px 0', fontSize: '15px', fontWeight: 700,
          color: '#fff',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          border: 'none', borderRadius: '10px', cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(102,126,234,0.25)',
          transition: 'box-shadow 0.2s ease, transform 0.15s ease',
          width: '100%', marginTop: '4px',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(102,126,234,0.35)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(102,126,234,0.25)'; (e.currentTarget as HTMLElement).style.transform = 'none'; }}
      >
        Play Now
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Decorative accessibility icons scattered in background
// ---------------------------------------------------------------------------

const A11Y_ICONS = [
  // Wheelchair
  <svg key="wheelchair" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-2 7h4v5l3.5 3.5-1.4 1.4L12 14.8V9Zm-3 4.5a5.5 5.5 0 1 0 5.26 7.12l-1.88-.68A3.5 3.5 0 1 1 7 13.5Z"/></svg>,
  // Eye
  <svg key="eye" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>,
  // Ear
  <svg key="ear" viewBox="0 0 24 24" fill="currentColor"><path d="M17 20c-.29 0-.56-.06-.76-.15-.71-.37-1.21-.88-1.71-2.38-.51-1.56-1.47-2.29-2.39-3-.79-.61-1.61-1.24-2.32-2.53C9.29 11 9 9.93 9 9c0-3.31 2.69-6 6-6s6 2.69 6 6h-2c0-2.21-1.79-4-4-4s-4 1.79-4 4c0 .65.17 1.39.56 2.21.5 1.02 1.15 1.52 1.88 2.09 1 .77 2.13 1.64 2.79 3.63.35 1.06.68 1.38.88 1.49.21.06.43.01.68-.11l.88 1.78c-.51.27-1.06.41-1.58.41Z"/><path d="M11 9c0 1.1.9 2 2 2v2c-2.21 0-4-1.79-4-4h2ZM7 9c0 4.42 3.58 8 8 8v2c-5.52 0-10-4.48-10-10h2Z"/></svg>,
  // Keyboard
  <svg key="keyboard" viewBox="0 0 24 24" fill="currentColor"><path d="M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm-9 3h2v2h-2Zm0 3h2v2h-2ZM8 8h2v2H8Zm0 3h2v2H8ZM5 8h2v2H5Zm0 3h2v2H5Zm2 5H5v-2h2Zm8 0H9v-2h6Zm2 0h-2v-2h2Zm0-3h-2v-2h2Zm0-3h-2V8h2Zm3 3h-2v-2h2Zm0-3h-2V8h2Z"/></svg>,
  // Brain / cognitive
  <svg key="brain" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-4.56 1.69A5 5 0 0 0 2 9a5.5 5.5 0 0 0 2.28 4.46A4.5 4.5 0 0 0 6 22h5v-4h2v4h5a4.5 4.5 0 0 0 1.72-8.54A5.5 5.5 0 0 0 22 9a5 5 0 0 0-5.44-5.31A7 7 0 0 0 12 2Zm0 2a5 5 0 0 1 3.53 1.47l.7.7.92-.38A3 3 0 0 1 20 9a3.5 3.5 0 0 1-1.6 2.93l-.8.52.32.9A2.5 2.5 0 0 1 16 16h-3v-4h-2v4H8a2.5 2.5 0 0 1-1.92-3.65l.32-.9-.8-.52A3.5 3.5 0 0 1 4 9a3 3 0 0 1 2.85-3.21l.92.38.7-.7A5 5 0 0 1 12 4Z"/></svg>,
  // Touch / hand
  <svg key="hand" viewBox="0 0 24 24" fill="currentColor"><path d="M9 1.5c1.1 0 2 .9 2 2V8l6.38-1.96c.48-.16 1 .15 1.12.65l.02.1c.1.55-.2 1.1-.72 1.28L12 10v2.46l5.62-1.73c.48-.16 1 .16 1.12.66l.02.1c.1.54-.2 1.08-.72 1.26L12 14.5v2.48l4.62-1.42c.49-.15 1 .17 1.12.67l.02.1c.1.54-.2 1.08-.72 1.26L12 19v1.5c0 .83-.67 1.5-1.5 1.5H9c-2.76 0-5-2.24-5-5V3.5C4 2.4 4.9 1.5 6 1.5Zm0 2H6v14c0 1.66 1.34 3 3 3h.5V3.5Z"/></svg>,
  // Gamepad
  <svg key="gamepad" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2Zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3Zm4.5 2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4-3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>,
];

interface ScatteredIcon { icon: number; x: number; y: number; size: number; duration: number; delay: number }

const HERO_SCATTERED: ScatteredIcon[] = [
  { icon: 0, x: 8, y: 25, size: 32, duration: 14, delay: 0 },
  { icon: 1, x: 85, y: 18, size: 26, duration: 11, delay: 2 },
  { icon: 3, x: 72, y: 70, size: 28, duration: 16, delay: 1 },
  { icon: 6, x: 20, y: 72, size: 24, duration: 13, delay: 3 },
  { icon: 4, x: 90, y: 55, size: 22, duration: 10, delay: 4 },
];

const HUB_SCATTERED: ScatteredIcon[] = [
  { icon: 2, x: 5, y: 12, size: 28, duration: 15, delay: 0 },
  { icon: 5, x: 92, y: 8, size: 24, duration: 12, delay: 1 },
  { icon: 0, x: 88, y: 75, size: 30, duration: 17, delay: 2 },
  { icon: 3, x: 10, y: 80, size: 22, duration: 11, delay: 3 },
  { icon: 1, x: 50, y: 5, size: 20, duration: 14, delay: 5 },
  { icon: 6, x: 48, y: 90, size: 26, duration: 13, delay: 1.5 },
];

function A11yBackgroundIcons({ icons }: { icons: ScatteredIcon[] }) {
  return (
    <div className="a11y-bg-icons" aria-hidden="true">
      {icons.map((item, i) => (
        <span
          key={i}
          className="a11y-bg-icon"
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            width: item.size,
            height: item.size,
            color: '#667eea',
            '--drift-duration': `${item.duration}s`,
            '--drift-delay': `${item.delay}s`,
          } as CSSProperties}
        >
          {A11Y_ICONS[item.icon]}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const profileBannerStyle: CSSProperties = {
  padding: '10px 16px',
  margin: '16px 24px',
  borderRadius: '8px',
  backgroundColor: '#e8f5e9',
  color: '#1b5e20',
  border: '1px solid #a5d6a7',
};

const utilNavTitleStyle: CSSProperties = {
  fontWeight: 700,
  color: '#667eea',
  fontSize: '16px',
  marginBottom: '3px',
};

const utilNavDescStyle: CSSProperties = {
  color: '#555',
  fontSize: '13px',
  lineHeight: 1.4,
};
