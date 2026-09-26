import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import {
  context,
  createServer,
  getServerPort,
  reddit,
  redis,
  settings
} from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { runFlairAnalysis } from '../services/analyzer.js';
import {
  getReport,
  getSettingsOverride,
  getSyncStatus,
  saveReport,
  saveSettingsOverride,
  saveSyncStatus
} from '../services/storage.js';
import {
  AggregateReport,
  AppSettings,
  DEFAULT_APP_SETTINGS,
  FlairsApiResponse,
  ReportApiResponse,
  SettingsApiResponse,
  SyncApiResponse,
  UserStatusApiResponse
} from '../types.js';

const app = new Hono();

/**
 * Resolves the effective settings for the subreddit by combining:
 * 1. Manual in-app moderator overrides (stored in Redis)
 * 2. Native Subreddit App Settings (configured via Reddit's mod tools)
 * 3. Default fallback settings
 */
async function getEffectiveSettings(): Promise<AppSettings> {
  const cachedOverride = await getSettingsOverride(redis);

  let publicDashboard = cachedOverride?.publicDashboard;
  let lookbackDays = cachedOverride?.lookbackDays;
  let maxPosts = cachedOverride?.maxPosts;
  let minPostsThreshold = cachedOverride?.minPostsThreshold;
  let customGroupsRaw = cachedOverride?.customGroupsRaw;

  try {
    if (publicDashboard === undefined) {
      const val = await settings.get<boolean>('publicDashboard');
      if (typeof val === 'boolean') publicDashboard = val;
    }
    if (lookbackDays === undefined) {
      const val = await settings.get<number>('lookbackDays');
      if (typeof val === 'number') lookbackDays = val;
    }
    if (maxPosts === undefined) {
      const val = await settings.get<number>('maxPosts');
      if (typeof val === 'number') maxPosts = val;
    }
    if (minPostsThreshold === undefined) {
      const val = await settings.get<number>('minPostsThreshold');
      if (typeof val === 'number') minPostsThreshold = val;
    }
    if (customGroupsRaw === undefined) {
      const val = await settings.get<string>('customGroups');
      if (typeof val === 'string') customGroupsRaw = val;
    }
  } catch (err) {
    // In local development or uninitialized environments, settings.get may fail gracefully
  }

  return {
    publicDashboard: publicDashboard ?? DEFAULT_APP_SETTINGS.publicDashboard,
    lookbackDays: lookbackDays ?? DEFAULT_APP_SETTINGS.lookbackDays,
    maxPosts: maxPosts ?? DEFAULT_APP_SETTINGS.maxPosts,
    minPostsThreshold: minPostsThreshold ?? DEFAULT_APP_SETTINGS.minPostsThreshold,
    customGroupsRaw: customGroupsRaw ?? DEFAULT_APP_SETTINGS.customGroupsRaw
  };
}

/**
 * Checks whether the specified user has moderator privileges in the target subreddit.
 */
async function checkIsModerator(
  subredditName: string,
  userId?: string,
  username?: string
): Promise<boolean> {
  if (!userId && !username) return false;
  try {
    const moderators = await reddit.getModerators({ subredditName }).all();
    return moderators.some(
      (m) =>
        m.id === userId ||
        (username && m.username.toLowerCase() === username.toLowerCase())
    );
  } catch (err) {
    console.error(`Failed to verify moderator status for r/${subredditName}:`, err);
    return false;
  }
}

/**
 * Executes a rolling window ingestion scan using effective settings, calculates metrics, and updates Redis cache.
 */
async function performSync(
  subredditName: string,
  overrideSettings?: AppSettings
): Promise<AggregateReport> {
  const start = Date.now();
  await saveSyncStatus(redis, {
    lastSyncTimestamp: start,
    status: 'syncing',
    totalPostsProcessed: 0,
    durationMs: 0
  });

  try {
    const effectiveSettings = overrideSettings || (await getEffectiveSettings());
    const report = await runFlairAnalysis(reddit, subredditName, effectiveSettings);
    const durationMs = Date.now() - start;

    await saveReport(redis, report);
    await saveSyncStatus(redis, {
      lastSyncTimestamp: Date.now(),
      status: 'success',
      totalPostsProcessed: report.totalPostsAnalyzed,
      durationMs
    });

    return report;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorMessage = err?.message || String(err);
    await saveSyncStatus(redis, {
      lastSyncTimestamp: Date.now(),
      status: 'error',
      totalPostsProcessed: 0,
      durationMs,
      errorMessage
    });
    throw err;
  }
}


/**
 * Retrieves all post flair templates configured for the subreddit,
 * merged with flairs discovered in the cached analysis.
 */
