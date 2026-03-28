'use client';

import { useState, useCallback, useRef, useEffect, useId } from 'react';
import type { DataDashboard as DataDashboardData, PlayerDataExport } from '../types/consent';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DataDashboardProps {
  /** Dashboard data from ConsentManagerService.getDataDashboard() */
  data: DataDashboardData;
  /** Called to export player data as JSON */
  onExportData: () => Promise<PlayerDataExport>;
  /** Called to delete the player's account */
  onDeleteAccount: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(timestamp: number): string {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  webcam: 'Webcam & Emotion Data',
  interaction_patterns: 'Interaction Patterns',
  profile_learning: 'Accessibility Profile',
  voice_input: 'Voice Input',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataDashboard({ data, onExportData, onDeleteAccount }: DataDashboardProps) {
  const [statusMessage, setStatusMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const dialogTitleId = useId();
  const dialogDescId = useId();

  const showStatus = useCallback((message: string) => {
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    setStatusMessage(message);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(''), 5000);
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const exportData = await onExportData();
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `player-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showStatus('Your data has been downloaded as JSON.');
    } catch {
      showStatus('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [onExportData, showStatus]);

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    // Restore focus to the trigger button
    deleteButtonRef.current?.focus();
  }, []);

  // Focus the cancel button when dialog opens
  useEffect(() => {
    if (showDeleteConfirm) {
      cancelButtonRef.current?.focus();
    }
  }, [showDeleteConfirm]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDeleteAccount();
      closeDeleteConfirm();
      showStatus('Your account and all personal data have been scheduled for deletion.');
    } catch {
      showStatus('Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }, [onDeleteAccount, closeDeleteConfirm, showStatus]);

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Your Data Dashboard</h2>
      <p>
        See what data has been collected, how it is used, and when it was last accessed.
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

      {/* Storage summary */}
      <p style={storageSummaryStyle}>
        Total storage used: <strong>{formatBytes(data.storageUsed)}</strong>
      </p>

      {/* Collected data table */}
      {data.collectedData.length > 0 ? (
        <table style={tableStyle} aria-label="Collected data categories">
          <thead>
            <tr>
              <th scope="col" style={thStyle}>Category</th>
              <th scope="col" style={thStyle}>Description</th>
              <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Data Points</th>
              <th scope="col" style={thStyle}>Last Collected</th>
              <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Retention</th>
            </tr>
          </thead>
          <tbody>
            {data.collectedData.map((item) => (
              <tr key={item.category}>
                <td style={tdStyle}>{CATEGORY_LABELS[item.category] ?? item.category}</td>
                <td style={tdStyle}>{item.description}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.dataPointCount}</td>
                <td style={tdStyle}>{formatDate(item.lastCollected)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.retentionDays} days</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No data has been collected yet. Enable consent categories to allow data collection.</p>
      )}

      {/* Last accessed timestamps */}
      {Object.keys(data.lastAccessed).length > 0 && (
        <>
          <h3>Last Access Timestamps</h3>
          <dl style={dlStyle}>
            {Object.entries(data.lastAccessed).map(([key, timestamp]) => (
              <div key={key} style={dlRowStyle}>
                <dt style={dtStyle}>{CATEGORY_LABELS[key] ?? key}</dt>
                <dd style={ddStyle}>{formatDate(timestamp)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {/* Action buttons */}
      <div style={actionsStyle}>
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          style={primaryButtonStyle}
        >
          {isExporting ? 'Downloading…' : 'Download My Data'}
        </button>

        <button
          ref={deleteButtonRef}
          type="button"
          onClick={openDeleteConfirm}
          disabled={isDeleting}
          style={dangerButtonStyle}
        >
          Delete My Account
        </button>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div style={overlayStyle} onClick={closeDeleteConfirm}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescId}
            style={dialogStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeDeleteConfirm();
            }}
          >
            <h3 id={dialogTitleId}>Delete Your Account?</h3>
            <p id={dialogDescId}>
              This will permanently remove all your personal data, including your accessibility
              profile, gameplay history, and emotion state logs. This action cannot be undone.
              Deletion will be completed within 48 hours.
            </p>
            <div style={dialogActionsStyle}>
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={closeDeleteConfirm}
                style={secondaryButtonStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                style={dangerButtonStyle}
              >
                {isDeleting ? 'Deleting…' : 'Yes, Delete My Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Styles
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

const storageSummaryStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#333',
  marginBottom: '16px',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: '24px',
  fontSize: '14px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '2px solid #333',
  fontWeight: 600,
  color: '#1a1a1a',
  backgroundColor: '#f5f5f5',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #ddd',
  color: '#333',
  verticalAlign: 'top',
};

const dlStyle: React.CSSProperties = {
  marginBottom: '24px',
};

const dlRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  padding: '8px 0',
  borderBottom: '1px solid #eee',
};

const dtStyle: React.CSSProperties = {
  fontWeight: 600,
  minWidth: '200px',
  color: '#1a1a1a',
};

const ddStyle: React.CSSProperties = {
  margin: 0,
  color: '#444',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  marginTop: '16px',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '15px',
  fontWeight: 500,
  color: '#fff',
  backgroundColor: '#1a73e8',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '15px',
  fontWeight: 500,
  color: '#333',
  backgroundColor: '#e0e0e0',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};

const dangerButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '15px',
  fontWeight: 500,
  color: '#fff',
  backgroundColor: '#d32f2f',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};

const dialogStyle: React.CSSProperties = {
  maxWidth: '480px',
  padding: '24px',
  borderRadius: '8px',
  border: '1px solid #ccc',
  backgroundColor: '#fff',
  position: 'relative',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  justifyContent: 'flex-end',
  marginTop: '20px',
};

export default DataDashboard;
