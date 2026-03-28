// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConsentForm } from './ConsentForm';
import type { ConsentCategory } from '../types/common';
import type { ConsentForm as ConsentFormData } from '../types/consent';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FORM_DATA: ConsentFormData = {
  categories: [
    {
      category: 'webcam',
      title: 'Webcam & Facial Expression Analysis',
      description: 'Allows the platform to analyse your facial expressions locally.',
      required: false,
    },
    {
      category: 'interaction_patterns',
      title: 'Interaction Pattern Tracking',
      description: 'Allows the platform to observe input timing.',
      required: false,
    },
    {
      category: 'profile_learning',
      title: 'Accessibility Profile Learning',
      description: 'Allows the platform to learn your accessibility preferences.',
      required: false,
    },
    {
      category: 'voice_input',
      title: 'Voice Input & Natural Language Control',
      description: 'Allows the platform to process your voice commands.',
      required: false,
    },
  ],
  version: '1.0.0',
  lastUpdated: Date.now(),
};

const ALL_DENIED: Record<ConsentCategory, boolean> = {
  webcam: false,
  interaction_patterns: false,
  profile_learning: false,
  voice_input: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsentForm', () => {
  it('renders all four consent categories with titles and descriptions', () => {
    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={vi.fn()} />,
    );

    for (const cat of FORM_DATA.categories) {
      expect(screen.getByText(cat.title, { exact: false })).toBeTruthy();
      expect(screen.getByText(cat.description)).toBeTruthy();
    }
  });

  it('renders toggle switches (role="switch") for each category', () => {
    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={vi.fn()} />,
    );

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(4);
  });

  it('shows current consent state as "Denied" when all are denied', () => {
    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={vi.fn()} />,
    );

    const deniedLabels = screen.getAllByText(/Denied/);
    expect(deniedLabels).toHaveLength(4);
  });

  it('shows "Granted" for categories that are granted', () => {
    const consents = { ...ALL_DENIED, webcam: true, voice_input: true };
    render(
      <ConsentForm formData={FORM_DATA} currentConsents={consents} onConsentChange={vi.fn()} />,
    );

    const grantedLabels = screen.getAllByText(/Granted/);
    expect(grantedLabels).toHaveLength(2);
  });

  it('calls onConsentChange when a toggle is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);

    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={onChange} />,
    );

    const switches = screen.getAllByRole('switch');
    await user.click(switches[0]); // webcam toggle

    expect(onChange).toHaveBeenCalledWith('webcam', true);
  });

  it('shows a status message after toggling consent', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);

    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={onChange} />,
    );

    const switches = screen.getAllByRole('switch');
    await user.click(switches[0]);

    // The status region should contain the update message
    const statusRegion = screen.getByRole('status');
    expect(statusRegion.textContent).toContain('Consent granted');
  });

  it('uses a fieldset with legend for grouping', () => {
    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={vi.fn()} />,
    );

    expect(screen.getByRole('group')).toBeTruthy();
    expect(screen.getByText('Consent Categories')).toBeTruthy();
  });

  it('each toggle has an associated label', () => {
    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={vi.fn()} />,
    );

    const switches = screen.getAllByRole('switch');
    for (const sw of switches) {
      // Each switch should have an associated label (via htmlFor/id)
      expect(sw.id).toBeTruthy();
      const label = document.querySelector(`label[for="${sw.id}"]`);
      expect(label).toBeTruthy();
    }
  });

  it('has an aria-live region for status announcements', () => {
    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={vi.fn()} />,
    );

    const statusRegion = screen.getByRole('status');
    expect(statusRegion.getAttribute('aria-live')).toBe('polite');
  });

  it('shows error status when onConsentChange rejects', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockRejectedValue(new Error('Network error'));

    render(
      <ConsentForm formData={FORM_DATA} currentConsents={ALL_DENIED} onConsentChange={onChange} />,
    );

    const switches = screen.getAllByRole('switch');
    await user.click(switches[0]);

    const statusRegion = screen.getByRole('status');
    expect(statusRegion.textContent).toContain('Failed to update consent');
  });
});
