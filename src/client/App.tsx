import React, { useEffect, useState, useMemo } from 'react';
import type {
  AggregateReport,
  AppSettings,
  FlairMetrics,
  ReportApiResponse,
  SettingsApiResponse,
  SyncApiResponse,
  SyncStatus,
  UserStatusApiResponse
} from '../types.js';
import { formatExportCsv, formatExportJson } from '../services/storage.js';
import {
  createSimulatedReport,
  DEFAULT_MOCK_SETTINGS,
  MOCK_AVAILABLE_FLAIRS,
  MOCK_REPORT,
  MOCK_USER_STATUS
} from './mockData.js';

type MetricType = 'median' | 'avg' | 'total';

const FLAIR_PALETTE = [
  '#0284c7', // Sky
  '#7c3aed', // Violet
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626', // Red
  '#db2777', // Pink
  '#2563eb', // Blue
  '#0d9488', // Teal
  '#ea580c', // Orange
  '#4f46e5'  // Indigo
];

function getFlairColor(flairText: string, index: number): string {
  if (flairText === 'Unflaired') return '#475569';
  return FLAIR_PALETTE[index % FLAIR_PALETTE.length];
}

export function App() {
  const [report, setReport] = useState<AggregateReport | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [userStatus, setUserStatus] = useState<UserStatusApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLocalPreview, setIsLocalPreview] = useState<boolean>(false);

  // App Settings state
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_MOCK_SETTINGS);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [modMenuOpen, setModMenuOpen] = useState<boolean>(false);

  // Settings form fields
  const [editPublicDashboard, setEditPublicDashboard] = useState<boolean>(true);
  const [editAutoSidebarWidget, setEditAutoSidebarWidget] = useState<boolean>(true);
  const [editLookbackDays, setEditLookbackDays] = useState<number>(90);
  const [editMaxPosts, setEditMaxPosts] = useState<number>(1000);
  const [editMinThreshold, setEditMinThreshold] = useState<number>(5);
  const [editCustomGroupsRaw, setEditCustomGroupsRaw] = useState<string>('');
  const [availableSubredditFlairs, setAvailableSubredditFlairs] = useState<string[]>([]);
  const [isPrivateScreen, setIsPrivateScreen] = useState<boolean>(false);

  // Sidebar widget modal & state
  const [sidebarModalOpen, setSidebarModalOpen] = useState<boolean>(false);
  const [syncingWidget, setSyncingWidget] = useState<boolean>(false);
  const [widgetSyncResult, setWidgetSyncResult] = useState<{ success: boolean; text: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState<boolean>(false);

  // Visualization focus state
  const [metric, setMetric] = useState<MetricType>('median');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');

  const handleToggleExpand = () => {
    try {
      window.parent.postMessage(
        {
          type: 'devvit-internal',
          scope: 'CLIENT',
          effect_type: 4,
          immersiveMode: { immersiveMode: isExpanded ? 0 : 1 }
        },
        '*'
      );
    } catch {
      // Ignore if not embedded in Reddit iframe
    }
    setIsExpanded((prev) => !prev);
  };

  // Mod controls & Export modal
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [copied, setCopied] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const syncSettingsState = (newSettings: AppSettings) => {
    setSettings(newSettings);
    setEditPublicDashboard(newSettings.publicDashboard ?? true);
    setEditAutoSidebarWidget(newSettings.autoSidebarWidget ?? true);
    setEditLookbackDays(newSettings.lookbackDays ?? 90);
    setEditMaxPosts(newSettings.maxPosts ?? 1000);
    setEditMinThreshold(newSettings.minPostsThreshold ?? 5);
    setEditCustomGroupsRaw(newSettings.customGroupsRaw ?? '');
  };

  const validationError = useMemo(() => {
    if (editMaxPosts > 1000) {
      return 'Reddit API Hard Cap: Maximum submissions cannot exceed 1,000. Reddit enforces a strict hard ceiling of 1,000 items on all subreddit listings.';
    }
    if (editMaxPosts < 50) {
      return 'Minimum sample size cannot be less than 50 submissions to calculate statistically reliable medians.';
    }
    if (editLookbackDays < 1 || editLookbackDays > 365) {
      return 'Lookback window must be between 1 and 365 days.';
    }
    if (editMinThreshold < 1) {
      return 'Minimum highlight threshold must be at least 1 post.';
    }
    return null;
  }, [editMaxPosts, editLookbackDays, editMinThreshold]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [userRes, reportRes] = await Promise.all([
        fetch('/api/user-status').then((r) => r.json() as Promise<UserStatusApiResponse>).catch(() => null),
        fetch('/api/report').then((r) => r.json() as Promise<ReportApiResponse>).catch(() => null)
      ]);

      if (reportRes?.isPrivate) {
        setIsPrivateScreen(true);
        setReport(null);
        if (userRes) setUserStatus(userRes);
        if (reportRes.settings) syncSettingsState(reportRes.settings);
      } else if (reportRes?.report) {
        setIsPrivateScreen(false);
        setReport(reportRes.report);
        setSyncStatus(reportRes.syncStatus ?? null);
        if (userRes) setUserStatus(userRes);

        const eff = reportRes.settings || userRes?.settings || reportRes.report.settingsUsed;
        if (eff) syncSettingsState(eff);

        const flairs = reportRes.availableFlairs || userRes?.availableFlairs;
        if (flairs && flairs.length > 0) {
          setAvailableSubredditFlairs(flairs);
        } else if (reportRes.report?.flairBreakdown) {
          setAvailableSubredditFlairs(
            reportRes.report.flairBreakdown
              .map((f) => f.flairText)
              .filter((t) => t && t !== 'Unflaired')
          );
        }
      } else {
        setIsLocalPreview(true);
        setIsPrivateScreen(false);
        setReport(MOCK_REPORT);
        setUserStatus(userRes || MOCK_USER_STATUS);
        syncSettingsState(DEFAULT_MOCK_SETTINGS);
        setAvailableSubredditFlairs(MOCK_AVAILABLE_FLAIRS);
      }
    } catch {
      setIsLocalPreview(true);
      setIsPrivateScreen(false);
      setReport(MOCK_REPORT);
      setUserStatus(MOCK_USER_STATUS);
      syncSettingsState(DEFAULT_MOCK_SETTINGS);
      setAvailableSubredditFlairs(MOCK_AVAILABLE_FLAIRS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleManualSync = async () => {
    if (isLocalPreview) {
      setSyncing(true);
      setTimeout(() => {
        const simulated = createSimulatedReport(settings);
        setReport(simulated);
        setSyncing(false);
        showToast(`Local Preview: Simulated ${settings.lookbackDays}-day sync completed!`);
      }, 600);
      return;
    }

    try {
      setSyncing(true);
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = (await res.json()) as SyncApiResponse;

      if (data.success && data.report) {
        setReport(data.report);
        showToast(data.message || 'Sync completed successfully!');
        const reportRes = await fetch('/api/report').then((r) => r.json());
        if (reportRes?.syncStatus) setSyncStatus(reportRes.syncStatus);
      } else {
        showToast(data.error || 'Sync request failed.');
      }
    } catch (err: any) {
      showToast(err?.message || 'Error executing sync.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveSettings = async () => {
    if (validationError) {
      showToast(`Cannot save: ${validationError}`);
      return;
    }

    setSavingSettings(true);
    const updated: AppSettings = {
      publicDashboard: editPublicDashboard,
      lookbackDays: Number(editLookbackDays) || 90,
      maxPosts: Number(editMaxPosts) || 1000,
      minPostsThreshold: Number(editMinThreshold) || 5,
      customGroupsRaw: editCustomGroupsRaw,
      autoSidebarWidget: editAutoSidebarWidget
    };

    if (isLocalPreview) {
      setTimeout(() => {
        setSettings(updated);
        const simulatedReport = createSimulatedReport(updated);
        setReport(simulatedReport);
        setSavingSettings(false);
        setSettingsModalOpen(false);
        setSelectedGroup('all');
        showToast(`Settings saved! Visibility: ${updated.publicDashboard ? 'Public' : 'Private (Mod-Only)'}.`);
      }, 500);
      return;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = (await res.json()) as SettingsApiResponse;

      if (data.success && data.settings) {
        setSettings(data.settings);
        if (data.report) setReport(data.report);
        setSettingsModalOpen(false);
        setSelectedGroup('all');
        showToast('Subreddit settings saved & synced successfully!');
      } else {
        showToast(data.error || 'Failed to update settings.');
      }
    } catch (err: any) {
      showToast(err?.message || 'Error saving settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const currentSubredditName = report?.subredditName || userStatus?.subredditName || 'flair_impact_dev';

  const dashboardDirectUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location.href.includes('/comments/')) {
      return window.location.href;
    }
    return `https://www.reddit.com/r/${currentSubredditName}/`;
  }, [currentSubredditName]);

  const markdownWidgetSnippet = useMemo(() => {
    return `### 📊 Flair Impact & Response Dashboard\n\nExplore how many comments posts receive by flair:\n\n[**👉 Open Interactive Dashboard**](${dashboardDirectUrl})`;
  }, [dashboardDirectUrl]);

  const handleSyncSidebarWidget = async () => {
    setSyncingWidget(true);
    setWidgetSyncResult(null);

    if (isLocalPreview) {
      setTimeout(() => {
        setSyncingWidget(false);
        setWidgetSyncResult({
          success: true,
          text: '✓ Local Preview Mode: Simulated adding "Flair Analytics" button to sidebar!'
        });
        showToast('✓ Subreddit sidebar widget synchronized!');
      }, 600);
      return;
    }

    try {
      const res = await fetch('/api/sidebar-widget', { method: 'POST' });
      const data = (await res.json()) as any;
      if (data.success) {
        setWidgetSyncResult({
          success: true,
          text: data.message || '✓ Successfully added button widget to your subreddit sidebar!'
        });
        showToast('✓ Subreddit sidebar widget updated!');
      } else {
        setWidgetSyncResult({
          success: false,
          text: data.message || data.error || 'Could not automatically add widget.'
        });
      }
    } catch (err: any) {
      setWidgetSyncResult({
        success: false,
        text: `Error connecting to widget API: ${err?.message || 'Network error'}`
      });
    } finally {
      setSyncingWidget(false);
    }
  };

  const handleCopyDashboardUrl = () => {
    navigator.clipboard.writeText(dashboardDirectUrl);
    setCopiedUrl(true);
    showToast('✓ Direct dashboard link copied to clipboard!');
    setTimeout(() => setCopiedUrl(false), 3000);
  };

  const handleCopyMarkdownSnippet = () => {
    navigator.clipboard.writeText(markdownWidgetSnippet);
    setCopiedMarkdown(true);
    showToast('✓ Markdown sidebar widget code copied!');
    setTimeout(() => setCopiedMarkdown(false), 3000);
  };

  const discoveredFlairs = useMemo(() => {
    if (availableSubredditFlairs.length > 0) return availableSubredditFlairs;
    if (report?.flairBreakdown) {
      return report.flairBreakdown
        .map((f) => f.flairText)
        .filter((t) => t && t !== 'Unflaired');
    }
    return MOCK_AVAILABLE_FLAIRS;
  }, [availableSubredditFlairs, report]);

  const handlePopulateSubredditFlairs = () => {
    if (discoveredFlairs.length === 0) {
      showToast('No post flairs found for this subreddit.');
      return;
    }

    if (discoveredFlairs.length <= 3) {
      setEditCustomGroupsRaw(`Primary Flairs: ${discoveredFlairs.join(', ')}`);
    } else {
      const mid = Math.ceil(discoveredFlairs.length / 2);
      const group1 = discoveredFlairs.slice(0, mid).join(', ');
      const group2 = discoveredFlairs.slice(mid).join(', ');
      setEditCustomGroupsRaw(`Group A: ${group1}\nGroup B: ${group2}`);
    }
    showToast(`Loaded ${discoveredFlairs.length} subreddit flairs into template!`);
  };

  const handleInsertFlair = (flairText: string) => {
    setEditCustomGroupsRaw((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return `Group 1: ${flairText}`;
      if (trimmed.endsWith(':') || trimmed.endsWith(',')) return `${prev} ${flairText}`;
      if (trimmed.endsWith('\n')) return `${prev}Group: ${flairText}`;
      return `${prev}, ${flairText}`;
    });
  };

  const getMetricValue = (item: FlairMetrics, m: MetricType): number => {
    if (m === 'median') return item.medianComments;
    if (m === 'avg') return item.avgComments;
    return item.totalComments;
  };

  const rankedFlairs = useMemo(() => {
    if (!report) return [];

    let list = [...report.flairBreakdown];

    if (selectedGroup !== 'all') {
      if (selectedGroup === '__ungrouped__') {
        list = list.filter((f) => !f.assignedGroup);
      } else {
        list = list.filter((f) => f.assignedGroup === selectedGroup);
      }
    }

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      list = list.filter((f) => f.flairText.toLowerCase().includes(q));
    }

    list.sort((a, b) => getMetricValue(b, metric) - getMetricValue(a, metric));
    return list;
  }, [report, selectedGroup, searchQuery, metric]);

  const maxMetricValue = useMemo(() => {
    if (rankedFlairs.length === 0) return 1;
    return Math.max(...rankedFlairs.map((f) => getMetricValue(f, metric)), 1);
  }, [rankedFlairs, metric]);

  const benchmarkInfo = useMemo(() => {
    if (!report) return { value: 0, label: '' };
    if (metric === 'median') {
      return {
        value: report.overallMedianComments,
        label: `Community Baseline: ${report.overallMedianComments} typical comments / post`
      };
    }
    if (metric === 'avg') {
      return {
        value: report.overallAvgComments,
        label: `Community Baseline: ${report.overallAvgComments} average comments / post`
      };
    }
    const avgTotal = Math.round(
      report.overallTotalComments / Math.max(1, report.flairBreakdown.length)
    );
    return {
      value: avgTotal,
      label: `Average Total Volume per Flair: ${avgTotal.toLocaleString()} comments`
    };
  }, [report, metric]);

  const ungroupedCount = useMemo(() => {
    if (!report) return 0;
    return report.flairBreakdown.filter((f) => !f.assignedGroup).length;
  }, [report]);

  const exportText = useMemo(() => {
    if (!report) return '';
    return exportFormat === 'csv' ? formatExportCsv(report) : formatExportJson(report);
  }, [report, exportFormat]);

  const handleCopyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Clipboard copy failed. Please select and copy manually.');
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <div style={{ marginTop: 14, fontSize: 14, fontWeight: 500 }}>
          Ranking comment activity by post flair...
        </div>
      </div>
    );
  }

  const isMod = userStatus?.isModerator ?? false;

  // Regular user visiting a private dashboard
  if (!isMod && (isPrivateScreen || !settings.publicDashboard)) {
    return (
      <div style={styles.container}>
        {toastMessage && <div style={styles.toast}>{toastMessage}</div>}

        {isLocalPreview && (
          <div style={styles.previewBanner}>
            <div style={styles.previewInfo}>
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>💻 Local Preview:</span>
              <span style={{ color: '#cbd5e1', marginLeft: 8 }}>
                Viewing as Regular User (Private Mode Active).
              </span>
            </div>
            <button
              style={styles.previewToggle}
              onClick={() =>
                setUserStatus((prev) => ({
                  isModerator: !prev?.isModerator,
                  subredditName: prev?.subredditName || 'community_preview',
                  username: prev?.username || 'tester',
                  settings
                }))
              }
            >
              Switch Role: {userStatus?.isModerator ? '👑 Moderator' : '👤 Regular User'}
            </button>
          </div>
        )}

        <div style={styles.privateScreenBox}>
          <div style={styles.privateIcon}>🔒</div>
          <h2 style={styles.privateTitle}>Moderator-Only Analytics</h2>
          <p style={styles.privateSubtitle}>
            The moderation team of <strong>r/{userStatus?.subredditName || report?.subredditName || 'this community'}</strong> has configured flair analytics to be private.
          </p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div style={styles.errorContainer}>
        <h3 style={{ color: '#ff585b', marginBottom: 8 }}>Unable to Load Analysis</h3>
        <p style={{ color: '#818384', marginBottom: 16 }}>{error || 'No report data found.'}</p>
        <button style={styles.primaryButton} onClick={loadData}>
          Try Again
        </button>
      </div>
    );
  }

  const hasCustomGroups = Boolean(report.groupSummaries && report.groupSummaries.length > 0);
  const showSearch = report.flairBreakdown.length > 6 || searchQuery.trim().length > 0;

  return (
    <div style={styles.container}>
      {toastMessage && <div style={styles.toast}>{toastMessage}</div>}

      {/* Local Browser Sandbox Bar */}
      {isLocalPreview && (
        <div style={styles.previewBanner}>
          <div style={styles.previewInfo}>
            <span style={{ fontWeight: 700, color: '#38bdf8' }}>💻 Local Sandbox:</span>
            <span style={{ color: '#cbd5e1', marginLeft: 8 }}>
              Previewing with {report.totalPostsAnalyzed} simulated posts.
            </span>
          </div>
          <button
            style={styles.previewToggle}
            onClick={() =>
              setUserStatus((prev) => ({
                isModerator: !prev?.isModerator,
                subredditName: prev?.subredditName || 'community_preview',
                username: prev?.username || 'tester',
                settings
              }))
            }
          >
            Role: {userStatus?.isModerator ? '👑 Moderator' : '👤 User'}
          </button>
        </div>
      )}

      {/* Main Card Container */}
      <div style={styles.mainCard}>
        {/* Top Header Row: Title + Metric Toggle + Mod Gear */}
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <h1 style={styles.title}>
              💬 How Many Comments Do Posts Receive?
            </h1>
            <div style={styles.subtitle}>
              r/{report.subredditName} •{' '}
              {metric === 'median' &&
                `Ranked by typical (median) comments per post over the past ${report.windowDays} days (${report.totalPostsAnalyzed} posts)`}
              {metric === 'avg' &&
                `Ranked by average comments per post over the past ${report.windowDays} days (${report.totalPostsAnalyzed} posts)`}
              {metric === 'total' &&
                `Ranked by cumulative comments across all posts in the past ${report.windowDays} days (${report.overallTotalComments.toLocaleString()} total)`}
            </div>
          </div>

          <div style={styles.headerControls}>
            {/* Metric Toggle Pills */}
            <div style={styles.metricToggleGroup}>
              <button
                style={metric === 'median' ? styles.metricPillActive : styles.metricPill}
                onClick={() => setMetric('median')}
                title="Typical comments per post (filters out single viral outlier posts)"
              >
                Median (Typical)
              </button>
              <button
                style={metric === 'avg' ? styles.metricPillActive : styles.metricPill}
                onClick={() => setMetric('avg')}
                title="Mathematical average comments per post"
              >
                Average
              </button>
              <button
                style={metric === 'total' ? styles.metricPillActive : styles.metricPill}
                onClick={() => setMetric('total')}
                title="Total comments across all posts with this flair"
              >
                Total
              </button>
            </div>

            <button
              style={styles.iconButton}
              onClick={handleToggleExpand}
              title={isExpanded ? 'Exit full screen' : 'Expand view'}
            >
              {isExpanded ? '🗗' : '⛶'}
            </button>

            {isMod && (
              <button
                style={modMenuOpen ? styles.modMenuButtonActive : styles.modMenuButton}
                onClick={() => setModMenuOpen((prev) => !prev)}
              >
                ⚙️ Mod Menu
              </button>
            )}
          </div>
        </header>

        {/* Collapsible Moderator Drawer */}
        {isMod && modMenuOpen && (
          <div style={styles.modDrawer}>
            <div style={styles.modDrawerLeft}>
              <span style={settings.publicDashboard ? styles.visibilityPublicBadge : styles.visibilityPrivateBadge}>
                {settings.publicDashboard ? '🌐 Public' : '🔒 Mod-Only'}
              </span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                Updated {new Date(report.generatedAt).toLocaleDateString()}
              </span>
            </div>
            <div style={styles.modDrawerActions}>
              <button
                style={syncing ? styles.buttonDisabled : styles.modActionBtn}
                onClick={handleManualSync}
                disabled={syncing}
              >
                {syncing ? '⏳ Syncing...' : '↻ Sync Now'}
              </button>
              <button
                style={styles.modActionBtn}
                onClick={() => {
                  setEditPublicDashboard(settings.publicDashboard ?? true);
                  setEditAutoSidebarWidget(settings.autoSidebarWidget ?? true);
                  setEditLookbackDays(settings.lookbackDays);
                  setEditMaxPosts(settings.maxPosts);
                  setEditMinThreshold(settings.minPostsThreshold);
                  setEditCustomGroupsRaw(settings.customGroupsRaw || '');
                  setSettingsModalOpen(true);
                }}
              >
                ⚙️ Settings
              </button>
              <button style={styles.modActionBtnAccent} onClick={() => setSidebarModalOpen(true)}>
                📌 Sidebar Widget
              </button>
              <button style={styles.modActionBtn} onClick={() => setExportModalOpen(true)}>
                📥 Export
              </button>
            </div>
          </div>
        )}

        {/* Optional Group Filter & Search Bar */}
        {(hasCustomGroups || showSearch) && (
          <div style={styles.filterBar}>
            {hasCustomGroups ? (
              <div style={styles.groupPillsWrapper}>
                <button
                  style={selectedGroup === 'all' ? styles.groupPillActive : styles.groupPill}
                  onClick={() => setSelectedGroup('all')}
                >
                  All Flairs ({report.flairBreakdown.length})
                </button>
                {report.groupSummaries?.map((g) => (
                  <button
                    key={g.groupName}
                    style={selectedGroup === g.groupName ? styles.groupPillActive : styles.groupPill}
                    onClick={() => setSelectedGroup(g.groupName)}
                  >
                    {g.groupName} ({g.flairCount})
                  </button>
                ))}
                {ungroupedCount > 0 && (
                  <button
                    style={selectedGroup === '__ungrouped__' ? styles.groupPillActive : styles.groupPill}
                    onClick={() => setSelectedGroup('__ungrouped__')}
                  >
                    Other ({ungroupedCount})
                  </button>
                )}
              </div>
            ) : (
              <div />
            )}

            {showSearch && (
              <input
                type="text"
                placeholder="Filter flairs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
            )}
          </div>
        )}

        {/* Ranked Horizontal Bar Leaderboard */}
        {report.totalPostsAnalyzed === 0 ? (
          <div style={styles.emptyStateBanner}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🌱</div>
            <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 15 }}>
              No Post Activity Yet
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
              Once posts with flairs are submitted on <strong>r/{report.subredditName}</strong>, their comment rankings will appear here.
            </div>
          </div>
        ) : rankedFlairs.length === 0 ? (
          <div style={styles.emptyStateBanner}>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              No flairs match "{searchQuery}".
            </div>
          </div>
        ) : (
          <div style={styles.leaderboardList}>
            {(() => {
              let benchmarkInserted = false;
              const elements: React.ReactNode[] = [];

              rankedFlairs.forEach((item, idx) => {
                const val = getMetricValue(item, metric);
                const pct = Math.max(5, Math.round((val / maxMetricValue) * 100));
                const color = getFlairColor(item.flairText, idx);

                if (
                  !benchmarkInserted &&
                  searchQuery.trim() === '' &&
                  selectedGroup === 'all' &&
                  val < benchmarkInfo.value &&
                  idx > 0
                ) {
                  benchmarkInserted = true;
                  elements.push(
                    <div key="__baseline_divider__" style={styles.benchmarkRow}>
                      <div style={styles.benchmarkLine} />
                      <span style={styles.benchmarkLabel}>{benchmarkInfo.label}</span>
                      <div style={styles.benchmarkLine} />
                    </div>
                  );
                }

                const rankBadgeStyle =
                  idx === 0
                    ? styles.rankGold
                    : idx === 1
                    ? styles.rankSilver
                    : idx === 2
                    ? styles.rankBronze
                    : styles.rankDefault;

                elements.push(
                  <div key={item.flairText} style={styles.barRow}>
                    {/* Rank Badge */}
                    <div style={rankBadgeStyle}>#{idx + 1}</div>

                    {/* Flair Pill */}
                    <div style={styles.flairCell}>
                      <span
                        style={{
                          ...styles.flairBadge,
                          backgroundColor: color
                        }}
                        title={item.flairText}
                      >
                        {item.flairText}
                      </span>
                    </div>

                    {/* Horizontal Bar + Metric Value */}
                    <div style={styles.barTrackWrapper}>
                      <div style={styles.barTrack}>
                        <div
                          style={{
                            ...styles.barFill,
                            width: `${pct}%`,
                            backgroundColor: color
                          }}
                        />
                      </div>
                      <div style={styles.metricReadout}>
                        {metric === 'total'
                          ? `${val.toLocaleString()} comments`
                          : `${val} comments / post`}
                      </div>
                    </div>

                    {/* Post Sample Size */}
                    <div style={styles.sampleCell}>
                      {item.postCount} {item.postCount === 1 ? 'post' : 'posts'}
                    </div>
                  </div>
                );
              });

              return elements;
            })()}
          </div>
        )}
      </div>

      {/* App Properties & Configuration Modal (Moderators) */}
      {settingsModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  ⚙️ Subreddit App Settings
                </h2>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                  Configure lookback days, visibility, and optional flair groups.
                </div>
              </div>
              <button style={styles.closeButton} onClick={() => setSettingsModalOpen(false)}>
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              {/* Public Dashboard Transparency Toggle */}
              <div style={styles.visibilityCard}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={editPublicDashboard}
                    onChange={(e) => setEditPublicDashboard(e.target.checked)}
                    style={styles.checkboxInput}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>
                      🌐 Public Community Dashboard (Transparency Mode)
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                      {editPublicDashboard
                        ? 'Active: All community members can view flair comment rankings.'
                        : 'Private: Only subreddit moderators can view this dashboard.'}
                    </div>
                  </div>
                </label>
              </div>

              {/* Auto-Add Sidebar Widget Property */}
              <div style={styles.visibilityCard}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={editAutoSidebarWidget}
                    onChange={(e) => setEditAutoSidebarWidget(e.target.checked)}
                    style={styles.checkboxInput}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>
                      📌 Auto-Add Sidebar Widget
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                      {editAutoSidebarWidget
                        ? 'Active: Automatically maintain a "Flair Analytics" button widget in your subreddit sidebar.'
                        : 'Disabled: Subreddit sidebar will not be automatically updated.'}
                    </div>
                  </div>
                </label>
              </div>

              <div style={styles.formRow}>
                <div style={styles.formField}>
                  <label style={styles.label}>Lookback Period (Days):</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={editLookbackDays}
                    onChange={(e) => setEditLookbackDays(Number(e.target.value))}
                    style={editLookbackDays > 365 || editLookbackDays < 1 ? styles.textInputError : styles.textInput}
                  />
                  <div style={styles.helpText}>Days in the past to scan (1 to 365). Default: 90</div>
                </div>

                <div style={styles.formField}>
                  <label style={styles.label}>Max Posts to Scan:</label>
                  <input
                    type="number"
                    min={50}
                    step={50}
                    value={editMaxPosts}
                    onChange={(e) => setEditMaxPosts(Number(e.target.value))}
                    style={editMaxPosts > 1000 || editMaxPosts < 50 ? styles.textInputError : styles.textInput}
                  />
                  <div style={styles.helpText}>50 to 1,000 (Reddit API listing cap).</div>
                </div>
              </div>

              <div style={styles.formGroup}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ ...styles.label, marginBottom: 0 }}>
                    Custom Flair Groups (Optional):
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      style={styles.templateBtnAccent}
                      onClick={handlePopulateSubredditFlairs}
                    >
                      Auto-Group Subreddit Flairs ({discoveredFlairs.length})
                    </button>
                    <button
                      type="button"
                      style={styles.templateBtn}
                      onClick={() => setEditCustomGroupsRaw('')}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {discoveredFlairs.length > 0 && (
                  <div style={styles.flairPickerBox}>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                      Click a flair to insert at cursor:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {discoveredFlairs.map((f) => (
                        <button
                          key={f}
                          type="button"
                          style={styles.flairChipBtn}
                          onClick={() => handleInsertFlair(f)}
                        >
                          + {f}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <textarea
                  rows={3}
                  placeholder={'Questions & Help: Question, Technical Help\nCommunity: Discussion, Showcase'}
                  value={editCustomGroupsRaw}
                  onChange={(e) => setEditCustomGroupsRaw(e.target.value)}
                  style={styles.textareaInput}
                />
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button
                style={savingSettings || validationError ? styles.buttonDisabled : styles.primaryButton}
                onClick={handleSaveSettings}
                disabled={savingSettings || Boolean(validationError)}
              >
                {savingSettings ? 'Saving & Syncing...' : '💾 Save & Sync Now'}
              </button>
              <button style={styles.secondaryButton} onClick={() => setSettingsModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Raw Data Modal (Moderators) */}
      {exportModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                📥 Export Raw Analytics Data
              </h2>
              <button style={styles.closeButton} onClick={() => setExportModalOpen(false)}>
                ✕
              </button>
            </div>

            <div style={styles.modalFormatTabs}>
              <button
                style={exportFormat === 'csv' ? styles.modalTabActive : styles.modalTab}
                onClick={() => setExportFormat('csv')}
              >
                CSV Format (Spreadsheet)
              </button>
              <button
                style={exportFormat === 'json' ? styles.modalTabActive : styles.modalTab}
                onClick={() => setExportFormat('json')}
              >
                JSON Format (API Raw)
              </button>
            </div>

            <textarea readOnly value={exportText} style={styles.modalTextarea} />

            <div style={styles.modalFooter}>
              <button style={styles.primaryButton} onClick={handleCopyExport}>
                {copied ? '✓ Copied to Clipboard!' : 'Copy to Clipboard'}
              </button>
              <button style={styles.secondaryButton} onClick={() => setExportModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subreddit Sidebar Integration Modal (Moderators) */}
      {sidebarModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  📌 Subreddit Sidebar Integration
                </h2>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                  Feature this dashboard in your community sidebar on desktop and mobile web.
                </div>
              </div>
              <button style={styles.closeButton} onClick={() => setSidebarModalOpen(false)}>
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              <div style={styles.sidebarSectionCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>🚀</span>
                  <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 14 }}>
                    Method 1: Automatic 1-Click Sync
                  </div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
                  Creates or updates a <strong>"Flair Analytics"</strong> button widget in <strong>r/{currentSubredditName}</strong>'s sidebar.
                </div>

                <button
                  style={syncingWidget ? styles.buttonDisabled : styles.syncWidgetButton}
                  onClick={handleSyncSidebarWidget}
                  disabled={syncingWidget}
                >
                  {syncingWidget ? '⏳ Connecting to Reddit Widget API...' : '⚡ Auto-Add Widget to Sidebar'}
                </button>

                {widgetSyncResult && (
                  <div
                    style={
                      widgetSyncResult.success
                        ? styles.widgetResultSuccess
                        : styles.widgetResultNotice
                    }
                  >
                    {widgetSyncResult.text}
                  </div>
                )}
              </div>

              <div style={styles.sidebarSectionCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>🛠️</span>
                  <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 14 }}>
                    Method 2: Manual Sidebar Widget (Mod Tools)
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 12, marginBottom: 4 }}>
                    🔗 Direct Dashboard Post URL:
                  </div>
                  <div style={styles.copyRow}>
                    <input
                      type="text"
                      readOnly
                      value={dashboardDirectUrl}
                      style={styles.copyInput}
                    />
                    <button style={styles.copyButton} onClick={handleCopyDashboardUrl}>
                      {copiedUrl ? '✓ Copied' : '📋 Copy URL'}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 12, marginBottom: 4 }}>
                    📝 Markdown Widget Code:
                  </div>
                  <div style={styles.copyRow}>
                    <input
                      type="text"
                      readOnly
                      value={`[📊 View Community Flair Analytics](${dashboardDirectUrl})`}
                      style={styles.copyInput}
                    />
                    <button style={styles.copyButton} onClick={handleCopyMarkdownSnippet}>
                      {copiedMarkdown ? '✓ Copied' : '📋 Copy Code'}
                    </button>
                  </div>
                </div>

                <div style={styles.stepsContainer}>
                  <div style={styles.stepItem}>
                    <div style={styles.stepBadge}>1</div>
                    <div style={{ color: '#cbd5e1', fontSize: 12 }}>
                      Open{' '}
                      <a
                        href={`https://www.reddit.com/r/${currentSubredditName}/about/edit?page=widgets`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#38bdf8', textDecoration: 'underline' }}
                      >
                        Mod Tools &gt; Sidebar Widgets ↗
                      </a>
                    </div>
                  </div>
                  <div style={styles.stepItem}>
                    <div style={styles.stepBadge}>2</div>
                    <div style={{ color: '#cbd5e1', fontSize: 12 }}>
                      Click <strong>Add Widget</strong> → select <strong>Button</strong>, paste the URL above, and click <strong>Save</strong>.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button style={styles.primaryButton} onClick={() => setSidebarModalOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 860,
    margin: '0 auto',
    padding: '10px 12px',
    color: '#d7dadc',
    fontSize: 13,
    lineHeight: 1.4
  },
  mainCard: {
    backgroundColor: '#161617',
    border: '1px solid #272729',
    borderRadius: 12,
    padding: '14px 16px'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 280,
    color: '#818384'
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #272729',
    borderTop: '3px solid #ff4500',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  errorContainer: {
    padding: 32,
    textAlign: 'center',
    backgroundColor: '#1a1a1b',
    borderRadius: 8,
    margin: '32px auto',
    maxWidth: 460
  },
  privateScreenBox: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 12,
    padding: '40px 24px',
    textAlign: 'center',
    maxWidth: 520,
    margin: '32px auto'
  },
  privateIcon: {
    fontSize: 42,
    marginBottom: 12
  },
  privateTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#f8fafc',
    marginBottom: 8
  },
  privateSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 1.5
  },
  previewBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: '#0c4a6e33',
    border: '1px solid #0284c7',
    borderRadius: 8,
    padding: '6px 12px',
    marginBottom: 10
  },
  previewInfo: {
    fontSize: 12
  },
  previewToggle: {
    backgroundColor: '#0284c7',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: '1px solid #272729'
  },
  headerLeft: {
    flex: 1,
    minWidth: 240
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#f8fafc',
    margin: 0
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2
  },
  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap'
  },
  metricToggleGroup: {
    display: 'inline-flex',
    backgroundColor: '#0f1011',
    border: '1px solid #272729',
    borderRadius: 8,
    padding: 2,
    gap: 2
  },
  metricPill: {
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  metricPillActive: {
    backgroundColor: '#0284c7',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  iconButton: {
    backgroundColor: '#272729',
    color: '#cbd5e1',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer'
  },
  modMenuButton: {
    backgroundColor: '#272729',
    color: '#f8fafc',
    border: '1px solid #3f3f46',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  modMenuButtonActive: {
    backgroundColor: '#ff4500',
    color: '#ffffff',
    border: '1px solid #ff4500',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  modDrawer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: '#1e1f22',
    border: '1px solid #343536',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 12
  },
  modDrawerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  modDrawerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap'
  },
  modActionBtn: {
    backgroundColor: '#272729',
    color: '#f8fafc',
    border: '1px solid #3f3f46',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  modActionBtnAccent: {
    backgroundColor: '#0c4a6e',
    color: '#38bdf8',
    border: '1px solid #0284c7',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  visibilityPublicBadge: {
    backgroundColor: '#064e3b',
    color: '#34d399',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 10,
    border: '1px solid #059669'
  },
  visibilityPrivateBadge: {
    backgroundColor: '#3b0764',
    color: '#d8b4fe',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 10,
    border: '1px solid #7c3aed'
  },
  filterBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10
  },
  groupPillsWrapper: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6
  },
  groupPill: {
    backgroundColor: '#202022',
    color: '#94a3b8',
    border: '1px solid #272729',
    borderRadius: 16,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  groupPillActive: {
    backgroundColor: '#ff4500',
    color: '#ffffff',
    border: '1px solid #ff4500',
    borderRadius: 16,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  searchInput: {
    backgroundColor: '#0f1011',
    border: '1px solid #272729',
    borderRadius: 6,
    padding: '4px 10px',
    color: '#d7dadc',
    fontSize: 12,
    outline: 'none',
    width: 160
  },
  leaderboardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 10px',
    backgroundColor: '#0f1011',
    border: '1px solid #232426',
    borderRadius: 8
  },
  rankGold: {
    width: 26,
    height: 24,
    borderRadius: 999,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    border: '1px solid rgba(245, 158, 11, 0.45)',
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  rankSilver: {
    width: 26,
    height: 24,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.16)',
    border: '1px solid rgba(148, 163, 184, 0.45)',
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  rankBronze: {
    width: 26,
    height: 24,
    borderRadius: 999,
    backgroundColor: 'rgba(217, 119, 6, 0.16)',
    border: '1px solid rgba(217, 119, 6, 0.45)',
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  rankDefault: {
    width: 26,
    height: 24,
    color: '#64748b',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  flairCell: {
    width: 135,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  flairBadge: {
    display: 'inline-block',
    color: '#ffffff',
    padding: '2px 8px',
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 600,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  barTrackWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 140
  },
  barTrack: {
    flex: 1,
    height: 12,
    backgroundColor: '#202124',
    borderRadius: 999,
    overflow: 'hidden'
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    transition: 'width 0.3s ease'
  },
  metricReadout: {
    width: 128,
    textAlign: 'right',
    fontWeight: 700,
    fontSize: 12,
    color: '#f8fafc',
    flexShrink: 0
  },
  sampleCell: {
    width: 72,
    textAlign: 'right',
    fontSize: 12,
    color: '#64748b',
    flexShrink: 0
  },
  benchmarkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '3px 4px'
  },
  benchmarkLine: {
    flex: 1,
    borderTop: '1px dashed rgba(56, 189, 248, 0.45)'
  },
  benchmarkLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#38bdf8',
    whiteSpace: 'nowrap'
  },
  emptyStateBanner: {
    padding: '28px 16px',
    textAlign: 'center',
    backgroundColor: '#0f1011',
    border: '1px dashed #272729',
    borderRadius: 8
  },
  buttonDisabled: {
    backgroundColor: '#1e293b',
    color: '#64748b',
    border: '1px solid #334155',
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'not-allowed'
  },
  secondaryButton: {
    backgroundColor: '#272729',
    color: '#d7dadc',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  primaryButton: {
    backgroundColor: '#ff4500',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  syncWidgetButton: {
    backgroundColor: '#0284c7',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer'
  },
  sidebarSectionCard: {
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12
  },
  widgetResultSuccess: {
    marginTop: 10,
    padding: '8px 12px',
    backgroundColor: '#064e3b33',
    border: '1px solid #059669',
    borderRadius: 6,
    color: '#34d399',
    fontSize: 12,
    fontWeight: 600
  },
  widgetResultNotice: {
    marginTop: 10,
    padding: '8px 12px',
    backgroundColor: '#78350f33',
    border: '1px solid #d97706',
    borderRadius: 6,
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: 600
  },
  copyRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center'
  },
  copyInput: {
    flex: 1,
    backgroundColor: '#0f1011',
    border: '1px solid #272729',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#cbd5e1',
    fontSize: 12,
    fontFamily: 'monospace'
  },
  copyButton: {
    backgroundColor: '#272729',
    border: '1px solid #343536',
    color: '#f8fafc',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  stepsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 6
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  stepBadge: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    backgroundColor: '#38bdf822',
    border: '1px solid #38bdf8',
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  toast: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    backgroundColor: '#ff4500',
    color: '#ffffff',
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    zIndex: 9999
  },
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 9998
  },
  modalContent: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 12,
    width: '100%',
    maxWidth: 580,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '16px 20px',
    borderBottom: '1px solid #272729'
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#818384',
    fontSize: 18,
    cursor: 'pointer',
    padding: 4
  },
  modalBody: {
    padding: 18,
    overflowY: 'auto'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '12px 20px',
    borderTop: '1px solid #272729',
    backgroundColor: '#141415'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 14
  },
  formField: {
    display: 'flex',
    flexDirection: 'column'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  visibilityCard: {
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 12
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    cursor: 'pointer'
  },
  checkboxInput: {
    width: 16,
    height: 16,
    marginTop: 2,
    cursor: 'pointer',
    accentColor: '#ff4500'
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    color: '#f8fafc',
    marginBottom: 4
  },
  textInput: {
    backgroundColor: '#121213',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#f8fafc',
    fontSize: 13
  },
  textInputError: {
    backgroundColor: '#450a0a33',
    border: '1px solid #ef4444',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#f8fafc',
    fontSize: 13
  },
  helpText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4
  },
  textareaInput: {
    backgroundColor: '#121213',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '8px 10px',
    color: '#f8fafc',
    fontSize: 12,
    fontFamily: 'monospace',
    resize: 'vertical'
  },
  templateBtn: {
    backgroundColor: '#272729',
    color: '#cbd5e1',
    border: '1px solid #343536',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 11,
    cursor: 'pointer'
  },
  templateBtnAccent: {
    backgroundColor: '#0284c722',
    color: '#38bdf8',
    border: '1px solid #0284c7',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  flairPickerBox: {
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8
  },
  flairChipBtn: {
    backgroundColor: '#272729',
    color: '#e2e8f0',
    border: '1px solid #3f3f46',
    borderRadius: 12,
    padding: '2px 8px',
    fontSize: 11,
    cursor: 'pointer'
  },
  modalFormatTabs: {
    display: 'flex',
    gap: 8,
    padding: '12px 20px 0'
  },
  modalTab: {
    backgroundColor: '#272729',
    color: '#94a3b8',
    border: 'none',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  modalTabActive: {
    backgroundColor: '#ff4500',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  modalTextarea: {
    margin: '12px 20px',
    height: 220,
    backgroundColor: '#0f1011',
    border: '1px solid #272729',
    borderRadius: 6,
    padding: 10,
    color: '#cbd5e1',
    fontSize: 12,
    fontFamily: 'monospace',
    resize: 'none'
  }
};
