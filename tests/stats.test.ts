import { describe, it, expect } from 'vitest';
import {
  calculateMedian,
  calculateMean,
  parseCustomGroups,
  aggregatePosts
} from '../src/services/stats.js';
import { PostSnapshot, DEFAULT_APP_SETTINGS, AppSettings } from '../src/types.js';

describe('Statistical Engine - calculateMedian', () => {
  it('handles empty array', () => {
    expect(calculateMedian([])).toBe(0);
  });

  it('calculates median for odd-length array', () => {
    expect(calculateMedian([5, 1, 9])).toBe(5);
    expect(calculateMedian([10, 2, 38, 23, 38, 23, 21])).toBe(23);
  });

  it('calculates median for even-length array', () => {
    expect(calculateMedian([1, 3, 3, 6, 7, 8])).toBe(4.5);
    expect(calculateMedian([10, 20])).toBe(15);
  });

  it('is robust against extreme viral outliers', () => {
    const commentsWithViralPost = [5, 6, 7, 8, 9, 10, 5000];
    const mean = calculateMean(commentsWithViralPost);
    const median = calculateMedian(commentsWithViralPost);

    expect(mean).toBe(720.7); // Mean is heavily distorted
    expect(median).toBe(8);   // Median remains representative of typical engagement
  });
});

describe('Statistical Engine - parseCustomGroups', () => {
  it('handles empty or blank input', () => {
    expect(parseCustomGroups('').size).toBe(0);
    expect(parseCustomGroups('   ').size).toBe(0);
    expect(parseCustomGroups(undefined).size).toBe(0);
  });

  it('parses line-by-line format correctly', () => {
    const raw = `
      Discussion: Question, Technical Help, General Discussion
      Promotions: Vendor, Showcase, Deals
    `;
    const map = parseCustomGroups(raw);
    expect(map.size).toBe(2);
    expect(map.get('Discussion')).toEqual(['question', 'technical help', 'general discussion']);
    expect(map.get('Promotions')).toEqual(['vendor', 'showcase', 'deals']);
  });

  it('parses JSON format correctly', () => {
    const raw = JSON.stringify({
      Advice: ['Question', 'Help'],
      Commercial: ['Vendor', 'Promo']
    });
    const map = parseCustomGroups(raw);
    expect(map.size).toBe(2);
    expect(map.get('Advice')).toEqual(['question', 'help']);
    expect(map.get('Commercial')).toEqual(['vendor', 'promo']);
  });
});

describe('Statistical Engine - aggregatePosts with Settings', () => {
  const samplePosts: PostSnapshot[] = [
    {
      id: 'p1',
      title: 'How should I structure my database?',
      flairText: 'Question',
      numComments: 20,
      score: 15,
      upvoteRatio: 0.95,
      createdAt: 1700000000000
    },
    {
      id: 'p2',
      title: 'Best practices for state management',
      flairText: 'Question',
      numComments: 30,
      score: 25,
      upvoteRatio: 0.9,
      createdAt: 1700005000000
    },
    {
      id: 'p3',
      title: 'Check out my new side project',
      flairText: 'Showcase',
      numComments: 5,
      score: 2,
      upvoteRatio: 0.55,
      createdAt: 1700010000000
    },
    {
      id: 'p4',
      title: 'New tool for developers',
      flairText: 'Showcase',
      numComments: 7,
      score: 3,
      upvoteRatio: 0.6,
      createdAt: 1700015000000
    },
    {
      id: 'p5',
      title: 'Community meetup picture',
      flairText: 'Discussion',
      numComments: 12,
      score: 50,
      upvoteRatio: 0.98,
      createdAt: 1700020000000
    }
  ];

  it('computes community baseline and per-flair response rate deltas with default settings', () => {
    const report = aggregatePosts(samplePosts, 'devcommunity', DEFAULT_APP_SETTINGS);

    expect(report.totalPostsAnalyzed).toBe(5);
    expect(report.flairBreakdown.length).toBe(3);

    // Overall Community Response Baseline:
    // comments: [5, 7, 12, 20, 30] -> median 12, mean 14.8
    expect(report.overallMedianComments).toBe(12);
    expect(report.overallAvgComments).toBe(14.8);
    expect(report.overallTotalComments).toBe(74);

    // Top and lowest responding flairs (when minPostsThreshold allows or falls back)
    expect(report.topResponseFlair?.flairText).toBe('Question');
    expect(report.topResponseFlair?.medianComments).toBe(25);
    expect(report.lowestResponseFlair?.flairText).toBe('Showcase');
    expect(report.lowestResponseFlair?.medianComments).toBe(6);

    // Question: median 25 vs baseline 12 => ((25 - 12) / 12) * 100 = +108.3%
    const questionFlair = report.flairBreakdown.find((f) => f.flairText === 'Question');
    expect(questionFlair?.deltaVsCommunityBaselinePct).toBe(108.3);

    // Showcase: median 6 vs baseline 12 => ((6 - 12) / 12) * 100 = -50.0%
    const showcaseFlair = report.flairBreakdown.find((f) => f.flairText === 'Showcase');
    expect(showcaseFlair?.deltaVsCommunityBaselinePct).toBe(-50.0);
  });

  it('aggregates custom groups when configured in settings', () => {
    const customSettings: AppSettings = {
      publicDashboard: true,
      lookbackDays: 60,
      maxPosts: 500,
      minPostsThreshold: 2,
      customGroupsRaw: 'Interactive: Question, Discussion\nPromos: Showcase'
    };

    const report = aggregatePosts(samplePosts, 'devcommunity', customSettings);

    expect(report.windowDays).toBe(60);
    expect(report.groupSummaries).toBeDefined();
    expect(report.groupSummaries?.length).toBe(2);

    const interactiveGroup = report.groupSummaries?.find((g) => g.groupName === 'Interactive');
    expect(interactiveGroup).toBeDefined();
    expect(interactiveGroup?.totalPosts).toBe(3); // 2 Question + 1 Discussion
    // comments: [12, 20, 30] -> median 20
    expect(interactiveGroup?.medianComments).toBe(20);
    // Baseline is 12: ((20 - 12) / 12) * 100 = +66.7%
    expect(interactiveGroup?.deltaVsCommunityBaselinePct).toBe(66.7);

    const promoGroup = report.groupSummaries?.find((g) => g.groupName === 'Promos');
    expect(promoGroup).toBeDefined();
    expect(promoGroup?.totalPosts).toBe(2);
    expect(promoGroup?.medianComments).toBe(6);
    expect(promoGroup?.deltaVsCommunityBaselinePct).toBe(-50);

    // Verify flairBreakdown has assignedGroup tags
    const questionFlair = report.flairBreakdown.find((f) => f.flairText === 'Question');
    expect(questionFlair?.assignedGroup).toBe('Interactive');
    const showcaseFlair = report.flairBreakdown.find((f) => f.flairText === 'Showcase');
    expect(showcaseFlair?.assignedGroup).toBe('Promos');
  });

  it('respects minPostsThreshold for top/lowest rankings', () => {
    const settingsWithThreshold: AppSettings = {
      publicDashboard: true,
      lookbackDays: 90,
      maxPosts: 1000,
      minPostsThreshold: 2, // Discussion only has 1 post, so it won't be eligible
      customGroupsRaw: ''
    };

    const report = aggregatePosts(samplePosts, 'devcommunity', settingsWithThreshold);

    // Eligible: Question (2 posts), Showcase (2 posts). Discussion (1 post) excluded from highlights.
    expect(report.topResponseFlair?.flairText).toBe('Question');
    expect(report.lowestResponseFlair?.flairText).toBe('Showcase');
  });
});
