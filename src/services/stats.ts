import {
  AggregateReport,
  AppSettings,
  DEFAULT_APP_SETTINGS,
  FlairMetrics,
  GroupSummary,
  PostSnapshot
} from '../types.js';

export function calculateMedian(numbers: number[]): number {
  if (!numbers || numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
  }
  return Number(sorted[mid].toFixed(1));
}

export function calculateMean(numbers: number[]): number {
  if (!numbers || numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, val) => acc + val, 0);
  return Number((sum / numbers.length).toFixed(1));
}

/**
 * Parses user-configured custom flair groupings from raw text (line-by-line or JSON).
 * Line format: "GroupName: flair1, flair2"
 * JSON format: {"GroupName": ["flair1", "flair2"]}
 */
export function parseCustomGroups(raw?: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!raw || !raw.trim()) return map;

  const trimmed = raw.trim();
  // Try JSON first if structured as an object
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      for (const [groupName, flairs] of Object.entries(obj)) {
        if (Array.isArray(flairs)) {
          const cleaned = flairs
            .map((f) => String(f).trim().toLowerCase())
            .filter((f) => f.length > 0);
          if (cleaned.length > 0) {
            map.set(groupName.trim(), cleaned);
          }
        }
      }
      return map;
    } catch {
      // Fall through to line-by-line format
    }
  }

  // Line-by-line format
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const groupName = line.slice(0, colonIdx).trim();
    const flairsStr = line.slice(colonIdx + 1).trim();
    if (!groupName || !flairsStr) continue;

    const flairs = flairsStr
      .split(',')
      .map((f) => f.trim().toLowerCase())
      .filter((f) => f.length > 0);

    if (flairs.length > 0) {
      map.set(groupName, flairs);
    }
  }

  return map;
}

