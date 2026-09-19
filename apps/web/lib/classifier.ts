export type ClassificationResult = {
  topics: string[];
  content_type: string;
  quality_score: number;
  reasoning: string;
};

const topicRules: Array<{ match: RegExp; topic: string }> = [
  { match: /\b(ai|llm|gpt|agent|machine learning|computer vision|vision model|automation|prompt)\b/i, topic: 'AI' },
  { match: /(productivity|deep work|workflow|focus|systems|habits)/i, topic: 'Productivity' },
  { match: /(engineering|software|code|architecture|systems|build)/i, topic: 'Engineering' },
  { match: /(startup|business|strategy|marketing|founder|product)/i, topic: 'Business' },
  { match: /(tutorial|how to|guide|walkthrough|lesson|demo|lecture|course|university|explainer)/i, topic: 'Tutorial' },
  { match: /(celebrity|gossip|entertainment|movie|music|tv|drama)/i, topic: 'Entertainment' },
];

export async function classifyContent(title: string): Promise<ClassificationResult> {
  const normalizedTitle = title.trim();
  const matchedTopics = Array.from(
    new Set(
      topicRules
        .filter(({ match }) => match.test(normalizedTitle))
        .map(({ topic }) => topic),
    ),
  );

  const fallbackTopic = 'General';
  const topics = matchedTopics.length > 0 ? matchedTopics : [fallbackTopic];

  const contentType =
    matchedTopics.includes('Tutorial') || /how to|tutorial|guide|walkthrough|demo/i.test(normalizedTitle)
      ? 'tutorial'
      : matchedTopics.includes('Entertainment')
        ? 'entertainment'
        : matchedTopics.includes('Business')
          ? 'business'
          : 'general';

  const qualityScore = Math.min(
    98,
    Math.max(65, 72 + matchedTopics.length * 6 + (normalizedTitle.length > 40 ? 8 : 0)),
  );

  return {
    topics,
    content_type: contentType,
    quality_score: Math.round(qualityScore),
    reasoning: matchedTopics.length
      ? `Matched ${matchedTopics.join(', ')} based on the title's subject signals.`
      : 'No strong topic match; treated as general content.',
  };
}
