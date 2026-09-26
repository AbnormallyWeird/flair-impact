export interface PostSnapshot {
  id: string;
  title: string;
  flairText: string;
  numComments: number;
  score: number;
  upvoteRatio: number;
  createdAt: number;
}

export interface FlairMetrics {
  flairText: string;
  postCount: number;
  totalComments: number;
  avgComments: number;
  medianComments: number;
  totalScore: number;
  avgScore: number;
  medianScore: number;
  avgUpvoteRatio: number;
  deltaVsCommunityBaselinePct: number | null;
  assignedGroup?: string;
}

export interface GroupSummary {
  groupName: string;
  totalPosts: number;
  medianComments: number;
  avgComments: number;
  deltaVsCommunityBaselinePct: number | null;
  flairCount: number;
  flairs: string[];
}

export interface AppSettings {
  publicDashboard: boolean;
  lookbackDays: number;
  maxPosts: number;
  minPostsThreshold: number;
  customGroupsRaw: string;
}

export interface AggregateReport {
  subredditName: string;
  generatedAt: number;
  windowDays: number;
  totalPostsAnalyzed: number;
  dateRangeStart: number;
  dateRangeEnd: number;
  overallMedianComments: number;
  overallAvgComments: number;
  overallTotalComments: number;
  topResponseFlair?: { flairText: string; medianComments: number; postCount: number } | null;
  lowestResponseFlair?: { flairText: string; medianComments: number; postCount: number } | null;
  flairBreakdown: FlairMetrics[];
  groupSummaries?: GroupSummary[];
  settingsUsed?: AppSettings;
}

export interface SyncStatus {
  lastSyncTimestamp: number;
  status: 'idle' | 'syncing' | 'success' | 'error';
  totalPostsProcessed: number;
  durationMs: number;
  errorMessage?: string;
}

export interface ReportApiResponse {
  success: boolean;
  report?: AggregateReport;
  syncStatus?: SyncStatus | null;
  settings?: AppSettings;
  availableFlairs?: string[];
  isPrivate?: boolean;
  error?: string;
}

export interface UserStatusApiResponse {
  isModerator: boolean;
  username?: string;
  subredditName: string;
  settings?: AppSettings;
  availableFlairs?: string[];
}

export interface FlairsApiResponse {
  success: boolean;
  flairs: string[];
  error?: string;
}

export interface SyncApiResponse {
  success: boolean;
  message?: string;
  report?: AggregateReport;
  error?: string;
}

export interface SettingsApiResponse {
  success: boolean;
  settings?: AppSettings;
  report?: AggregateReport;
  error?: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  publicDashboard: true,
  lookbackDays: 90,
  maxPosts: 1000,
  minPostsThreshold: 5,
  customGroupsRaw: ''
};

