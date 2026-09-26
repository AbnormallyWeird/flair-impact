import type { AggregateReport, AppSettings, PostSnapshot, UserStatusApiResponse } from '../types.js';
import { aggregatePosts } from '../services/stats.js';

// Pre-generated sample posts representing realistic subreddit submission activity
export const MOCK_POSTS: PostSnapshot[] = (() => {
  const posts: PostSnapshot[] = [];
  const now = Date.now();

  const flairConfigs: Array<{
    name: string;
    count: number;
    minComments: number;
    maxComments: number;
    minScore: number;
    maxScore: number;
  }> = [
    { name: 'Question', count: 248, minComments: 8, maxComments: 65, minScore: 5, maxScore: 80 },
    { name: 'Technical Help', count: 195, minComments: 5, maxComments: 50, minScore: 3, maxScore: 60 },
    { name: 'Discussion', count: 162, minComments: 4, maxComments: 45, minScore: 10, maxScore: 120 },
    { name: 'Guide / Tutorial', count: 96, minComments: 2, maxComments: 30, minScore: 15, maxScore: 200 },
    { name: 'News & Updates', count: 58, minComments: 1, maxComments: 20, minScore: 20, maxScore: 250 },
    { name: 'Showcase', count: 52, minComments: 0, maxComments: 12, minScore: 1, maxScore: 30 },
    { name: 'Unflaired', count: 31, minComments: 0, maxComments: 25, minScore: 0, maxScore: 20 }
  ];

  let idCounter = 1;
  for (const config of flairConfigs) {
    for (let i = 0; i < config.count; i++) {
      // Spread posts evenly over 90 days
      const daysAgo = (i / config.count) * 90;
      const createdAt = now - daysAgo * 86400000;
      const numComments = Math.floor(
        config.minComments + Math.random() * (config.maxComments - config.minComments)
      );
      const score = Math.floor(
        config.minScore + Math.random() * (config.maxScore - config.minScore)
      );

      posts.push({
        id: `t3_mock_${idCounter++}`,
        title: `${config.name} community post #${i + 1}`,
        flairText: config.name,
        numComments,
        score,
        upvoteRatio: 0.85 + Math.random() * 0.14,
        createdAt
      });
    }
  }

  return posts;
})();

export function createSimulatedReport(settings: AppSettings): AggregateReport {
  // Filter by lookbackDays
  const cutoff = Date.now() - settings.lookbackDays * 86400000;
  let filtered = MOCK_POSTS.filter((p) => p.createdAt >= cutoff);

  // Filter by maxPosts
  if (filtered.length > settings.maxPosts) {
    filtered = filtered.slice(0, settings.maxPosts);
  }

  return aggregatePosts(filtered, 'community_preview', settings);
}

export const DEFAULT_MOCK_SETTINGS: AppSettings = {
  publicDashboard: true,
  lookbackDays: 90,
  maxPosts: 1000,
  minPostsThreshold: 5,
  customGroupsRaw: '',
  autoSidebarWidget: true
};

export const MOCK_AVAILABLE_FLAIRS: string[] = [
  'Question',
  'Technical Help',
  'Discussion',
  'Guide / Tutorial',
  'News & Updates',
  'Showcase'
];

export const MOCK_REPORT: AggregateReport = createSimulatedReport(DEFAULT_MOCK_SETTINGS);

export const MOCK_USER_STATUS: UserStatusApiResponse = {
  isModerator: true,
  username: 'local_developer',
  subredditName: 'community_preview',
  settings: DEFAULT_MOCK_SETTINGS,
  availableFlairs: MOCK_AVAILABLE_FLAIRS
};

