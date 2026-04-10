import type { AccessibilityProfile } from '../types/player';

const DEFAULT_AUDIO_VOLUME = 0.7;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUDIO_VOLUME;
  return Math.max(0, Math.min(1, value));
}

export function getProfileAudioVolume(profile: AccessibilityProfile): number {
  const manual = profile.manualOverrides?.audioVolume;
  if (typeof manual === 'number') return clamp(manual);

  const learned = profile.learnedPreferences?.audioVolume;
  if (typeof learned === 'number') return clamp(learned);

  return DEFAULT_AUDIO_VOLUME;
}
