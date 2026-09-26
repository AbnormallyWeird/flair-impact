import React, { useEffect, useState, useMemo } from 'react';
import type {
  AggregateReport,
  AppSettings,
  DEFAULT_APP_SETTINGS,
  FlairMetrics,
  GroupSummary,
  ReportApiResponse,
  SettingsApiResponse,
  SyncApiResponse,
  SyncStatus,
  UserStatusApiResponse
} from '../types.js';
import { formatExportCsv, formatExportJson } from '../services/storage.js';
import { createSimulatedReport, DEFAULT_MOCK_SETTINGS, MOCK_AVAILABLE_FLAIRS, MOCK_REPORT, MOCK_USER_STATUS } from './mockData.js';

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

  // Settings form fields
  const [editPublicDashboard, setEditPublicDashboard] = useState<boolean>(true);
  const [editLookbackDays, setEditLookbackDays] = useState<number>(90);
  const [editMaxPosts, setEditMaxPosts] = useState<number>(1000);
  const [editMinThreshold, setEditMinThreshold] = useState<number>(5);
  const [editCustomGroupsRaw, setEditCustomGroupsRaw] = useState<string>('');
  const [availableSubredditFlairs, setAvailableSubredditFlairs] = useState<string[]>([]);
  const [isPrivateScreen, setIsPrivateScreen] = useState<boolean>(false);

  // Filters and sorting
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'median_comments' | 'baseline_delta' | 'volume' | 'avg_comments' | 'score'>('median_comments');

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
        // Fallback to local mock data for zero-deployment testing in browser
        setIsLocalPreview(true);
        setIsPrivateScreen(false);
        setReport(MOCK_REPORT);
        setUserStatus(userRes || MOCK_USER_STATUS);
        syncSettingsState(DEFAULT_MOCK_SETTINGS);
        setAvailableSubredditFlairs(MOCK_AVAILABLE_FLAIRS);
      }
    } catch {
      // Offline / local preview server fallback
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
      customGroupsRaw: editCustomGroupsRaw
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
      if (!trimmed) {
        return `Group 1: ${flairText}`;
      }
      if (trimmed.endsWith(':')) {
        return `${prev} ${flairText}`;
      }
      if (trimmed.endsWith(',')) {
        return `${prev} ${flairText}`;
      }
      if (prev.endsWith('\n')) {
        return `${prev}Group: ${flairText}`;
      }
      return `${prev}, ${flairText}`;
    });
  };

  const handleClearGroups = () => {
    setEditCustomGroupsRaw('');
  };

  const filteredFlairs = useMemo(() => {
    if (!report) return [];

    let list = [...report.flairBreakdown];

    // Filter by Custom Group tab
    if (selectedGroup !== 'all') {
      if (selectedGroup === '__ungrouped__') {
        list = list.filter((f) => !f.assignedGroup);
      } else {
        list = list.filter((f) => f.assignedGroup === selectedGroup);
      }
    }

    // Filter by Search Query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      list = list.filter((f) => f.flairText.toLowerCase().includes(q));
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'volume') return b.postCount - a.postCount;
      if (sortBy === 'median_comments') return b.medianComments - a.medianComments;
      if (sortBy === 'avg_comments') return b.avgComments - a.avgComments;
      if (sortBy === 'score') return b.avgScore - a.avgScore;
      if (sortBy === 'baseline_delta') {
        return (b.deltaVsCommunityBaselinePct ?? -999) - (a.deltaVsCommunityBaselinePct ?? -999);
      }
      return 0;
    });

    return list;
  }, [report, selectedGroup, searchQuery, sortBy]);

  const maxMedianComments = useMemo(() => {
    if (!report || report.flairBreakdown.length === 0) return 1;
    return Math.max(...report.flairBreakdown.map((f) => f.medianComments), 1);
  }, [report]);

  const activeGroupSummary = useMemo(() => {
    if (!report || !report.groupSummaries || selectedGroup === 'all' || selectedGroup === '__ungrouped__') {
      return null;
    }
    return report.groupSummaries.find((g) => g.groupName === selectedGroup) || null;
  }, [report, selectedGroup]);

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

  const getBaselineDeltaBadge = (delta: number | null) => {
    if (delta === null) return <span style={styles.deltaNeutral}>—</span>;
    if (delta > 0) return <span style={styles.deltaPositive}>+{delta}%</span>;
    if (delta < 0) return <span style={styles.deltaNegative}>{delta}%</span>;
    return <span style={styles.deltaNeutral}>Baseline</span>;
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <div style={{ marginTop: 14, fontSize: 15, fontWeight: 500 }}>
          Ingesting subreddit flair activity & computing post response rates...
        </div>
      </div>
    );
  }

  const isMod = userStatus?.isModerator ?? false;

  // Regular user visiting a private dashboard
  if (!isMod && (isPrivateScreen || !settings.publicDashboard)) {
    return (
      <div style={styles.container}>
        {/* Toast Notification */}
        {toastMessage && <div style={styles.toast}>{toastMessage}</div>}

        {/* Local Browser Sandbox Bar (when running offline / outside Reddit) */}
        {isLocalPreview && (
          <div style={styles.previewBanner}>
            <div style={styles.previewInfo}>
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>💻 Local Browser Sandbox:</span>
              <span style={{ color: '#cbd5e1', marginLeft: 8 }}>
                Currently in Regular User view with Private Mode active.
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
              Switch Role: {userStatus?.isModerator ? '👑 Moderator View' : '👤 Regular User View'}
            </button>
          </div>
        )}

        <div style={styles.privateScreenBox}>
          <div style={styles.privateIcon}>🔒</div>
          <h2 style={styles.privateTitle}>Moderator-Only Analytics</h2>
          <p style={styles.privateSubtitle}>
            The moderation team of <strong>r/{userStatus?.subredditName || report?.subredditName || 'this community'}</strong> has configured flair engagement metrics to be private.
          </p>
          <div style={styles.privateNotice}>
            💡 If you are a moderator of this subreddit, ensure you are logged into your moderator account. Subreddit moderators can make this dashboard visible to the community in <strong>App Settings</strong>.
          </div>
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

  return (
    <div style={styles.container}>
      {/* Toast Notification */}
      {toastMessage && <div style={styles.toast}>{toastMessage}</div>}

      {/* Local Browser Sandbox Bar (when running offline / outside Reddit) */}
      {isLocalPreview && (
        <div style={styles.previewBanner}>
          <div style={styles.previewInfo}>
            <span style={{ fontWeight: 700, color: '#38bdf8' }}>💻 Local Browser Sandbox:</span>
            <span style={{ color: '#cbd5e1', marginLeft: 8 }}>
              Running in offline preview with 842 simulated posts. Test settings, groups, and search locally!
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
            Switch Role: {userStatus?.isModerator ? '👑 Moderator View' : '👤 Regular User View'}
          </button>
        </div>
      )}

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.subTitleRow}>
            <h1 style={styles.title}>
              r/{report.subredditName || 'community'} Flair Response & Impact Analyzer
            </h1>
            {isMod && <span style={styles.modBadge}>MODERATOR</span>}
          </div>
          <div style={styles.subtitle}>
            Rolling {report.windowDays}-day window • Measuring how post flairs impact comment activity & response rates
          </div>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.syncBadge}>
            <span style={styles.pulseDot} />
            <span>
              Updated {new Date(report.generatedAt).toLocaleDateString()} {new Date(report.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {isMod && (
            <button
              style={syncing ? styles.buttonDisabled : styles.syncButton}
              onClick={handleManualSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : '↻ Sync Data Now'}
            </button>
          )}
        </div>
      </header>

      {/* Moderator Admin Overlay / Property Configuration Controls */}
      {isMod && (
        <section style={styles.modBanner}>
          <div style={styles.modBannerInfo}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: '#ff4500' }}>🛡️ Mod Controls Active:</span>
              <span style={settings.publicDashboard ? styles.visibilityPublicBadge : styles.visibilityPrivateBadge}>
                {settings.publicDashboard ? '🌐 Community Visible (Public)' : '🔒 Mod-Only (Private)'}
              </span>
            </div>
            <div style={{ color: '#a8aaab' }}>
              {report.totalPostsAnalyzed} posts analyzed across {report.windowDays} days (max {settings.maxPosts}).
              {hasCustomGroups ? ` ${report.groupSummaries?.length} custom group(s) configured.` : ' Direct flair view.'}
              {syncStatus?.durationMs ? ` Last query took ${(syncStatus.durationMs / 1000).toFixed(2)}s.` : ''}
            </div>
          </div>
          <div style={styles.modBannerActions}>
            <button
              style={styles.settingsButton}
              onClick={() => {
                setEditPublicDashboard(settings.publicDashboard ?? true);
                setEditLookbackDays(settings.lookbackDays);
                setEditMaxPosts(settings.maxPosts);
                setEditMinThreshold(settings.minPostsThreshold);
                setEditCustomGroupsRaw(settings.customGroupsRaw || '');
                setSettingsModalOpen(true);
              }}
            >
              ⚙️ App Settings & Groups
            </button>
            <button style={styles.secondaryButton} onClick={() => setExportModalOpen(true)}>
              📥 Export Raw Data
            </button>
          </div>
        </section>
      )}

      {/* Subreddit Response Rate Overview Cards */}
      <section style={styles.overviewCard}>
        <div style={styles.overviewHeader}>
          <div style={styles.overviewIconBox}>📈</div>
          <div>
            <div style={styles.overviewCardTitle}>Community Response Rate Overview</div>
            <div style={styles.overviewCardSubtitle}>
              Benchmarking how topic and post flairs influence community participation and discussion rates
            </div>
          </div>
        </div>

        <div style={styles.overviewMetricsGrid}>
          <div style={styles.overviewMetricBox}>
            <div style={styles.metricLabel}>Community Baseline (Median)</div>
            <div style={{ ...styles.metricValue, color: '#f8fafc' }}>
              {report.overallMedianComments}
              <span style={styles.metricUnit}> comments/post</span>
            </div>
            <div style={styles.metricSub}>
              Median across all {report.totalPostsAnalyzed} submissions
            </div>
          </div>

          <div style={styles.overviewMetricBox}>
            <div style={styles.metricLabel}>Highest Response Flair</div>
            <div style={{ ...styles.metricValue, color: '#10b981' }}>
              {report.topResponseFlair ? `${report.topResponseFlair.medianComments}` : 'N/A'}
              <span style={styles.metricUnit}> comments</span>
            </div>
            <div style={styles.metricSub}>
              {report.topResponseFlair
                ? `${report.topResponseFlair.flairText} (${report.topResponseFlair.postCount} posts)`
                : 'No flairs'}
            </div>
          </div>

          <div style={styles.overviewMetricBox}>
            <div style={styles.metricLabel}>Lowest Response Flair</div>
            <div style={{ ...styles.metricValue, color: '#ff585b' }}>
              {report.lowestResponseFlair ? `${report.lowestResponseFlair.medianComments}` : 'N/A'}
              <span style={styles.metricUnit}> comments</span>
            </div>
            <div style={styles.metricSub}>
              {report.lowestResponseFlair
                ? `${report.lowestResponseFlair.flairText} (${report.lowestResponseFlair.postCount} posts)`
                : 'No flairs'}
            </div>
          </div>

          <div style={styles.overviewMetricBox}>
            <div style={styles.metricLabel}>Total Comments Analyzed</div>
            <div style={{ ...styles.metricValue, color: '#38bdf8' }}>
              {report.overallTotalComments.toLocaleString()}
              <span style={styles.metricUnit}> comments</span>
            </div>
            <div style={styles.metricSub}>
              Avg {report.overallAvgComments} comments/post
            </div>
          </div>
        </div>

        <div style={styles.rationaleBox}>
          <span style={{ fontWeight: 600, color: '#d7dadc' }}>💡 Response Rate Insight: </span>
          <span>
            Post flairs directly influence whether submissions spark active community dialogue or get
            ignored. By focusing on median response rates, extreme viral spikes are filtered out,
            providing an accurate measure of typical user engagement per post flair.
          </span>
        </div>
      </section>

      {/* Custom Flair Grouping Tabs (Rendered ONLY if moderator has configured custom groups) */}
      {hasCustomGroups && (
        <section style={styles.groupSection}>
          <div style={styles.groupTabsHeader}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Custom Flair Groups:
            </span>
          </div>
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
                Ungrouped ({ungroupedCount})
              </button>
            )}
          </div>

          {/* Active Group Highlight Banner */}
          {activeGroupSummary && (
            <div style={styles.activeGroupBox}>
              <div style={styles.activeGroupTopRow}>
                <div>
                  <span style={styles.activeGroupTitle}>{activeGroupSummary.groupName}</span>
                  <span style={styles.activeGroupSubtitle}>
                    {activeGroupSummary.totalPosts} total submissions across {activeGroupSummary.flairCount} flairs ({activeGroupSummary.flairs.join(', ')})
                  </span>
                </div>
                <div style={styles.activeGroupStats}>
                  <div style={styles.activeGroupStatItem}>
                    <span style={styles.activeGroupStatLabel}>Group Median:</span>
                    <span style={styles.activeGroupStatValue}>{activeGroupSummary.medianComments} comments</span>
                  </div>
                  <div style={styles.activeGroupStatItem}>
                    <span style={styles.activeGroupStatLabel}>Impact vs Baseline:</span>
                    {getBaselineDeltaBadge(activeGroupSummary.deltaVsCommunityBaselinePct)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Table Controls (Search & Sort) */}
      <section style={styles.tableControls}>
        <div style={styles.flairCountBadge}>
          Showing <strong>{filteredFlairs.length}</strong> of {report.flairBreakdown.length} flairs
        </div>

        <div style={styles.filterActions}>
          <input
            type="text"
            placeholder="Search flairs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={styles.selectInput}
          >
            <option value="median_comments">Sort by Median Response</option>
            <option value="baseline_delta">Sort by Impact (vs Baseline)</option>
            <option value="volume">Sort by Post Volume</option>
            <option value="avg_comments">Sort by Avg Comments</option>
            <option value="score">Sort by Avg Score</option>
          </select>
        </div>
      </section>

      {/* Flair Breakdown Table */}
      <section style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: '28%' }}>Flair Name</th>
              <th style={{ ...styles.th, width: '15%', textAlign: 'right' }}>Submissions</th>
              <th style={{ ...styles.th, width: '27%' }}>Median Response</th>
              <th style={{ ...styles.th, width: '16%', textAlign: 'center' }}>vs Baseline</th>
              <th style={{ ...styles.th, width: '7%', textAlign: 'right' }}>Avg Comments</th>
              <th style={{ ...styles.th, width: '7%', textAlign: 'right' }}>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {filteredFlairs.length === 0 ? (
              <tr>
                <td colSpan={6} style={styles.emptyRow}>
                  No flairs match your search or filter criteria.
                </td>
              </tr>
            ) : (
              filteredFlairs.map((flair) => {
                const barWidth = Math.max(
                  Math.min(Math.round((flair.medianComments / maxMedianComments) * 100), 100),
                  2
                );
                return (
                  <tr key={flair.flairText} style={styles.tr}>
                    <td style={styles.td}>
                      <span style={styles.flairPill}>{flair.flairText}</span>
                      {flair.assignedGroup && (
                        <span style={styles.assignedGroupBadge}>{flair.assignedGroup}</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>
                      {flair.postCount}
                      <span style={styles.percentageText}>
                        {' '}
                        ({Math.round((flair.postCount / report.totalPostsAnalyzed) * 100)}%)
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.barContainer}>
                        <div
                          style={{
                            ...styles.barFill,
                            width: `${barWidth}%`,
                            backgroundColor:
                              flair.deltaVsCommunityBaselinePct !== null && flair.deltaVsCommunityBaselinePct > 0
                                ? '#10b981'
                                : flair.deltaVsCommunityBaselinePct !== null && flair.deltaVsCommunityBaselinePct < 0
                                ? '#f59e0b'
                                : '#38bdf8'
                          }}
                        />
                        <span style={styles.barNumber}>{flair.medianComments}</span>
                      </div>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      {getBaselineDeltaBadge(flair.deltaVsCommunityBaselinePct)}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{flair.avgComments}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{flair.avgScore}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* Footer Info */}
      <footer style={styles.footer}>
        <div>
          Tracking data points: Post ID, Flair text, Comment count, Post score, Upvote ratio & Creation date.
        </div>
        <div style={{ marginTop: 4 }}>
          Native Reddit Devvit App • Configurable via Subreddit App Settings & Redis cache
        </div>
      </footer>

      {/* App Properties & Configuration Modal (Moderators) */}
      {settingsModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  ⚙️ Subreddit App Properties & Settings
                </h2>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                  Configure ingestion parameters and custom flair groupings for this subreddit.
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
                        ? 'Active: Community members can view this interactive dashboard and flair response rates.'
                        : 'Inactive (Private): Only subreddit moderators can view analytics. Regular members see a lock screen.'}
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
                  {editLookbackDays > 365 ? (
                    <div style={styles.warningNotice}>
                      ⚠️ <strong>Wide Window:</strong> Periods over 365 days are limited by Reddit's 1,000 post listing ceiling on active communities.
                    </div>
                  ) : editLookbackDays < 7 ? (
                    <div style={styles.warningNotice}>
                      ⚠️ <strong>Short Window:</strong> A lookback of at least 7–30 days is recommended to capture community discussion rhythms.
                    </div>
                  ) : (
                    <div style={styles.helpText}>
                      How far back in time to scan submissions (1 to 365). Default: 90
                    </div>
                  )}
                </div>

                <div style={styles.formField}>
                  <label style={styles.label}>Max Submissions to Ingest:</label>
                  <input
                    type="number"
                    min={50}
                    step={50}
                    value={editMaxPosts}
                    onChange={(e) => setEditMaxPosts(Number(e.target.value))}
                    style={editMaxPosts > 1000 || editMaxPosts < 50 ? styles.textInputError : styles.textInput}
                  />
                  {editMaxPosts > 1000 ? (
                    <div style={styles.errorNotice}>
                      ⛔ <strong>Reddit API Limit (1,000 Cap):</strong> Reddit strictly caps all subreddit listings at 1,000 items. Requests above 1,000 cannot be queried.
                    </div>
                  ) : editMaxPosts < 50 ? (
                    <div style={styles.warningNotice}>
                      ⚠️ <strong>Low Sample Size:</strong> At least 50 posts recommended for statistically reliable medians.
                    </div>
                  ) : (
                    <div style={styles.helpText}>
                      Maximum submissions to fetch (50 to 1,000). Reddit listings enforce a strict 1,000-item ceiling.
                    </div>
                  )}
                </div>

                <div style={styles.formField}>
                  <label style={styles.label}>Min Posts for Highlights:</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={editMinThreshold}
                    onChange={(e) => setEditMinThreshold(Number(e.target.value))}
                    style={editMinThreshold < 1 ? styles.textInputError : styles.textInput}
                  />
                  {editMinThreshold < 1 ? (
                    <div style={styles.errorNotice}>
                      ⛔ Must be at least 1 post.
                    </div>
                  ) : (
                    <div style={styles.helpText}>
                      Minimum post count required for Highest/Lowest Response cards. Default: 5
                    </div>
                  )}
                </div>
              </div>

              <div style={styles.formGroup}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={styles.label}>Custom Flair Groupings (Optional):</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      style={styles.tinyButtonPrimary}
                      onClick={handlePopulateSubredditFlairs}
                      title="Automatically populate groups using this subreddit's detected flairs"
                    >
                      ✨ Auto-Fill Subreddit Flairs
                    </button>
                    <button
                      type="button"
                      style={styles.tinyButton}
                      onClick={handleClearGroups}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <textarea
                  value={editCustomGroupsRaw}
                  onChange={(e) => setEditCustomGroupsRaw(e.target.value)}
                  placeholder="Format: GroupName: flair1, flair2&#10;Example:&#10;Community Help: Question, Technical Help, Advice&#10;Promotions: Vendor, Showcase, Deals"
                  rows={4}
                  style={styles.settingsTextarea}
                />
                <div style={styles.helpText}>
                  Enter one group per line in <code>GroupName: flair1, flair2</code> format. If left blank, flairs will be displayed directly without grouping.
                </div>

                {/* Subreddit Flair Chips (Click to Insert) */}
                {discoveredFlairs.length > 0 && (
                  <div style={styles.flairChipsBox}>
                    <div style={styles.flairChipsHeader}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Subreddit Flairs Detected ({discoveredFlairs.length}) — Click to insert:
                      </span>
                    </div>
                    <div style={styles.flairChipsGrid}>
                      {discoveredFlairs.map((flair) => (
                        <button
                          key={flair}
                          type="button"
                          style={styles.flairChip}
                          onClick={() => handleInsertFlair(flair)}
                          title={`Click to append "${flair}" to editor`}
                        >
                          + {flair}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Platform Constraints & Limits Callout Box */}
              <div style={styles.constraintsCard}>
                <div style={styles.constraintsHeader}>
                  <span style={{ fontSize: 14 }}>🛑</span>
                  <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>
                    Reddit API &amp; Devvit Platform Restrictions
                  </span>
                </div>
                <div style={styles.constraintList}>
                  <div style={styles.constraintItem}>
                    <span style={{ color: '#f87171', fontWeight: 700 }}>• 1,000 Post Hard Ceiling:</span>
                    <span style={{ color: '#cbd5e1', marginLeft: 6 }}>
                      Reddit's listing architecture (<code>/new</code>, <code>/hot</code>, <code>/top</code>) returns <code>after: null</code> past 1,000 posts. It is physically impossible to paginate further via standard APIs.
                    </span>
                  </div>
                  <div style={styles.constraintItem}>
                    <span style={{ color: '#fbbf24', fontWeight: 700 }}>• Effective Window Cutoff:</span>
                    <span style={{ color: '#cbd5e1', marginLeft: 6 }}>
                      Syncing stops at whichever limit is reached first: your chosen <strong>lookback days</strong> or <strong>1,000 submissions</strong>. On active subreddits, 1,000 posts may only cover the past week or month.
                    </span>
                  </div>
                  <div style={styles.constraintItem}>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>• Rate Limits &amp; Execution Timeouts:</span>
                    <span style={{ color: '#cbd5e1', marginLeft: 6 }}>
                      Ingestion streams 100 posts per page (10 requests max), completing in ~2 seconds to guarantee zero Reddit 429 rate limit triggers and avoid Devvit worker execution timeouts.
                    </span>
                  </div>
                </div>
              </div>

              <div style={styles.nativeSettingsNotice}>
                <span style={{ fontWeight: 600, color: '#38bdf8' }}>ℹ️ Reddit Native Mod Tools: </span>
                <span>
                  These same properties are also registered in <code>devvit.json</code> and accessible in your Reddit subreddit settings under <strong>Mod Tools &gt; Installed Apps &gt; flair-impact &gt; App Settings</strong>.
                </span>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button
                style={savingSettings || validationError ? styles.buttonDisabled : styles.primaryButton}
                onClick={handleSaveSettings}
                disabled={savingSettings || Boolean(validationError)}
                title={validationError || undefined}
              >
                {savingSettings ? 'Saving & Syncing...' : validationError ? '⚠️ Fix Errors to Save' : '💾 Save & Sync Now'}
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
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '20px 16px',
    color: '#d7dadc',
    fontSize: 14,
    lineHeight: 1.5
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 320,
    color: '#818384'
  },
  spinner: {
    width: 36,
    height: 36,
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
    margin: '40px auto',
    maxWidth: 480
  },
  privateScreenBox: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 12,
    padding: '48px 24px',
    textAlign: 'center',
    maxWidth: 580,
    margin: '40px auto'
  },
  privateIcon: {
    fontSize: 48,
    marginBottom: 16
  },
  privateTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: '#f8fafc',
    marginBottom: 10
  },
  privateSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 1.6,
    marginBottom: 24
  },
  privateNotice: {
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: 12,
    color: '#64748b',
    lineHeight: 1.5,
    textAlign: 'left'
  },
  previewBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: '#0c4a6e33',
    border: '1px solid #0284c7',
    borderRadius: 8,
    padding: '10px 16px',
    marginBottom: 20
  },
  previewInfo: {
    fontSize: 13
  },
  previewToggle: {
    backgroundColor: '#0284c7',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20
  },
  headerLeft: {
    flex: 1,
    minWidth: 260
  },
  headerRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8
  },
  subTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#f8fafc',
    letterSpacing: '-0.3px',
    margin: 0
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4
  },
  modBadge: {
    fontSize: 10,
    fontWeight: 700,
    backgroundColor: '#ff4500',
    color: '#ffffff',
    padding: '2px 8px',
    borderRadius: 12,
    letterSpacing: '0.5px'
  },
  visibilityPublicBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#064e3b',
    color: '#34d399',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 12,
    border: '1px solid #059669'
  },
  visibilityPrivateBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#3b0764',
    color: '#d8b4fe',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 12,
    border: '1px solid #7c3aed'
  },
  syncBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#94a3b8',
    backgroundColor: '#1e293b',
    padding: '4px 10px',
    borderRadius: 12
  },
  pulseDot: {
    width: 7,
    height: 7,
    backgroundColor: '#10b981',
    borderRadius: '50%'
  },
  syncButton: {
    backgroundColor: '#272729',
    color: '#d7dadc',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  buttonDisabled: {
    backgroundColor: '#1e293b',
    color: '#64748b',
    border: '1px solid #334155',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'not-allowed'
  },
  modBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderLeft: '4px solid #ff4500',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 20
  },
  modBannerInfo: {
    fontSize: 13
  },
  modBannerActions: {
    display: 'flex',
    gap: 10
  },
  settingsButton: {
    backgroundColor: '#272729',
    color: '#f8fafc',
    border: '1px solid #475569',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  secondaryButton: {
    backgroundColor: '#272729',
    color: '#d7dadc',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  primaryButton: {
    backgroundColor: '#ff4500',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer'
  },
  overviewCard: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20
  },
  overviewHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16
  },
  overviewIconBox: {
    fontSize: 22,
    backgroundColor: '#272729',
    width: 44,
    height: 44,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  overviewCardTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#f8fafc'
  },
  overviewCardSubtitle: {
    fontSize: 12,
    color: '#818384',
    marginTop: 2
  },
  overviewMetricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 14,
    marginBottom: 16
  },
  overviewMetricBox: {
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 8,
    padding: '14px 16px'
  },
  metricLabel: {
    fontSize: 12,
    color: '#818384',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  metricValue: {
    fontSize: 26,
    fontWeight: 800,
    marginTop: 6,
    marginBottom: 4
  },
  metricUnit: {
    fontSize: 13,
    fontWeight: 500,
    color: '#818384'
  },
  metricSub: {
    fontSize: 11,
    color: '#64748b'
  },
  rationaleBox: {
    fontSize: 12,
    color: '#94a3b8',
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 6,
    padding: '10px 14px',
    lineHeight: 1.5
  },
  groupSection: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20
  },
  groupTabsHeader: {
    marginBottom: 8
  },
  groupPillsWrapper: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8
  },
  groupPill: {
    backgroundColor: '#272729',
    color: '#cbd5e1',
    border: '1px solid #343536',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  groupPillActive: {
    backgroundColor: '#ff4500',
    color: '#ffffff',
    border: '1px solid #ff4500',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  activeGroupBox: {
    marginTop: 12,
    padding: '10px 14px',
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 8
  },
  activeGroupTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12
  },
  activeGroupTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#f8fafc',
    marginRight: 8
  },
  activeGroupSubtitle: {
    fontSize: 12,
    color: '#818384'
  },
  activeGroupStats: {
    display: 'flex',
    alignItems: 'center',
    gap: 16
  },
  activeGroupStatItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12
  },
  activeGroupStatLabel: {
    color: '#818384'
  },
  activeGroupStatValue: {
    fontWeight: 700,
    color: '#f8fafc'
  },
  tableControls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12
  },
  flairCountBadge: {
    fontSize: 13,
    color: '#94a3b8'
  },
  filterActions: {
    display: 'flex',
    gap: 10,
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 260
  },
  searchInput: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '7px 12px',
    color: '#d7dadc',
    fontSize: 13,
    outline: 'none',
    width: 200
  },
  selectInput: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '7px 12px',
    color: '#d7dadc',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer'
  },
  tableWrapper: {
    backgroundColor: '#1a1a1b',
    border: '1px solid #343536',
    borderRadius: 10,
    overflowX: 'auto',
    marginBottom: 20
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left'
  },
  th: {
    padding: '12px 16px',
    fontSize: 11,
    fontWeight: 700,
    color: '#818384',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid #272729',
    backgroundColor: '#161617'
  },
  tr: {
    borderBottom: '1px solid #272729'
  },
  td: {
    padding: '12px 16px',
    fontSize: 13,
    color: '#d7dadc'
  },
  flairPill: {
    display: 'inline-block',
    backgroundColor: '#272729',
    color: '#f8fafc',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid #343536'
  },
  assignedGroupBadge: {
    display: 'inline-block',
    marginLeft: 8,
    fontSize: 10,
    color: '#94a3b8',
    backgroundColor: '#1e293b',
    padding: '2px 6px',
    borderRadius: 4,
    border: '1px solid #334155'
  },
  percentageText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 400
  },
  barContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%'
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    minWidth: 4,
    transition: 'width 0.3s ease'
  },
  barNumber: {
    fontSize: 12,
    fontWeight: 700,
    color: '#f8fafc',
    minWidth: 32
  },
  deltaPositive: {
    display: 'inline-block',
    backgroundColor: '#064e3b',
    color: '#34d399',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700
  },
  deltaNegative: {
    display: 'inline-block',
    backgroundColor: '#450a0a',
    color: '#f87171',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700
  },
  deltaNeutral: {
    color: '#94a3b8',
    fontSize: 12
  },
  emptyRow: {
    padding: 32,
    textAlign: 'center',
    color: '#818384'
  },
  footer: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 40
  },
  toast: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    backgroundColor: '#ff4500',
    color: '#ffffff',
    padding: '12px 20px',
    borderRadius: 8,
    fontSize: 13,
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
    maxWidth: 620,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '18px 20px',
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
    padding: 20,
    overflowY: 'auto'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 14,
    marginBottom: 16
  },
  formField: {
    display: 'flex',
    flexDirection: 'column'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 16
  },
  visibilityCard: {
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 16
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    cursor: 'pointer'
  },
  checkboxInput: {
    width: 18,
    height: 18,
    marginTop: 2,
    cursor: 'pointer',
    accentColor: '#ff4500'
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    color: '#f8fafc',
    marginBottom: 6
  },
  textInput: {
    backgroundColor: '#121213',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#f8fafc',
    fontSize: 13,
    outline: 'none'
  },
  textInputError: {
    backgroundColor: '#2a0e0e',
    border: '1px solid #ef4444',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#fca5a5',
    fontSize: 13,
    outline: 'none'
  },
  errorNotice: {
    backgroundColor: '#450a0a',
    border: '1px solid #dc2626',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fca5a5',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 1.4
  },
  warningNotice: {
    backgroundColor: '#451a03',
    border: '1px solid #d97706',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fcd34d',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 1.4
  },
  constraintsCard: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderLeft: '4px solid #ef4444',
    borderRadius: 8,
    padding: '12px 14px',
    marginTop: 14,
    marginBottom: 14
  },
  constraintsHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8
  },
  constraintList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  constraintItem: {
    fontSize: 11,
    lineHeight: 1.45
  },
  settingsTextarea: {
    backgroundColor: '#121213',
    border: '1px solid #343536',
    borderRadius: 6,
    padding: 12,
    color: '#f8fafc',
    fontSize: 13,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical'
  },
  helpText: {
    fontSize: 11,
    color: '#818384',
    marginTop: 4
  },
  tinyButton: {
    backgroundColor: '#272729',
    color: '#94a3b8',
    border: '1px solid #343536',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 11,
    cursor: 'pointer'
  },
  tinyButtonPrimary: {
    backgroundColor: '#0369a1',
    color: '#f8fafc',
    border: '1px solid #0284c7',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer'
  },
  flairChipsBox: {
    marginTop: 8,
    padding: '10px 12px',
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 6
  },
  flairChipsHeader: {
    marginBottom: 6
  },
  flairChipsGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6
  },
  flairChip: {
    backgroundColor: '#1e293b',
    color: '#38bdf8',
    border: '1px solid #0284c7',
    borderRadius: 14,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  nativeSettingsNotice: {
    fontSize: 12,
    color: '#94a3b8',
    backgroundColor: '#121213',
    border: '1px solid #1e293b',
    borderRadius: 6,
    padding: '10px 12px',
    lineHeight: 1.4
  },
  modalFormatTabs: {
    display: 'flex',
    borderBottom: '1px solid #272729',
    padding: '0 20px'
  },
  modalTab: {
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#818384',
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  modalTabActive: {
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid #ff4500',
    color: '#f8fafc',
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer'
  },
  modalTextarea: {
    flex: 1,
    minHeight: 280,
    margin: 20,
    padding: 14,
    backgroundColor: '#121213',
    border: '1px solid #272729',
    borderRadius: 8,
    color: '#f8fafc',
    fontSize: 12,
    fontFamily: 'monospace',
    resize: 'none',
    outline: 'none'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '16px 20px',
    borderTop: '1px solid #272729'
  }
};