async function getSubredditFlairs(subredditName: string): Promise<string[]> {
  const flairsSet = new Set<string>();

  if (subredditName && subredditName !== 'unknown') {
    try {
      const templates = await reddit.getPostFlairTemplates(subredditName);
      for (const t of templates) {
        if (t.text && t.text.trim()) {
          flairsSet.add(t.text.trim());
        }
      }
    } catch (err) {
      console.warn(`Could not fetch post flair templates for r/${subredditName}:`, err);
    }
  }

  // Also include flairs from cached report
  try {
    const cached = await getReport(redis);
    if (cached?.flairBreakdown) {
      for (const f of cached.flairBreakdown) {
        if (f.flairText && f.flairText !== 'Unflaired') {
          flairsSet.add(f.flairText);
        }
      }
    }
  } catch {
    // Ignore cache read errors
  }

  return Array.from(flairsSet);
}

// ==========================================
// Public & Client API Routes
// ==========================================

/**
 * GET /api/user-status
 * Resolves current user's role (viewer vs moderator), subreddit name, effective settings, and available flairs.
 */
app.get('/api/user-status', async (c) => {
  const subredditName = context.subredditName ?? 'unknown';
  const userId = context.userId;

  let username: string | undefined;
  if (userId) {
    try {
      const user = await reddit.getUserById(userId);
      username = user?.username;
    } catch {
      // User may be anonymous or non-retrievable
    }
  }

  const isModerator = await checkIsModerator(subredditName, userId, username);
  const currentSettings = await getEffectiveSettings();
  const availableFlairs = await getSubredditFlairs(subredditName);

  return c.json<UserStatusApiResponse>({
    isModerator,
    username,
    subredditName,
    settings: currentSettings,
    availableFlairs
  });
});

/**
 * GET /api/flairs
 * Retrieves all configured and active post flairs on this subreddit.
 */
app.get('/api/flairs', async (c) => {
  const subredditName = context.subredditName ?? '';
  const flairs = await getSubredditFlairs(subredditName);
  return c.json<FlairsApiResponse>({
    success: true,
    flairs
  });
});

/**
 * GET /api/settings
 * Retrieves currently active settings (lookback window, max posts, custom groups).
 */
app.get('/api/settings', async (c) => {
  const currentSettings = await getEffectiveSettings();
  return c.json<SettingsApiResponse>({
    success: true,
    settings: currentSettings
  });
});

/**
 * POST /api/settings
 * Moderator-only endpoint: updates configuration settings and automatically triggers a re-sync.
 */
app.post('/api/settings', async (c) => {
  const subredditName = context.subredditName ?? '';
  const userId = context.userId;

  const isMod = await checkIsModerator(subredditName, userId);
  if (!isMod) {
    return c.json<SettingsApiResponse>(
      {
        success: false,
        error: 'Unauthorized: Only subreddit moderators can modify app settings.'
      },
      403
    );
  }

  try {
    const body = (await c.req.json()) as Partial<AppSettings>;

    // Validate Reddit API hard limits
    if (typeof body.maxPosts === 'number' && body.maxPosts > 1000) {
      return c.json<SettingsApiResponse>(
        {
          success: false,
          error: 'Reddit API Limit: Maximum posts cannot exceed 1,000. Reddit enforces a strict hard ceiling of 1,000 items on all subreddit listings.'
        },
        400
      );
    }

    if (typeof body.maxPosts === 'number' && body.maxPosts < 50) {
      return c.json<SettingsApiResponse>(
        {
          success: false,
          error: 'Invalid input: Maximum posts must be at least 50 to generate meaningful statistical medians.'
        },
        400
      );
    }

    if (typeof body.lookbackDays === 'number' && (body.lookbackDays < 1 || body.lookbackDays > 365)) {
      return c.json<SettingsApiResponse>(
        {
          success: false,
          error: 'Invalid input: Lookback period must be between 1 and 365 days.'
        },
        400
      );
    }

    const current = await getEffectiveSettings();
    const updatedSettings: AppSettings = {
      publicDashboard: typeof body.publicDashboard === 'boolean' ? body.publicDashboard : current.publicDashboard,
      lookbackDays: typeof body.lookbackDays === 'number' ? body.lookbackDays : current.lookbackDays,
      maxPosts: typeof body.maxPosts === 'number' ? body.maxPosts : current.maxPosts,
      minPostsThreshold: typeof body.minPostsThreshold === 'number' ? Math.max(1, body.minPostsThreshold) : current.minPostsThreshold,
      customGroupsRaw: typeof body.customGroupsRaw === 'string' ? body.customGroupsRaw : current.customGroupsRaw
    };

    await saveSettingsOverride(redis, updatedSettings);

    let report: AggregateReport | undefined;
    if (subredditName) {
      report = await performSync(subredditName, updatedSettings);
    }

    return c.json<SettingsApiResponse>({
      success: true,
      settings: updatedSettings,
      report
    });
  } catch (err: any) {
    return c.json<SettingsApiResponse>(
      {
        success: false,
        error: `Failed to update settings: ${err?.message || String(err)}`
      },
      500
    );
  }
});

/**
 * GET /api/report
 * Returns the cached aggregation report, or generates one if cache is uninitialized.
 * If the dashboard is configured as Private, only verified moderators receive the report.
 */
