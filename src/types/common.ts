// Shared enums, union types, and small interfaces used across the platform

export type Genre = 'puzzle' | 'adventure' | 'strategy' | 'simulation' | 'narrative';

export type InputMethod =
  | 'keyboard'
  | 'mouse'
  | 'touch'
  | 'voice'
  | 'single_switch'
  | 'eye_tracking'
  | 'head_tracking'
  | 'sip_puff'
  | 'gamepad';

export type ColorBlindnessType =
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'achromatopsia';

export type EmotionCategory =
  | 'engaged'
  | 'frustrated'
  | 'confused'
  | 'disengaged'
  | 'neutral';

export type ConsentCategory =
  | 'webcam'
  | 'interaction_patterns'
  | 'profile_learning'
  | 'voice_input';

export type CommunicationChannel = 'speech' | 'text' | 'audio_cue';

export type SupportedLanguage = 'en' | 'es' | 'fr' | 'de' | 'ja';

export interface SpatialPosition {
  azimuth: number;    // horizontal angle in degrees (-180 to 180)
  elevation: number;  // vertical angle in degrees (-90 to 90)
  distance: number;   // relative distance (0.0 to 1.0)
}

export interface ScreenZone {
  topLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
}

export interface VisualFieldRestriction {
  type: 'tunnel' | 'hemianopia_left' | 'hemianopia_right' | 'scotoma';
  severityPercent: number;
}
