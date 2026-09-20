import type { Algorithm, FeedItem, FeedResponse, FeedSourceFilters, Rule } from '@repo/shared-types';

import { resolveTopicConceptTerms } from './concepts.ts';

export type FeedFeedbackSignal = {
  external_id: string;
  channel_id?: string | null;
  eventType: 'not_interested' | 'more_like_this' | 'never_show_channel';
};

export type FeedCandidate = {
  id?: string;
  external_id: string;
  title: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  channel_id?: string | null;
  channel_description?: string | null;
  channel_subscriber_count?: number | null;
  source_kind?: 'subscription' | 'discovery' | null;
  is_short?: boolean;
  is_live?: boolean;
  content_type?: string | null;
  subscription_affinity?: number;
  candidate_relevance?: 'matched' | 'unmatched';
  published_at?: string | null;
  base_score?: number;
  topics?: string[];
};

const demoVideos: FeedCandidate[] = [
  {
    id: 'content-1',
    external_id: 'yt-1',
    title: 'AI agents workflow demo',
    channel_name: 'Build with AI',
    base_score: 76,
    topics: ['AI', 'productivity', 'tutorial'],
  },
  {
    id: 'content-2',
    external_id: 'yt-2',
    title: 'Deep work systems for founders',
    channel_name: 'Focus Daily',
    base_score: 68,
    topics: ['productivity', 'business'],
  },
  {
    id: 'content-3',
    external_id: 'yt-3',
    title: 'Celebrity gossip weekly recap',
    channel_name: 'Tabloid Hour',
    base_score: 58,
    topics: ['celebrity', 'entertainment'],
  },
  {
    id: 'content-4',
    external_id: 'yt-4',
    title: 'Engineering breakdown: AI browsing agents',
    channel_name: 'Systems Lab',
    base_score: 82,
    topics: ['AI', 'engineering', 'tutorial'],
  },
];

// A never-show rule for "gossip" must catch it regardless of channel, and a rule
// naming a channel should pin/exclude it directly — so match title, channel, and
// classifier content_type, not just the title.
function ruleConditionMatches(rule: Rule, video: { title: string; channel_name?: string | null; content_type?: string | null }): boolean {
  const condition = rule.condition_text.trim().toLowerCase();
  if (!condition) {
    return false;
  }

  const title = video.title.toLowerCase();
  if (condition.includes(title) || title.includes(condition)) {
    return true;
  }

  const channelName = (video.channel_name ?? '').trim().toLowerCase();
  if (channelName && (channelName === condition || channelName.includes(condition) || condition.includes(channelName))) {
    return true;
  }

  const contentType = (video.content_type ?? '').trim().toLowerCase();
  return contentType.length > 0 && contentType === condition;
}

function normalizeTopics(topics?: string[] | null): string[] {
  return (topics ?? [])
    .filter((topic): topic is string => typeof topic === 'string' && topic.trim().length > 0)
    .map((topic) => topic.trim());
}

export function getEligibleTopicNames(algorithm?: Algorithm | null): Set<string> {
  const weights = algorithm?.topic_weights ?? [];
  const highestWeight = Math.max(0, ...weights.map((item) => Number(item.weight) || 0));
  const threshold = Math.max(50, highestWeight * 0.6);
  return new Set(
    weights
      .filter((item) => item.topic.trim().length > 0 && item.weight >= threshold)
      .map((item) => item.topic.trim().toLowerCase()),
  );
}

function getSeriesKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(part|episode|ep)\s*\d+\b/g, '')
    .replace(/\b\d+\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join(' ');
}

