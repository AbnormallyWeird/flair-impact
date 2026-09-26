import { RedditClient } from '@devvit/reddit';
import { AggregateReport, AppSettings, DEFAULT_APP_SETTINGS, PostSnapshot } from '../types.js';
import { aggregatePosts } from './stats.js';

/**
 * Scans submissions in the specified subreddit backwards up to the configured lookback window and max posts limit,
 * extracts tracking metrics, and aggregates by flair type and optional custom groups.
 */
export async function runFlairAnalysis(
  reddit: RedditClient,
  subredditName: string,
  settings: AppSettings = DEFAULT_APP_SETTINGS
): Promise<AggregateReport> {
  const cutoffTimestamp = Date.now() - settings.lookbackDays * 24 * 60 * 60 * 1000;
  // Reddit's listing endpoints enforce an absolute hard cap of 1,000 submissions
  const maxLimit = Math.max(10, Math.min(settings.maxPosts || 1000, 1000));
  const snapshots: PostSnapshot[] = [];

  try {
    const listing = reddit.getNewPosts({
      subredditName,
      limit: maxLimit,
      pageSize: 100
    });

    for await (const post of listing) {
      const createdAtMs = post.createdAt.getTime();
      // Enforce the rolling time window
      if (createdAtMs < cutoffTimestamp) {
        break;
      }

      const flairText = post.flair?.text?.trim() || 'Unflaired';
      snapshots.push({
        id: post.id,
        title: post.title,
        flairText,
        numComments: post.numberOfComments ?? 0,
        score: post.score ?? 0,
        upvoteRatio: (post as any).upvoteRatio ?? 1.0,
        createdAt: createdAtMs
      });

      if (snapshots.length >= maxLimit) {
        break;
      }
    }
  } catch (err) {
    console.error(`Error during flair analysis scan for r/${subredditName}:`, err);
  }

  return aggregatePosts(snapshots, subredditName, settings);
}