app.get('/api/report', async (c) => {
  const subredditName = context.subredditName ?? '';
  const userId = context.userId;
  let report = await getReport(redis);
  const syncStatus = await getSyncStatus(redis);
  const currentSettings = await getEffectiveSettings();

  const isMod = await checkIsModerator(subredditName, userId);

  // If dashboard is set to Private (mod-only) and viewer is not a moderator, return privacy lock
  if (!isMod && !currentSettings.publicDashboard) {
    return c.json<ReportApiResponse>({
      success: true,
      isPrivate: true,
      report: undefined,
      syncStatus: syncStatus ?? null,
      settings: { ...currentSettings, customGroupsRaw: '' },
      availableFlairs: []
    });
  }

  // If no cached report exists yet, perform initial sync
  if (!report && subredditName) {
    try {
      report = await performSync(subredditName, currentSettings);
    } catch (err) {
      console.error('Initial auto-sync failed:', err);
    }
  }

  const availableFlairs = await getSubredditFlairs(subredditName);

  return c.json<ReportApiResponse>({
    success: !!report,
    isPrivate: false,
    report: report ?? undefined,
    syncStatus: syncStatus ?? null,
    settings: report?.settingsUsed ?? currentSettings,
    availableFlairs
  });
});

/**
 * POST /api/sync
 * Manual cache refresh trigger for moderators from the Custom Post admin overlay.
 */
app.post('/api/sync', async (c) => {
  const subredditName = context.subredditName ?? '';
  const userId = context.userId;

  const isMod = await checkIsModerator(subredditName, userId);
  if (!isMod) {
    return c.json<SyncApiResponse>(
      {
        success: false,
        error: 'Unauthorized: Only subreddit moderators can trigger manual sync.'
      },
      403
    );
  }

  try {
    const report = await performSync(subredditName);
    return c.json<SyncApiResponse>({
      success: true,
      message: `Successfully synchronized ${report.totalPostsAnalyzed} submissions over the past ${report.windowDays} days.`,
      report
    });
  } catch (err: any) {
    return c.json<SyncApiResponse>(
      {
        success: false,
        error: `Sync failed: ${err?.message || String(err)}`
      },
      500
    );
  }
});

// ==========================================
// Scheduled Background Jobs & Menu Actions
// ==========================================

/**
 * POST /internal/cron/nightly-sync
 * Daily scheduled cron job: runs in background at midnight to refresh Redis metrics.
 */
app.post('/internal/cron/nightly-sync', async (c) => {
  const subredditName = context.subredditName ?? '';
  console.log(`[Scheduler] Running nightly 90-day flair sync for r/${subredditName}...`);

  if (subredditName) {
    try {
      await performSync(subredditName);
      console.log(`[Scheduler] Nightly sync completed successfully for r/${subredditName}`);
    } catch (err) {
      console.error(`[Scheduler] Nightly sync failed for r/${subredditName}:`, err);
    }
  }

  return c.json({ success: true });
});

/**
 * POST /internal/triggers/on-install
 * Event Trigger: automatically runs initial scan & creates the dashboard post when app is installed.
 */
app.post('/internal/triggers/on-install', async (c) => {
  const subredditName = context.subredditName ?? '';
  console.log(`[onAppInstall] App installed on r/${subredditName}. Auto-generating dashboard...`);

  if (subredditName && subredditName !== 'unknown') {
    try {
      const report = await performSync(subredditName);
      const post = await reddit.submitCustomPost({
        subredditName,
        title: `📊 r/${subredditName} Flair Impact & Transparency Dashboard`
      });

      try {
        await post.approve();
      } catch (e) {
        console.warn('Could not auto-approve custom post:', e);
      }

      console.log(`[onAppInstall] Auto-created dashboard post ${post.id} for r/${subredditName}`);
    } catch (err) {
      console.error(`[onAppInstall] Failed to auto-generate dashboard post on r/${subredditName}:`, err);
    }
  }

  return c.json({ success: true });
});

/**
 * POST /internal/menu/analyze-flair
 * Moderator menu action in subreddit tools: scans flair activity and creates the custom transparency post.
 */
app.post('/internal/menu/analyze-flair', async (c) => {
  const subredditName = context.subredditName ?? '';
  console.log(`[Mod Menu] 'Analyze Flair Engagement' invoked for r/${subredditName}`);

  // Run initial or refreshed sync
  const report = await performSync(subredditName);

  // Submit custom transparency post
  const post = await reddit.submitCustomPost({
    subredditName,
    title: `📊 r/${subredditName} Flair Impact & Transparency Dashboard`
  });

  // Approve post so it is immediately visible
  try {
    await post.approve();
  } catch (e) {
    console.warn('Could not auto-approve custom post:', e);
  }

  return c.json<UiResponse>({
    navigateTo: `https://www.reddit.com${post.permalink}`,
    showToast: {
      text: `Flair analysis complete! Scanned ${report.totalPostsAnalyzed} posts. Dashboard created.`,
      appearance: 'success'
    }
  });
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort()
});
