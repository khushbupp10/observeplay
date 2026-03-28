'use client';

import { useState, useCallback, useRef, useId } from 'react';
import type { ConsentCategory } from '../types/common';
import type { ConsentForm as ConsentFormData, ConsentFormCategory } from '../types/consent';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConsentFormProps {
  /** Consent form definition from ConsentManagerService.getConsentForm() */
  formData: ConsentFormData;
  /** Current consent state per category (true = granted) */
  currentConsents: Record<ConsentCategory, boolean>;
  /** Called when the player toggles a category */
  onConsentChange: (category: ConsentCategory, granted: boolean) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConsentForm({ formData, currentConsents, onConsentChange }: ConsentFormProps) {
  const [consents, setConsents] = useState<Record<ConsentCategory, boolean>>(currentConsents);
  const [statusMessage, setStatusMessage] = useState('');
  const [updatingCategory, setUpdatingCategory] = useState<ConsentCategory | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formLabelId = useId();

  const showStatus = useCallback((message: string) => {
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    setStatusMessage(message);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(''), 4000);
  }, []);

  const handleToggle = useCallback(
    async (category: ConsentCategory) => {
      const newValue = !consents[category];
      setUpdatingCategory(category);
      try {
        await onConsentChange(category, newValue);
        setConsents((prev) => ({ ...prev, [category]: newValue }));
        const label = formData.categories.find((c) => c.category === category)?.title ?? category;
        showStatus(`${label}: ${newValue ? 'Consent granted' : 'Consent revoked'}`);
      } catch {
        showStatus('Failed to update consent. Please try again.');
      } finally {
        setUpdatingCategory(null);
      }
    },
    [consents, onConsentChange, formData.categories, showStatus],
  );

  return (
    <section aria-labelledby={formLabelId}>
      <h2 id={formLabelId}>Data Collection Consent</h2>
      <p>
        Choose which data the platform may collect. All options are opt-in. You can change your
        preferences at any time.
      </p>

      {/* Live region for status announcements */}
      <div aria-live="polite" aria-atomic="true" role="status" style={srOnly}>
        {statusMessage}
      </div>

      {/* Visible status banner */}
      {statusMessage && (
        <p style={statusBannerStyle} role="presentation">
          {statusMessage}
        </p>
      )}

      <form onSubmit={(e) => e.preventDefault()}>
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Consent Categories</legend>

          {formData.categories.map((cat) => (
            <ConsentToggle
              key={cat.category}
              category={cat}
              checked={consents[cat.category]}
              disabled={updatingCategory === cat.category}
              onToggle={handleToggle}
            />
          ))}
        </fieldset>
      </form>
    </section>
  );
}


// ---------------------------------------------------------------------------
// ConsentToggle — individual toggle for one data category
// ---------------------------------------------------------------------------

interface ConsentToggleProps {
  category: ConsentFormCategory;
  checked: boolean;
  disabled: boolean;
  onToggle: (category: ConsentCategory) => void;
}

function ConsentToggle({ category, checked, disabled, onToggle }: ConsentToggleProps) {
  const descriptionId = `consent-desc-${category.category}`;
  const inputId = `consent-toggle-${category.category}`;

  return (
    <div style={toggleContainerStyle}>
      <div style={toggleHeaderStyle}>
        <label htmlFor={inputId} style={labelStyle}>
          <span style={toggleSwitchWrapperStyle}>
            <input
              id={inputId}
              type="checkbox"
              role="switch"
              checked={checked}
              disabled={disabled}
              aria-describedby={descriptionId}
              onChange={() => onToggle(category.category)}
              style={checkboxStyle}
            />
            <span style={switchTrackStyle(checked)} aria-hidden="true">
              <span style={switchThumbStyle(checked)} />
            </span>
          </span>
          <span style={labelTextStyle}>
            {category.title}
            <span style={stateTextStyle}>
              {' '}
              — {checked ? 'Granted' : 'Denied'}
            </span>
          </span>
        </label>
      </div>
      <p id={descriptionId} style={descriptionStyle}>
        {category.description}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (inline to keep the component self-contained)
// ---------------------------------------------------------------------------

const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const statusBannerStyle: React.CSSProperties = {
  padding: '8px 12px',
  marginBottom: '16px',
  borderRadius: '4px',
  backgroundColor: '#e8f5e9',
  color: '#1b5e20',
  border: '1px solid #a5d6a7',
  fontSize: '14px',
};

const fieldsetStyle: React.CSSProperties = {
  border: 'none',
  padding: 0,
  margin: 0,
};

const legendStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  marginBottom: '16px',
  color: '#1a1a1a',
};

const toggleContainerStyle: React.CSSProperties = {
  padding: '16px',
  marginBottom: '12px',
  border: '1px solid #d0d0d0',
  borderRadius: '8px',
  backgroundColor: '#fafafa',
};

const toggleHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  cursor: 'pointer',
  width: '100%',
};

const labelTextStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 500,
  color: '#1a1a1a',
};

const stateTextStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 400,
  color: '#555',
};

const descriptionStyle: React.CSSProperties = {
  marginTop: '8px',
  marginBottom: 0,
  fontSize: '14px',
  color: '#444',
  lineHeight: 1.5,
};

const toggleSwitchWrapperStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
};

/** The native checkbox is visually hidden but remains focusable. */
const checkboxStyle: React.CSSProperties = {
  position: 'absolute',
  width: '44px',
  height: '24px',
  opacity: 0,
  margin: 0,
  cursor: 'pointer',
};

const switchTrackStyle = (checked: boolean): React.CSSProperties => ({
  display: 'inline-block',
  width: '44px',
  height: '24px',
  borderRadius: '12px',
  backgroundColor: checked ? '#1a73e8' : '#888',
  transition: 'background-color 0.2s',
  position: 'relative',
  pointerEvents: 'none',
  /* Focus ring is handled via CSS below — the native input sits on top */
});

const switchThumbStyle = (checked: boolean): React.CSSProperties => ({
  display: 'block',
  width: '18px',
  height: '18px',
  borderRadius: '50%',
  backgroundColor: '#fff',
  position: 'absolute',
  top: '3px',
  left: checked ? '23px' : '3px',
  transition: 'left 0.2s',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
});

export default ConsentForm;
