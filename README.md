# Subreddit Flair Impact & Response Rate Analyzer (Devvit App)

A native Reddit Devvit application that measures the impact of different post flairs on comment activity, user engagement, and post response rates over a rolling 90-day window.

The app provides community transparency through an interactive, stickied custom post dashboard, while giving subreddit moderators quantitative data on which flairs generate active discussions and which ones go unanswered.

---

## Overview & Purpose

Post flairs are often used to categorize content (e.g. Questions, Discussions, Advice, Announcements, Showcases, Memes, Promotions, or Support Requests). However, it is rarely clear how choosing a particular flair affects whether a post actually receives responses.

This application solves that by continuously analyzing submission activity across the subreddit:
- **Measures Response Rates**: Evaluates median and average comment counts per post flair.
- **Filters Outliers**: Prioritizes **median** comments over raw averages so viral spikes or mass-downvoted threads do not skew results.
- **Benchmarks Against Community Baseline**: Calculates each flair's relative impact (`+%` or `-%`) compared to the overall subreddit response baseline.
- **Identifies Trends**: Highlights the highest-responding and lowest-responding post flairs.
- **Public Community Transparency**: Renders a live, interactive dashboard inside a custom post so community members understand engagement dynamics.
- **Moderator Tools**: Includes authenticated on-demand sync triggers and raw data export (CSV and JSON) for deeper community analysis.

---

## Core Features

### 1. 90-Day Rolling Data Ingestion
- Automatically scans up to 1,000 recent submissions within a rolling 90-day window to account for posting rhythms and activity cycles.
- Tracks post title, link flair label (defaulting to `"Unflaired"` if none assigned), comment count (`numComments`), score, upvote ratio, and creation timestamp.

### 2. Statistical Aggregation Engine & Dynamic Grouping
- **Volume Breakdown**: Counts total submissions utilizing each flair and percentage of total subreddit posts.
- **Median vs. Average Response**: Computes both metrics, prioritizing median response to reflect the typical experience of community members.
- **Community Baseline Comparison**: Calculates each flair's performance relative to the overall subreddit median response rate:
  $$\text{Impact vs Baseline} = \frac{\text{Flair Median Comments} - \text{Subreddit Median Comments}}{\text{Subreddit Median Comments}} \times 100\%$$
- **Configurable Grouping**: Mod-definable custom categories (e.g. `Community Advice: Question, Technical Help` / `Showcase: Art, Video`). When left empty, flairs are shown directly with zero artificial grouping.

### 3. Subreddit App Settings & Mod Configuration
Moderators can configure properties either directly via Reddit's native App Settings (`Mod Tools > Developer Platform > flair-impact > App Settings`) or via the in-app `⚙️ App Settings & Groups` panel:
- **`lookbackDays` (number, default: 90)**: Days in the past to analyze (e.g., 30, 60, 90, 180).
- **`maxPosts` (number, default: 1000)**: Maximum submissions ingested per scan (100 to 2000).
- **`minPostsThreshold` (number, default: 5)**: Minimum post count required for a flair to be eligible for Highest/Lowest Response ranking cards.
- **`customGroups` (paragraph, default: "")**: Optional line-by-line custom grouping format (`GroupName: flair1, flair2`).

### 4. Redis Caching & Nightly Automation
- **Nightly Background Sync**: Leverages Devvit's scheduled jobs (`nightlySync` cron: `0 0 * * *`) to automatically keep the dataset fresh using configured settings.
- **Instant UI Performance**: Metrics are cached in Redis (`flair_analysis:report:latest`), allowing the dashboard to render immediately for visitors without exhausting Reddit API rate limits.

### 5. Interactive Dual-Access Custom Post Dashboard
- **Public Dashboard**:
  - Live window badge (e.g., "Rolling 90-day window") and last synchronized timestamp.
  - Subreddit response overview cards: Community Median Baseline, Highest Response Flair, and Lowest Response Flair.
  - Custom group navigation tabs (when custom groups are configured by mods).
  - Real-time search bar and multi-field sorting (Median Response, Impact vs Baseline, Post Volume, Average Comments, or Score).
  - Visual response bars illustrating relative comment rates across flairs.
- **Moderator Controls Overlay**:
  - Authenticated via native Reddit user role checks (`reddit.getModerators`).
  - **"⚙️ App Settings & Groups"**: Opens the live configuration modal to tune lookback days, max posts, minimum threshold, or custom groups.
  - **"↻ Sync Data Now"**: Triggers an on-demand refresh with live feedback.
  - **"📥 Export Raw Data"**: Opens an export modal supporting formatted CSV and JSON output with one-click clipboard copying.

---

## Project Structure

```
flair-impact/
├── devvit.json            # Devvit config: permissions, post entrypoint, scheduler, and menu items
├── vite.config.ts         # Vite build configuration with @devvit/start plugin
├── package.json           # Scripts, dependencies, and type definitions
├── src/
│   ├── types.ts           # Data contracts for reports, metrics, and API responses
│   ├── server/
│   │   └── index.ts       # Hono-based Devvit backend server (cron, menu, & REST endpoints)
│   ├── client/
│   │   ├── index.html     # HTML entrypoint for the custom post web view
│   │   ├── main.tsx       # React DOM root initialization
│   │   └── App.tsx        # Interactive dashboard and moderator overlay
│   └── services/
│       ├── analyzer.ts    # 90-day submission pagination & streaming pipeline
│       ├── stats.ts       # Outlier-resistant median, baseline impact, and aggregation algorithms
│       └── storage.ts     # Redis persistence and CSV/JSON export utilities
└── tests/
    └── stats.test.ts      # Automated unit tests for median calculations, outliers, and delta metrics
```

---

## Installation & Deployment

### Prerequisites
- Node.js (v20 or higher)
- Devvit CLI: `npx devvit` or `npm install -g devvit`

### 1. Install Dependencies
```bash
npm install
```

### 2. Verify and Test
```bash
# Run unit tests
npm test

# Run strict TypeScript typecheck
npm run check-types

# Build production bundles
npm run build
```

### 3. Deploy to Reddit
```bash
# Authenticate with your Reddit Developer account
npx devvit login

# Test the app in your subreddit
npx devvit playtest <your-subreddit-name>

# Upload and publish the application
npx devvit upload
npx devvit publish
```

---

## How to Use in Your Subreddit

1. **Initialize the Dashboard**:
   - In your subreddit, open the **Moderator Tools** menu.
   - Click **"Analyze Flair Engagement"**.
   - The app will run an initial 90-day scan and publish the stickied Custom Post containing the live transparency dashboard.
2. **Reviewing Community Response**:
   - View the custom post to see how different flairs impact comment activity.
   - Sort by **"Impact (vs Baseline)"** to identify which flairs drive conversation and which flairs may benefit from clearer community posting guidelines or support.
3. **Manual Refresh & Exports**:
   - Subreddit moderators can click **"Sync Data Now"** at any time to pull recent submissions immediately.
   - Click **"Export Raw Data"** to download or copy the complete CSV dataset for external reporting or spreadsheets.