export function aggregatePosts(
  posts: PostSnapshot[],
  subredditName: string,
  settings: AppSettings = DEFAULT_APP_SETTINGS
): AggregateReport {
  const now = Date.now();
  const windowDays = settings.lookbackDays ?? DEFAULT_APP_SETTINGS.lookbackDays;
  const customGroupMap = parseCustomGroups(settings.customGroupsRaw);

  if (posts.length === 0) {
    return {
      subredditName,
      generatedAt: now,
      windowDays,
      totalPostsAnalyzed: 0,
      dateRangeStart: now,
      dateRangeEnd: now,
      overallMedianComments: 0,
      overallAvgComments: 0,
      overallTotalComments: 0,
      topResponseFlair: null,
      lowestResponseFlair: null,
      flairBreakdown: [],
      groupSummaries: [],
      settingsUsed: settings
    };
  }

  // Calculate community-wide response baselines across all submissions
  const allComments = posts.map((p) => p.numComments);
  const overallMedianComments = calculateMedian(allComments);
  const overallAvgComments = calculateMean(allComments);
  const overallTotalComments = allComments.reduce((a, b) => a + b, 0);

  // Group posts by flair text
  const flairGroups = new Map<string, PostSnapshot[]>();
  for (const post of posts) {
    const flair = post.flairText && post.flairText.trim().length > 0 ? post.flairText.trim() : 'Unflaired';
    const group = flairGroups.get(flair) ?? [];
    group.push(post);
    flairGroups.set(flair, group);
  }

  // Compute metrics for each individual flair
  const flairBreakdown: FlairMetrics[] = [];
  for (const [flairText, groupPosts] of flairGroups.entries()) {
    const comments = groupPosts.map((p) => p.numComments);
    const scores = groupPosts.map((p) => p.score);
    const upvotes = groupPosts.map((p) => p.upvoteRatio);

    const totalComments = comments.reduce((a, b) => a + b, 0);
    const totalScore = scores.reduce((a, b) => a + b, 0);
    const medianComments = calculateMedian(comments);

    let deltaVsCommunityBaselinePct: number | null = null;
    if (overallMedianComments > 0) {
      deltaVsCommunityBaselinePct = Number(
        (((medianComments - overallMedianComments) / overallMedianComments) * 100).toFixed(1)
      );
    } else if (medianComments === 0) {
      deltaVsCommunityBaselinePct = 0;
    }

    // Determine assigned custom group (if any)
    let assignedGroup: string | undefined;
    if (customGroupMap.size > 0) {
      const lowerFlair = flairText.toLowerCase();
      for (const [groupName, flairs] of customGroupMap.entries()) {
        if (flairs.includes(lowerFlair)) {
          assignedGroup = groupName;
          break;
        }
      }
    }

    flairBreakdown.push({
      flairText,
      postCount: groupPosts.length,
      totalComments,
      avgComments: calculateMean(comments),
      medianComments,
      totalScore,
      avgScore: calculateMean(scores),
      medianScore: calculateMedian(scores),
      avgUpvoteRatio: calculateMean(upvotes.map((u) => u * 100)),
      deltaVsCommunityBaselinePct,
      assignedGroup
    });
  }

  // Sort flair breakdown by postCount descending
  flairBreakdown.sort((a, b) => b.postCount - a.postCount);

  // Compute Group Summaries if custom groups are defined
  const groupSummaries: GroupSummary[] = [];
  if (customGroupMap.size > 0) {
    for (const [groupName, groupFlairs] of customGroupMap.entries()) {
      const matchingPosts = posts.filter((p) => {
        const f = (p.flairText?.trim() || 'Unflaired').toLowerCase();
        return groupFlairs.includes(f);
      });
      const matchingFlairs = flairBreakdown.filter((f) =>
        groupFlairs.includes(f.flairText.toLowerCase())
      );

      if (matchingPosts.length > 0) {
        const groupComments = matchingPosts.map((p) => p.numComments);
        const groupMedian = calculateMedian(groupComments);
        let delta: number | null = null;
        if (overallMedianComments > 0) {
          delta = Number(
            (((groupMedian - overallMedianComments) / overallMedianComments) * 100).toFixed(1)
          );
        } else if (groupMedian === 0) {
          delta = 0;
        }

        groupSummaries.push({
          groupName,
          totalPosts: matchingPosts.length,
          medianComments: groupMedian,
          avgComments: calculateMean(groupComments),
          deltaVsCommunityBaselinePct: delta,
          flairCount: matchingFlairs.length,
          flairs: matchingFlairs.map((f) => f.flairText)
        });
      } else {
        groupSummaries.push({
          groupName,
          totalPosts: 0,
          medianComments: 0,
          avgComments: 0,
          deltaVsCommunityBaselinePct: null,
          flairCount: 0,
          flairs: []
        });
      }
    }
  }

  // Identify highest and lowest responding flairs, taking minPostsThreshold into account
  const minThreshold = settings.minPostsThreshold ?? DEFAULT_APP_SETTINGS.minPostsThreshold;
  const eligibleFlairs = flairBreakdown.filter((f) => f.postCount >= minThreshold);
  const rankingPool = eligibleFlairs.length > 0 ? eligibleFlairs : flairBreakdown;

  const sortedByResponse = [...rankingPool].sort((a, b) => b.medianComments - a.medianComments);
  const topResponseFlair = sortedByResponse.length > 0
    ? {
        flairText: sortedByResponse[0].flairText,
        medianComments: sortedByResponse[0].medianComments,
        postCount: sortedByResponse[0].postCount
      }
    : null;
  const lowestResponseFlair = sortedByResponse.length > 0
    ? {
        flairText: sortedByResponse[sortedByResponse.length - 1].flairText,
        medianComments: sortedByResponse[sortedByResponse.length - 1].medianComments,
        postCount: sortedByResponse[sortedByResponse.length - 1].postCount
      }
    : null;

  const timestamps = posts.map((p) => p.createdAt);
  const dateRangeStart = Math.min(...timestamps);
  const dateRangeEnd = Math.max(...timestamps);

  return {
    subredditName,
    generatedAt: now,
    windowDays,
    totalPostsAnalyzed: posts.length,
    dateRangeStart,
    dateRangeEnd,
    overallMedianComments,
    overallAvgComments,
    overallTotalComments,
    topResponseFlair,
    lowestResponseFlair,
    flairBreakdown,
    groupSummaries: groupSummaries.length > 0 ? groupSummaries : undefined,
    settingsUsed: settings
  };
}

