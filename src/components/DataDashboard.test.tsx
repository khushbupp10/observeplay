// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataDashboard } from './DataDashboard';
import type { DataDashboard as DataDashboardData, PlayerDataExport } from '../types/consent';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1718000000000;

const DASHBOARD_DATA: DataDashboardData = {
  collectedData: [
    {
      category: 'webcam',
      description: 'Emotion state classifications derived from facial expression analysis',
      dataPointCount: 42,
      lastCollected: NOW - 3600_000,
      retentionDays: 90,
    },
    {
      category: 'interaction_patterns',
      description: 'Barrier events and interaction pattern data',
      dataPointCount: 15,
      lastCollected: NOW - 7200_000,
      retentionDays: 180,
    },
  ],
  lastAccessed: {
    webcam: NOW - 3600_000,
    interaction_patterns: NOW - 7200_000,
  },
  storageUsed: 13120,
};

const EMPTY_DASHBOARD: DataDashboardData = {
  collectedData: [],
  lastAccessed: {},
  storageUsed: 0,
};

const MOCK_EXPORT: PlayerDataExport = {
  exportedAt: NOW,
  format: 'json',
  player: { createdAt: NOW - 86400_000 },
  gameHistory: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataDashboard', () => {
  let onExportData: ReturnType<typeof vi.fn>;
  let onDeleteAccount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onExportData = vi.fn().mockResolvedValue(MOCK_EXPORT);
    onDeleteAccount = vi.fn().mockResolvedValue(undefined);
  });

  it('renders the dashboard heading', () => {
    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    expect(screen.getByRole('heading', { name: /your data dashboard/i })).toBeTruthy();
  });

  it('displays storage usage', () => {
    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    expect(screen.getByText(/12.8 KB/)).toBeTruthy();
  });

  it('renders a table with collected data categories', () => {
    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    const table = screen.getByRole('table');
    expect(table).toBeTruthy();

    // Check column headers
    expect(screen.getByText('Category')).toBeTruthy();
    expect(screen.getByText('Data Points')).toBeTruthy();
    expect(screen.getByText('Retention')).toBeTruthy();

    // Check data rows — category names appear in both table and dl, so use getAllByText
    expect(screen.getAllByText('Webcam & Emotion Data').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('90 days')).toBeTruthy();
    expect(screen.getAllByText('Interaction Patterns').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('15')).toBeTruthy();
  });

  it('shows empty state when no data collected', () => {
    render(
      <DataDashboard data={EMPTY_DASHBOARD} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    expect(screen.getByText(/no data has been collected/i)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('displays last access timestamps', () => {
    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    expect(screen.getByText('Last Access Timestamps')).toBeTruthy();
    // Definition list terms — also appear in the table, so use getAllByText
    expect(screen.getAllByText('Webcam & Emotion Data').length).toBe(2);
  });

  it('renders Download My Data and Delete My Account buttons', () => {
    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    expect(screen.getByRole('button', { name: /download my data/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeTruthy();
  });

  it('calls onExportData and triggers download when Download button is clicked', async () => {
    const user = userEvent.setup();

    // Mock URL.createObjectURL and revokeObjectURL
    const createObjectURL = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;

    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    await user.click(screen.getByRole('button', { name: /download my data/i }));

    expect(onExportData).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('shows confirmation dialog when Delete My Account is clicked', async () => {
    const user = userEvent.setup();

    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    await user.click(screen.getByRole('button', { name: /delete my account/i }));

    // The dialog should now be visible
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/delete your account\?/i)).toBeTruthy();
    expect(screen.getByText(/permanently remove/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /yes, delete my account/i })).toBeTruthy();
  });

  it('calls onDeleteAccount when confirmed in the dialog', async () => {
    const user = userEvent.setup();

    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete my account/i }));

    expect(onDeleteAccount).toHaveBeenCalledOnce();
  });

  it('closes dialog when Cancel is clicked without deleting', async () => {
    const user = userEvent.setup();

    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onDeleteAccount).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has an aria-live region for status announcements', () => {
    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    const statusRegion = screen.getByRole('status');
    expect(statusRegion.getAttribute('aria-live')).toBe('polite');
  });

  it('shows status message after successful export', async () => {
    const user = userEvent.setup();
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();

    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    await user.click(screen.getByRole('button', { name: /download my data/i }));

    const statusRegion = screen.getByRole('status');
    expect(statusRegion.textContent).toContain('downloaded');
  });

  it('table has proper scope attributes on headers', () => {
    render(
      <DataDashboard data={DASHBOARD_DATA} onExportData={onExportData} onDeleteAccount={onDeleteAccount} />,
    );

    const headers = screen.getAllByRole('columnheader');
    for (const header of headers) {
      expect(header.getAttribute('scope')).toBe('col');
    }
  });
});
