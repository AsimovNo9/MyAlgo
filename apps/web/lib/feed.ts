import type { Algorithm, FeedItem, FeedResponse, Rule } from '@repo/shared-types';

export type FeedFeedbackSignal = {
  external_id: string;
  eventType: 'not_interested' | 'more_like_this' | 'never_show_channel';
};

const baseVideos = [
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

function getRuleMatches(rule: Rule, title: string) {
  return rule.condition_text.toLowerCase().includes(title.toLowerCase()) || title.toLowerCase().includes(rule.condition_text.toLowerCase());
}

export function buildFeedResponse(
  algorithm?: Algorithm | null,
  feedbackSignals: FeedFeedbackSignal[] = [],
): FeedResponse {
  const weights = new Map((algorithm?.topic_weights ?? []).map((item) => [item.topic.toLowerCase(), item.weight]));
  const rules = algorithm?.rules ?? [];
  const signalMap = new Map<string, FeedFeedbackSignal[]>();

  for (const signal of feedbackSignals) {
    const existing = signalMap.get(signal.external_id) ?? [];
    existing.push(signal);
    signalMap.set(signal.external_id, existing);
  }

  const feedItems: FeedItem[] = baseVideos.map((video) => {
    const matchedTopics = video.topics.filter((topic) => weights.has(topic.toLowerCase()));
    let score = video.base_score;
    let visible = true;

    for (const topic of matchedTopics) {
      score += Number(weights.get(topic.toLowerCase()) ?? 0) / 3;
    }

    for (const signal of signalMap.get(video.external_id) ?? []) {
      if (signal.eventType === 'more_like_this') {
        score += 18;
      }

      if (signal.eventType === 'not_interested') {
        score -= 35;
        visible = false;
      }

      if (signal.eventType === 'never_show_channel') {
        visible = false;
      }
    }

    for (const rule of rules) {
      const matched = getRuleMatches(rule, video.title);

      if (!matched) continue;

      if (rule.type === 'never_show') {
        visible = false;
      }

      if (rule.type === 'always_show') {
        score += 20;
      }

      if (rule.type === 'priority') {
        score += 18;
      }
    }

    return {
      id: video.id,
      external_id: video.external_id,
      title: video.title,
      channel_name: video.channel_name,
      score: Math.min(100, Math.max(0, Math.round(score))),
      visible,
      reason: visible
        ? 'Matched user weighting, feedback, and rules.'
        : 'Filtered by a user feedback or never-show rule.',
      matched_topics: matchedTopics,
    };
  });

  const ranked = feedItems
    .filter((item) => item.visible)
    .sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    algorithmId: algorithm?.id,
    items: ranked.length > 0 ? ranked : feedItems,
  };
}
