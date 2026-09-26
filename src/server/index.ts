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
  saveSyncStatus,
  getDashboardPostId,
  saveDashboardPostId
} from '../services/storage.js';
import {
  AggregateReport,
  AppSettings,
  DEFAULT_APP_SETTINGS,
  FlairsApiResponse,
  ReportApiResponse,
  SettingsApiResponse,
  SidebarWidgetApiResponse,
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
  let autoSidebarWidget = cachedOverride?.autoSidebarWidget;

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
    if (autoSidebarWidget === undefined) {
      const val = await settings.get<boolean>('autoSidebarWidget');
      if (typeof val === 'boolean') autoSidebarWidget = val;
    }
  } catch (err) {
    // In local development or uninitialized environments, settings.get may fail gracefully
  }

  return {
    publicDashboard: publicDashboard ?? DEFAULT_APP_SETTINGS.publicDashboard,
    lookbackDays: lookbackDays ?? DEFAULT_APP_SETTINGS.lookbackDays,
    maxPosts: maxPosts ?? DEFAULT_APP_SETTINGS.maxPosts,
    minPostsThreshold: minPostsThreshold ?? DEFAULT_APP_SETTINGS.minPostsThreshold,
    customGroupsRaw: customGroupsRaw ?? DEFAULT_APP_SETTINGS.customGroupsRaw,
    autoSidebarWidget: autoSidebarWidget ?? DEFAULT_APP_SETTINGS.autoSidebarWidget
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
      customGroupsRaw: typeof body.customGroupsRaw === 'string' ? body.customGroupsRaw : current.customGroupsRaw,
      autoSidebarWidget: typeof body.autoSidebarWidget === 'boolean' ? body.autoSidebarWidget : current.autoSidebarWidget
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
 * Checks whether an active Flair Impact Dashboard post already exists for this subreddit.
 * Checks Redis first, and falls back to scanning recent submissions to detect any pre-existing dashboard post.
 */
async function findExistingDashboardPost(subredditName: string): Promise<any | null> {
  // 1. Check Redis for a tracked postId
  const cachedId = await getDashboardPostId(redis);
  if (cachedId) {
    try {
      const post = await reddit.getPostById(cachedId as any);
      if (post && !post.removed) {
        return post;
      }
    } catch {
      // Cached post was deleted or inaccessible
    }
  }

  // 2. Scan recent posts on the subreddit to find any existing dashboard post
  if (subredditName && subredditName !== 'unknown') {
    try {
      const recentPosts = await reddit.getNewPosts({ subredditName, limit: 25 }).all();
      for (const p of recentPosts) {
        if (
          !p.removed &&
          p.title &&
          (p.title.includes('Flair Impact & Transparency Dashboard') ||
            p.title.includes('Flair Response & Impact Analyzer') ||
            p.title.includes('Flair Impact'))
        ) {
          // Found an existing active post! Track its ID in Redis
          await saveDashboardPostId(redis, p.id);
          return p;
        }
      }
    } catch (err) {
      console.warn(`Could not scan recent posts for existing dashboard on r/${subredditName}:`, err);
    }
  }

  return null;
}

/**
 * Automatically creates or updates a Button Widget in the subreddit sidebar linking to the dashboard post.
 */
export async function syncSidebarWidget(
  subredditName: string,
  postPermalink: string
): Promise<{ success: boolean; widgetId?: string; alreadyExisted?: boolean; error?: string }> {
  if (!subredditName || subredditName === 'unknown') {
    return { success: false, error: 'Subreddit name not resolved' };
  }

  const fullUrl = postPermalink.startsWith('http')
    ? postPermalink
    : `https://www.reddit.com${postPermalink}`;

  const WIDGET_NAME = 'Flair Analytics';
  const WIDGET_DESC = 'Explore community flair engagement, response times, and discussion trends.';
  const BUTTON_TEXT = '📊 View Flair Dashboard';

  try {
    let existingWidget: any = null;
    try {
      const widgets = await reddit.getWidgets(subredditName);
      existingWidget = widgets.find(
        (w: any) =>
          w.name === WIDGET_NAME ||
          w.name === 'Flair Impact' ||
          w.name === 'Flair Transparency'
      );
    } catch (e) {
      console.warn(`Could not list widgets for r/${subredditName}:`, e);
    }

    const buttonPayload = {
      kind: 'text',
      text: BUTTON_TEXT,
      url: fullUrl,
      linkUrl: fullUrl,
      color: '#0079D3',
      fillColor: '#0079D3',
      textColor: '#FFFFFF'
    };

    if (existingWidget) {
      try {
        await reddit.updateWidget({
          type: 'button',
          subreddit: subredditName,
          id: existingWidget.id,
          shortName: WIDGET_NAME,
          description: WIDGET_DESC,
          buttons: [buttonPayload]
        });
        return { success: true, widgetId: existingWidget.id, alreadyExisted: true };
      } catch (updateErr: any) {
        console.warn(`Could not update existing sidebar widget ${existingWidget.id}:`, updateErr);
        return { success: true, widgetId: existingWidget.id, alreadyExisted: true };
      }
    }

    try {
      const newWidget = await reddit.addWidget({
        type: 'button',
        subreddit: subredditName,
        shortName: WIDGET_NAME,
        description: WIDGET_DESC,
        buttons: [buttonPayload]
      });

      return { success: true, widgetId: newWidget.id, alreadyExisted: false };
    } catch (btnErr) {
      console.warn('Button widget creation failed, attempting fallback to textarea widget:', btnErr);
      const textWidget = await reddit.addWidget({
        type: 'textarea',
        subreddit: subredditName,
        shortName: WIDGET_NAME,
        text: `### 📊 Flair Impact Dashboard\n\nExplore community flair response times, discussion volumes, and engagement trends:\n\n[**👉 Open Interactive Dashboard**](${fullUrl})`
      });
      return { success: true, widgetId: textWidget.id, alreadyExisted: false };
    }
  } catch (err: any) {
    console.warn(`Failed to automatically add sidebar widget to r/${subredditName}:`, err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * POST /api/sidebar-widget
 * Moderator endpoint to automatically add or synchronize the subreddit sidebar widget.
 */
app.post('/api/sidebar-widget', async (c) => {
  const subredditName = context.subredditName ?? '';
  const userId = context.userId;

  const isMod = await checkIsModerator(subredditName, userId);
  if (!isMod) {
    return c.json<SidebarWidgetApiResponse>(
      {
        success: false,
        error: 'Unauthorized: Only subreddit moderators can configure sidebar widgets.'
      },
      403
    );
  }

  const existingPost = await findExistingDashboardPost(subredditName);
  if (!existingPost) {
    return c.json<SidebarWidgetApiResponse>(
      {
        success: false,
        error: 'No active dashboard post found. Please publish a dashboard post to your subreddit first.'
      },
      400
    );
  }

  const fullUrl = `https://www.reddit.com${existingPost.permalink}`;
  const result = await syncSidebarWidget(subredditName, existingPost.permalink);

  return c.json<SidebarWidgetApiResponse>({
    success: result.success,
    widgetId: result.widgetId,
    alreadyExisted: result.alreadyExisted,
    permalink: existingPost.permalink,
    fullUrl,
    message: result.success
      ? (result.alreadyExisted
          ? 'Updated existing "Flair Analytics" button widget in your subreddit sidebar.'
          : 'Successfully added "Flair Analytics" button widget to your subreddit sidebar!')
      : `Could not automatically create widget (${result.error || 'permission denied'}). You can add it manually using Mod Tools.`,
    error: result.error
  });
});

/**
 * POST /internal/menu/analyze-flair
 * Moderator menu action in subreddit tools: opens a confirmation form to customize and publish the post.
 * If an active dashboard post already exists, navigates directly to it rather than creating a duplicate.
 */
app.post('/internal/menu/analyze-flair', async (c) => {
  const subredditName = context.subredditName ?? 'this community';
  const currentSettings = await getEffectiveSettings();

  // If a dashboard post already exists, do not create a duplicate — navigate directly to it!
  const existingPost = await findExistingDashboardPost(subredditName);
  if (existingPost) {
    return c.json<UiResponse>({
      navigateTo: `https://www.reddit.com${existingPost.permalink}`,
      showToast: {
        text: `Dashboard post already active! Redirecting to post...`,
        appearance: 'success'
      }
    });
  }

  return c.json<UiResponse>({
    showForm: {
      name: 'createDashboardPostForm',
      form: {
        title: 'Publish Flair Dashboard Post',
        description: `Configure and publish an interactive Flair Impact Dashboard post directly to the r/${subredditName} feed.`,
        acceptLabel: 'Publish Post to Subreddit',
        cancelLabel: 'Cancel',
        fields: [
          {
            type: 'string',
            name: 'postTitle',
            label: 'Post Title',
            defaultValue: `📊 r/${subredditName} Flair Impact & Transparency Dashboard`,
            required: true
          },
          {
            type: 'boolean',
            name: 'publicDashboard',
            label: 'Public Transparency Mode (Community Visible)',
            helpText: 'When enabled, all community members can view analytics. When disabled, only moderators can view analytics.',
            defaultValue: currentSettings.publicDashboard
          },
          {
            type: 'boolean',
            name: 'stickyPost',
            label: 'Pin / Sticky Post to Subreddit Feed',
            helpText: 'Pin the dashboard to the top of your community feed for easy discovery.',
            defaultValue: true
          },
          {
            type: 'boolean',
            name: 'addSidebarWidget',
            label: 'Add Widget to Subreddit Sidebar',
            helpText: 'Automatically create a "Flair Analytics" button in your desktop subreddit sidebar linking directly to this dashboard.',
            defaultValue: currentSettings.autoSidebarWidget ?? true
          }
        ]
      }
    }
  });
});

/**
 * POST /internal/forms/create-dashboard-post
 * Form handler: executes when moderator confirms the "Publish Post to Subreddit" dialog.
 */
app.post('/internal/forms/create-dashboard-post', async (c) => {
  const subredditName = context.subredditName ?? '';
  const userId = context.userId;

  const isMod = await checkIsModerator(subredditName, userId);
  if (!isMod) {
    return c.json<UiResponse>(
      {
        showToast: {
          text: 'Unauthorized: Only moderators can create dashboard posts.',
          appearance: 'neutral'
        }
      },
      403
    );
  }

  // Double-check to prevent duplicate post creation
  const existingPost = await findExistingDashboardPost(subredditName);
  if (existingPost) {
    return c.json<UiResponse>({
      navigateTo: `https://www.reddit.com${existingPost.permalink}`,
      showToast: {
        text: `Active dashboard post already exists on r/${subredditName}!`,
        appearance: 'neutral'
      }
    });
  }

  const body = (await c.req.json()) as any;
  const values = body.values || body;

  const postTitle =
    typeof values.postTitle === 'string' && values.postTitle.trim()
      ? values.postTitle.trim()
      : `📊 r/${subredditName} Flair Impact & Transparency Dashboard`;

  const publicDashboard =
    typeof values.publicDashboard === 'boolean' ? values.publicDashboard : true;

  const stickyPost =
    typeof values.stickyPost === 'boolean' ? values.stickyPost : false;

  const addSidebarWidget =
    typeof values.addSidebarWidget === 'boolean' ? values.addSidebarWidget : true;

  // Persist the chosen visibility
  const currentSettings = await getEffectiveSettings();
  const updatedSettings: AppSettings = {
    ...currentSettings,
    publicDashboard
  };
  await saveSettingsOverride(redis, updatedSettings);

  // Run initial or refreshed sync
  const report = await performSync(subredditName, updatedSettings);

  // Submit custom post to subreddit
  const post = await reddit.submitCustomPost({
    subredditName,
    title: postTitle
  });

  // Track the created post in Redis so future clicks never create duplicates
  await saveDashboardPostId(redis, post.id);

  // Approve & optionally sticky
  try {
    await post.approve();
    if (stickyPost) {
      await post.sticky();
    }
  } catch (e) {
    console.warn('Could not auto-approve or sticky post:', e);
  }

  // Auto-add or synchronize the subreddit sidebar widget
  let sidebarNotice = '';
  if (addSidebarWidget) {
    try {
      const swRes = await syncSidebarWidget(subredditName, post.permalink);
      if (swRes.success) {
        sidebarNotice = ' + Sidebar widget added!';
      }
    } catch (e) {
      console.warn('Could not auto-add sidebar widget:', e);
    }
  }

  return c.json<UiResponse>({
    navigateTo: `https://www.reddit.com${post.permalink}`,
    showToast: {
      text: `Published dashboard post to r/${subredditName}! (${report.totalPostsAnalyzed} posts analyzed)${sidebarNotice}`,
      appearance: 'success'
    }
  });
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort()
});