export function diversifyFeedItems(items: FeedItem[], maxPerChannel = 2, maxPerSeries = 2): FeedItem[] {
  const channelCounts = new Map<string, number>();
  const seriesCounts = new Map<string, number>();

  return items.filter((item) => {
    const channelKey = (item.channel_id ?? item.channel_name ?? '').trim().toLowerCase();
    const seriesKey = getSeriesKey(item.title);
    if (channelKey && (channelCounts.get(channelKey) ?? 0) >= maxPerChannel) return false;
    if (seriesKey && (seriesCounts.get(seriesKey) ?? 0) >= maxPerSeries) return false;
    if (channelKey) channelCounts.set(channelKey, (channelCounts.get(channelKey) ?? 0) + 1);
    if (seriesKey) seriesCounts.set(seriesKey, (seriesCounts.get(seriesKey) ?? 0) + 1);
    return true;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesSemanticTerm(title: string, term: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) {
    return false;
  }

  return new RegExp(`(^|\\s|[^a-z0-9])${escapeRegex(normalizedTerm)}($|\\s|[^a-z0-9])`, 'i').test(normalizedTitle);
}

export function normalizeClassificationRecord(classification: unknown): { topics: string[]; quality_score?: number; content_type?: string } | null {
  const candidate = Array.isArray(classification) ? classification[0] : classification;

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const record = candidate as { topics?: string[] | null; quality_score?: number | null; content_type?: string | null };

  return {
    topics: Array.isArray(record.topics) ? record.topics : [],
    quality_score: typeof record.quality_score === 'number' ? record.quality_score : undefined,
    content_type: typeof record.content_type === 'string' && record.content_type.trim().length > 0 ? record.content_type.trim() : undefined,
  };
}

function inferTopicsFromTitle(title: string, algorithm?: Algorithm | null): string[] {
  const normalizedTitle = title.toLowerCase();
  const topicRules = [
    { pattern: /\b(ai|llm|gpt|agent|automation|machine learning|computer vision|vision model)\b/i, topic: 'AI' },
    { pattern: /(productivity|deep work|workflow|focus|systems|habits)/i, topic: 'Productivity' },
    { pattern: /(engineering|software|code|architecture|build)/i, topic: 'Engineering' },
    { pattern: /(business|startup|strategy|marketing|founder|product)/i, topic: 'Business' },
    { pattern: /(tutorial|how to|guide|walkthrough|demo)/i, topic: 'Tutorial' },
    { pattern: /(celebrity|gossip|entertainment|movie|music|tv|drama)/i, topic: 'Entertainment' },
  ];

  const inferredTopics = Array.from(new Set(topicRules.filter(({ pattern }) => pattern.test(normalizedTitle)).map(({ topic }) => topic)));
  const algorithmTopicMatches = (algorithm?.topic_weights ?? []).flatMap((item) => {
    const topic = item.topic.trim();
    if (!topic) {
      return [];
    }

    const conceptTerms = resolveTopicConceptTerms(topic, algorithm?.goal_text ?? '').map((term) => term.toLowerCase());
    const semanticTerms = (algorithm?.semantic_terms ?? []).map((term) => term.toLowerCase());
    const canon = topic.toLowerCase();
    const hasMatch = [...conceptTerms, ...semanticTerms].some((term) => {
      const target = term.toLowerCase();
      if (target === canon) {
        return new RegExp(`\\b${escapeRegex(target)}\\b`, 'i').test(normalizedTitle);
      }
      return matchesSemanticTerm(normalizedTitle, target);
    });

    return hasMatch ? [topic] : [];
  });

  return Array.from(new Set([...inferredTopics, ...algorithmTopicMatches]));
}

function getFreshnessBoost(publishedAt?: string | null): number {
  if (!publishedAt) {
    return 0;
  }

  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
  if (!Number.isFinite(ageHours)) {
    return 0;
  }

  if (ageHours <= 6) return 18;
  if (ageHours <= 24) return 12;
  if (ageHours <= 48) return 8;
  if (ageHours <= 120) return 4;
  return 0;
}

function getChannelQualityBoost(
  channelName?: string | null,
  channelDescription?: string | null,
  subscriberCount?: number | null,
  matchedTopics: string[] = [],
): number {
  const normalizedName = (channelName ?? '').toLowerCase();
  const normalizedDescription = (channelDescription ?? '').toLowerCase();
  if (!normalizedName && !normalizedDescription) {
    return 0;
  }

  let boost = 0;
  const qualitySignals = ['lab', 'studio', 'research', 'systems', 'daily', 'insights', 'build', 'product', 'academy', 'engineering', 'ops'];
  const lowQualitySignals = ['gossip', 'celebrity', 'tabloid', 'tv', 'news', 'buzz', 'hot'];

  const combinedText = `${normalizedName} ${normalizedDescription}`;

  if (qualitySignals.some((signal) => combinedText.includes(signal))) {
    boost += 10;
  }

  if (lowQualitySignals.some((signal) => combinedText.includes(signal))) {
    boost -= 12;
  }

  if (typeof subscriberCount === 'number' && subscriberCount > 100000) {
    boost += 6;
  }

  if (matchedTopics.includes('AI') && /(ai|lab|systems|research|build|engineering)/i.test(combinedText)) {
    boost += 8;
  }

  if (matchedTopics.includes('Productivity') && /(focus|daily|systems|habit|work|productivity)/i.test(combinedText)) {
    boost += 6;
  }

  if (matchedTopics.includes('Entertainment') && /(celebrity|gossip|tabloid|tv|entertainment)/i.test(combinedText)) {
    boost += 8;
  }

  return boost;
}

export function buildFeedResponse(
  algorithm?: Algorithm | null,
  feedbackSignals: FeedFeedbackSignal[] = [],
  candidateItems: FeedCandidate[] = demoVideos,
  options: { includeHidden?: boolean; sourceFilters?: FeedSourceFilters } = {},
): FeedResponse {
  const weights = new Map((algorithm?.topic_weights ?? []).map((item) => [item.topic.toLowerCase(), item.weight]));
  const hasTopicWeights = weights.size > 0;
  const eligibleTopics = getEligibleTopicNames(algorithm);
  const rules = algorithm?.rules ?? [];
  const sourceFilters = options.sourceFilters ?? {};
  const signalMap = new Map<string, FeedFeedbackSignal[]>();
  const blockedChannelIds = new Set<string>();

  for (const signal of feedbackSignals) {
    const existing = signalMap.get(signal.external_id) ?? [];
    existing.push(signal);
    signalMap.set(signal.external_id, existing);
    if (signal.eventType === 'never_show_channel' && signal.channel_id) {
      blockedChannelIds.add(signal.channel_id);
    }
  }

  const feedItems: FeedItem[] = candidateItems.map((video) => {
    const normalizedTopics = normalizeTopics(video.topics);
    const titleDerivedTopics = inferTopicsFromTitle(video.title, algorithm);
    const matchedTopics = [...new Set([...normalizedTopics, ...titleDerivedTopics])].filter((topic) => weights.has(topic.toLowerCase()));
    const eligibleMatchedTopics = matchedTopics.filter((topic) => eligibleTopics.has(topic.toLowerCase()));
    let score = Number.isFinite(Number(video.base_score)) ? Number(video.base_score) * 0.5 : 25;
    let visible = true;
    let feedbackSuppressed = false;
    let neverShowRuleMatched = false;
    const scoreContributors: string[] = [];
    const ruleSummary: string[] = [];
    const feedbackSummary: string[] = [];

    if (video.candidate_relevance === 'unmatched') {
      visible = false;
      ruleSummary.push('outside selected algorithm topics');
    }

    if (sourceFilters.subscribedOnly && video.source_kind && video.source_kind !== 'subscription') {
      visible = false;
      ruleSummary.push('subscription-only filter');
    }

    if (sourceFilters.includeDiscovery === false && video.source_kind === 'discovery') {
      visible = false;
      ruleSummary.push('discovery disabled');
    }

    if (sourceFilters.includeShorts === false && video.is_short) {
      visible = false;
      ruleSummary.push('Shorts disabled');
    }

    if (sourceFilters.includeLive === false && video.is_live) {
      visible = false;
      ruleSummary.push('live content disabled');
    }

    if (video.channel_id && blockedChannelIds.has(video.channel_id)) {
      visible = false;
      feedbackSummary.push('never_show_channel rule');
    }

    for (const topic of matchedTopics) {
      const weightValue = Number(weights.get(topic.toLowerCase()) ?? 0);
      const topicBoost = weightValue / 9;
      score += topicBoost;
      scoreContributors.push(`${topic} (${weightValue} weight)`);
    }

    const freshnessBoost = getFreshnessBoost(video.published_at);
    const subscriptionBoost = Math.max(0, Math.min(35, Number(video.subscription_affinity ?? 0)));
    const channelBoost = getChannelQualityBoost(
      video.channel_name,
      video.channel_description,
      video.channel_subscriber_count,
      matchedTopics,
    );
    score += freshnessBoost + channelBoost + subscriptionBoost;
    if (freshnessBoost > 0) {
      scoreContributors.push(`freshness (${freshnessBoost})`);
    }
    if (channelBoost !== 0) {
      scoreContributors.push(`channel fit (${channelBoost})`);
    }
    if (subscriptionBoost > 0) {
      scoreContributors.push(`subscription affinity (${subscriptionBoost})`);
    }

    for (const signal of signalMap.get(video.external_id) ?? []) {
      if (signal.eventType === 'more_like_this') {
        score += 18;
        feedbackSummary.push('more_like_this feedback (+18)');
      }

      if (signal.eventType === 'not_interested') {
        score -= 35;
        visible = false;
        feedbackSuppressed = true;
        feedbackSummary.push('not_interested feedback (-35)');
      }

      if (signal.eventType === 'never_show_channel') {
        visible = false;
        feedbackSummary.push('never_show_channel rule');
      }
    }

    for (const rule of rules) {
      const matched = ruleConditionMatches(rule, video);

      if (!matched) continue;

      if (rule.type === 'never_show') {
        neverShowRuleMatched = true;
        visible = false;
        ruleSummary.push(`never-show rule: ${rule.condition_text}`);
      }

      if (rule.type === 'always_show') {
        if (!feedbackSuppressed && !neverShowRuleMatched) {
          visible = true;
        }
        score += 20;
        ruleSummary.push(`always-show rule: ${rule.condition_text} (+20)`);
      }

      if (rule.type === 'priority') {
        score += 18;
        ruleSummary.push(`priority rule: ${rule.condition_text} (+18)`);
      }
    }

    if (hasTopicWeights && eligibleMatchedTopics.length === 0 && !ruleSummary.some((summary) => summary.startsWith('always-show rule:'))) {
      visible = false;
      ruleSummary.push('outside selected algorithm topics');
    }

    const reasonBits = [
      matchedTopics.length > 0 ? `Matched ${matchedTopics.join(', ')} topics.` : 'No strong topic match.',
      ruleSummary.length > 0 ? `Rules boosted it: ${ruleSummary.join('; ')}.` : 'No matching rule adjustments.',
      feedbackSummary.length > 0 ? `Feedback: ${feedbackSummary.join('; ')}.` : 'No explicit user feedback yet.',
      scoreContributors.length > 0 ? `Weight contributions: ${scoreContributors.join('; ')}.` : 'No weight contributions.',
    ];

    const reason = visible
      ? `Ranked because ${reasonBits.join(' ')}`
      : `Filtered because ${[...feedbackSummary, ...ruleSummary].join('; ') || 'no explicit override was matched.'}`;

    return {
      id: video.id ?? video.external_id,
      external_id: video.external_id,
      title: video.title,
      channel_name: video.channel_name,
      channel_id: video.channel_id,
      thumbnail_url: video.thumbnail_url,
      score: Math.min(100, Math.max(0, Math.round(score))),
      visible,
      reason,
      matched_topics: matchedTopics,
      source_kind: video.source_kind ?? null,
    };
  });

  const ranked = feedItems
    .filter((item) => item.visible)
    .sort((a, b) => b.score - a.score);
  const diversifiedRanked = diversifyFeedItems(ranked);
  const fallbackRanked = [...feedItems].sort((a, b) => b.score - a.score);
  const items = options.includeHidden
    ? fallbackRanked
    : diversifiedRanked.length > 0
      ? diversifiedRanked
      : hasTopicWeights
        ? []
        : fallbackRanked;

  return {
    generatedAt: new Date().toISOString(),
    algorithmId: algorithm?.id,
    items,
  };
}
