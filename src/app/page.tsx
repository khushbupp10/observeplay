'use client';

import { useState } from 'react';
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
import type { OnboardingObservations } from '../services/profile-learner';

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
  lastUpdated: Date.now(),
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
  lastUpdated: Date.now(),
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

export default function Home() {
  const [view, setView] = useState<AppView>('home');
  const [consents, setConsents] = useState(DEFAULT_CONSENTS);
  const [playerProfile, setPlayerProfile] = useState<AccessibilityProfile | null>(null);

  const handleConsentChange = async (category: ConsentCategory, granted: boolean) => {
    setConsents((prev) => ({ ...prev, [category]: granted }));
  };

  const handleGenerateProfile = async (observations: OnboardingObservations): Promise<AccessibilityProfile> => {
    const profile: AccessibilityProfile = {
      playerId: 'demo-player',
      version: 1,
      lastUpdated: Date.now(),
      inputMethods: observations.detectedInputMethods.length > 0 ? observations.detectedInputMethods : ['keyboard'],
      responseTimeMs: observations.responseTimeSamples.length > 0 ? Math.round(observations.responseTimeSamples.reduce((a, b) => a + b, 0) / observations.responseTimeSamples.length) : 500,
      inputAccuracy: observations.inputAccuracySamples.length > 0 ? observations.inputAccuracySamples[0] : 0.85,
      minReadableTextSize: observations.visualTrackingResults.minReadableTextSize,
      minContrastRatio: observations.visualTrackingResults.minContrastRatio,
      colorBlindnessType: null,
      visualFieldRestriction: null,
      hearingCapability: observations.audioResponsivenessResults.hearingCapability,
      preferredAudioChannel: observations.audioResponsivenessResults.preferredAudioChannel,
      reachableScreenZone: observations.motorAssessment.reachableScreenZone,
      clickPrecision: observations.motorAssessment.clickPrecision,
      holdDuration: observations.motorAssessment.holdDuration,
      preferredPacing: observations.cognitiveAssessment.preferredPacing,
      maxSimultaneousElements: observations.cognitiveAssessment.maxSimultaneousElements,
      preferredInstructionFormat: observations.cognitiveAssessment.preferredInstructionFormat,
      learnedPreferences: {},
      manualOverrides: {},
    };
    return profile;
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
    <div style={{
      '--color-primary': '#667eea',
      '--color-primary-dark': '#764ba2',
      '--color-surface': '#ffffff',
      '--color-text': '#1a1a1a',
      '--color-text-muted': '#555555',
      '--color-accent': '#1a73e8',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: 'var(--color-text)',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
    } as React.CSSProperties}>

      {view === 'home' && (
        <main>
          {/* Hero Section */}
          <section
            aria-label="Welcome to ObservePlay"
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              padding: '64px 24px',
              textAlign: 'center',
              color: '#ffffff',
            }}
          >
            <h1 style={{ fontSize: '48px', fontWeight: 800, margin: '0 0 12px 0', letterSpacing: '-0.5px' }}>
              ObservePlay
            </h1>
            <p style={{ fontSize: '20px', margin: '0 0 32px 0', opacity: 0.92, maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
              AI-powered games that adapt to you. Built from the ground up for accessibility.
            </p>
            <button
              type="button"
              onClick={() => setView('onboarding')}
              style={{
                padding: '14px 36px', fontSize: '18px', fontWeight: 700,
                color: '#667eea', backgroundColor: '#ffffff',
                border: 'none', borderRadius: '8px', cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
              }}
            >
              Get Started
            </button>
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
          <section aria-labelledby="game-hub-heading" style={{ padding: '48px 24px', maxWidth: '960px', margin: '0 auto', width: '100%' }}>
            <h2 id="game-hub-heading" style={{ fontSize: '28px', fontWeight: 700, textAlign: 'center', margin: '0 0 8px 0', color: '#1a1a1a' }}>
              Game Hub
            </h2>
            <p style={{ textAlign: 'center', color: '#555', fontSize: '16px', margin: '0 0 32px 0' }}>
              Choose a game — each one adapts to your accessibility profile.
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
              gap: '20px',
            }}>
              {GAME_CARDS.map(card => (
                <GameCard key={card.view} card={card} onPlay={() => setView(card.view)} />
              ))}
            </div>
          </section>

          {/* AI Game Generator - Coming Soon */}
          <section aria-labelledby="ai-gen-heading" style={{ padding: '0 24px 48px', maxWidth: '960px', margin: '0 auto', width: '100%' }}>
            <div style={{
              width: '100%', padding: '24px', textAlign: 'left',
              border: '2px dashed #667eea', borderRadius: '12px',
              backgroundColor: '#f5f3ff',
              display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#4a3d8f' }}>
                🤖 AI Game Generator <span style={{ fontSize: '13px', fontWeight: 500, backgroundColor: '#667eea', color: '#fff', padding: '2px 8px', borderRadius: '10px', marginLeft: '8px' }}>Coming Soon</span>
              </span>
              <span style={{ fontSize: '14px', color: '#555', lineHeight: 1.4 }}>
                Connect an OpenAI API key to generate custom games from natural language descriptions tailored to your accessibility profile.
              </span>
            </div>
          </section>

          {/* Features Section */}
          <section
            aria-labelledby="features-heading"
            style={{ padding: '48px 24px', backgroundColor: '#f8f9fa' }}
          >
            <div style={{ maxWidth: '960px', margin: '0 auto' }}>
              <h2 id="features-heading" style={{ fontSize: '28px', fontWeight: 700, textAlign: 'center', margin: '0 0 32px 0', color: '#1a1a1a' }}>
                Designed for Everyone
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '24px',
              }}>
                {FEATURES.map(f => (
                  <article key={f.title} style={{ textAlign: 'center', padding: '20px' }}>
                    <span aria-hidden="true" style={{ fontSize: '40px', display: 'block', marginBottom: '12px' }}>{f.emoji}</span>
                    <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 8px 0', color: '#1a1a1a' }}>{f.title}</h3>
                    <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.5, margin: 0 }}>{f.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* Utility Nav */}
          <section aria-labelledby="utility-heading" style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto', width: '100%' }}>
            <h2 id="utility-heading" style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px 0', color: '#1a1a1a' }}>
              Settings & Data
            </h2>
            <nav aria-label="Platform settings">
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <li>
                  <button type="button" onClick={() => setView('onboarding')} style={utilNavBtnStyle}>
                    <span style={utilNavTitleStyle}>{playerProfile ? 'Redo Assessment' : 'Accessibility Onboarding'}</span>
                    <span style={utilNavDescStyle}>Interactive assessment that learns your accessibility needs</span>
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setView('consent')} style={utilNavBtnStyle}>
                    <span style={utilNavTitleStyle}>Privacy & Consent</span>
                    <span style={utilNavDescStyle}>Control what data the platform collects</span>
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setView('dashboard')} style={utilNavBtnStyle}>
                    <span style={utilNavTitleStyle}>Data Dashboard</span>
                    <span style={utilNavDescStyle}>View, download, or delete your data</span>
                  </button>
                </li>
              </ul>
            </nav>
          </section>

          {/* Footer */}
          <footer style={{
            padding: '24px', textAlign: 'center',
            borderTop: '1px solid #e0e0e0', marginTop: 'auto',
            color: '#777', fontSize: '14px',
          }}>
            <p style={{ margin: 0 }}>
              ♿ Built for accessibility — ObservePlay
            </p>
          </footer>
        </main>
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
              onDeleteAccount={async () => { setView('home'); }}
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
    <article
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e0e0e0',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (!mq.matches) {
          (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLElement).style.transform = 'none';
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '36px' }}>{card.emoji}</span>
      <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#1a1a1a' }}>{card.title}</h3>
      <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.4, margin: 0, flex: 1 }}>{card.description}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
        <span style={{
          fontSize: '12px', fontWeight: 600, padding: '3px 10px',
          borderRadius: '12px', color: '#fff',
          backgroundColor: card.difficultyColor,
        }}>
          {card.difficulty}
        </span>
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${card.title}`}
          style={{
            padding: '8px 20px', fontSize: '14px', fontWeight: 600,
            color: '#fff', backgroundColor: '#667eea',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Play
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const backNavStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '14px',
  color: '#667eea',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  marginBottom: '16px',
  textDecoration: 'underline',
};

const profileBannerStyle: React.CSSProperties = {
  padding: '10px 16px',
  margin: '16px 24px',
  borderRadius: '6px',
  backgroundColor: '#e8f5e9',
  color: '#1b5e20',
  border: '1px solid #a5d6a7',
};

const utilNavBtnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  width: '100%',
  padding: '14px 18px',
  border: '1px solid #d0d0d0',
  borderRadius: '8px',
  backgroundColor: '#fafafa',
  cursor: 'pointer',
  textAlign: 'left',
};

const utilNavTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#667eea',
  fontSize: '16px',
  marginBottom: '2px',
};

const utilNavDescStyle: React.CSSProperties = {
  color: '#555',
  fontSize: '13px',
  lineHeight: 1.4,
};
