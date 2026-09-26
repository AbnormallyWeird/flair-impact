# Privacy Policy for Flair Impact

*Last Updated: September 2026*

This Privacy Policy explains how the **Flair Impact** Reddit application ("the App", "we", "our") handles information when installed on a subreddit via Reddit's Developer Platform (Devvit).

---

## 1. Information We Process

Flair Impact is designed with privacy and data minimization as foundational principles:

- **Public Submission Metadata**: The App queries public post submissions within the installing subreddit to calculate engagement statistics (post creation timestamp, link flair text, comment count, upvote score, and upvote ratio).
- **Aggregated Flair Statistics**: The App calculates aggregate statistical summaries (such as median comment counts, post volumes, and percentage deltas against community baselines).
- **Subreddit App Settings**: The App stores moderator-configured settings (lookback window, maximum posts to ingest, minimum highlight threshold, custom flair group mappings, and public transparency mode toggle).

## 2. Information We DO NOT Collect

- We **do not** collect or store personal identifiable information (PII) such as email addresses, real names, IP addresses, or device identifiers.
- We **do not** read, store, or analyze user private messages, modmail, chat logs, or user browsing history.
- We **do not** track individual user activity across Reddit or outside Reddit.
- We **do not** use third-party tracking scripts, analytics beacons, or advertising cookies.

## 3. Where Data is Stored

- All cached statistical reports and moderator configuration properties are stored strictly within **Reddit's native Developer Platform Redis storage service** allocated specifically to your subreddit.
- Data never leaves Reddit's infrastructure. There are no external third-party database servers, external APIs, or unauthorized data exports.

## 4. Community Visibility & Privacy Controls

Subreddit moderators maintain full control over data visibility:
- **Public Dashboard (Transparency Mode)**: When enabled by moderators, community members can view aggregated response rates and flair rankings.
- **Private Mode (Moderator-Only)**: When disabled by moderators, the server strictly restricts data access to authenticated subreddit moderators. Non-moderators receive no statistical data and are presented with a locked screen.

## 5. Data Retention & Deletion

- Aggregated statistics are periodically overwritten during automated nightly syncs or manual moderator syncs.
- When the App is uninstalled from a subreddit, all Redis keys and cached data associated with the installation are permanently removed by Reddit's Developer Platform.

## 6. Compliance

Flair Impact complies with [Reddit's Developer Terms](https://www.reddit.com/wiki/api-terms) and [Reddit's Data API Terms](https://www.reddit.com/wiki/api-terms).

## 7. Contact & Source Code

For questions, issues, or to inspect the source code, please visit the official GitHub repository or contact the developer via Reddit modmail or issue tracker.
