import type { RedisClient } from '@devvit/redis';
import { AggregateReport, AppSettings, SyncStatus } from '../types.js';

const REDIS_KEYS = {
  LATEST_REPORT: 'flair_analysis:report:latest',
  SYNC_STATUS: 'flair_analysis:status',
  SETTINGS_OVERRIDE: 'flair_analysis:settings:override',
  DASHBOARD_POST_ID: 'flair_analysis:post_id'
};

export async function saveDashboardPostId(redis: RedisClient, postId: string): Promise<void> {
  await redis.set(REDIS_KEYS.DASHBOARD_POST_ID, postId);
}

export async function getDashboardPostId(redis: RedisClient): Promise<string | null> {
  const id = await redis.get(REDIS_KEYS.DASHBOARD_POST_ID);
  return id || null;
}

export async function saveReport(redis: RedisClient, report: AggregateReport): Promise<void> {
  await redis.set(REDIS_KEYS.LATEST_REPORT, JSON.stringify(report));
}

export async function getReport(redis: RedisClient): Promise<AggregateReport | null> {
  const data = await redis.get(REDIS_KEYS.LATEST_REPORT);
  if (!data) return null;
  try {
    return JSON.parse(data) as AggregateReport;
  } catch (err) {
    console.error('Failed to parse cached flair report:', err);
    return null;
  }
}

export async function saveSyncStatus(redis: RedisClient, status: SyncStatus): Promise<void> {
  await redis.set(REDIS_KEYS.SYNC_STATUS, JSON.stringify(status));
}

export async function getSyncStatus(redis: RedisClient): Promise<SyncStatus | null> {
  const data = await redis.get(REDIS_KEYS.SYNC_STATUS);
  if (!data) return null;
  try {
    return JSON.parse(data) as SyncStatus;
  } catch (err) {
    console.error('Failed to parse cached sync status:', err);
    return null;
  }
}

export async function saveSettingsOverride(redis: RedisClient, settings: AppSettings): Promise<void> {
  await redis.set(REDIS_KEYS.SETTINGS_OVERRIDE, JSON.stringify(settings));
}

export async function getSettingsOverride(redis: RedisClient): Promise<AppSettings | null> {
  const data = await redis.get(REDIS_KEYS.SETTINGS_OVERRIDE);
  if (!data) return null;
  try {
    return JSON.parse(data) as AppSettings;
  } catch (err) {
    console.error('Failed to parse settings override:', err);
    return null;
  }
}

export function formatExportJson(report: AggregateReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatExportCsv(report: AggregateReport): string {
  const headers = [
    'Flair Text',
    'Assigned Group',
    'Post Count',
    'Total Comments',
    'Avg Comments',
    'Median Comments',
    'Impact vs Baseline (%)',
    'Avg Score',
    'Median Score',
    'Avg Upvote Ratio (%)'
  ];

  const rows = report.flairBreakdown.map((f) => [
    `"${f.flairText.replace(/"/g, '""')}"`,
    `"${(f.assignedGroup || 'None').replace(/"/g, '""')}"`,
    f.postCount,
    f.totalComments,
    f.avgComments,
    f.medianComments,
    f.deltaVsCommunityBaselinePct !== null ? `${f.deltaVsCommunityBaselinePct}%` : 'N/A',
    f.avgScore,
    f.medianScore,
    f.avgUpvoteRatio
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

