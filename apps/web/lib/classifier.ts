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

function classifyDeterministically(title: string): ClassificationResult {
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

function parseAiClassification(payload: unknown): ClassificationResult | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as {
    topics?: unknown;
    content_type?: unknown;
    quality_score?: unknown;
    reasoning?: unknown;
  };
  const topics = Array.isArray(candidate.topics)
    ? [...new Set(candidate.topics.filter((topic): topic is string => typeof topic === 'string' && topic.trim().length > 0).map((topic) => topic.trim()))]
    : [];
  const qualityScore = Number(candidate.quality_score);

  if (topics.length === 0 || !Number.isFinite(qualityScore)) {
    return null;
  }

  return {
    topics,
    content_type: typeof candidate.content_type === 'string' && candidate.content_type.trim().length > 0
      ? candidate.content_type.trim()
      : 'general',
    quality_score: Math.round(Math.min(100, Math.max(0, qualityScore))),
    reasoning: typeof candidate.reasoning === 'string' && candidate.reasoning.trim().length > 0
      ? candidate.reasoning.trim()
      : 'Semantic classification provided by the configured model.',
  };
}

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function classifyWithAnthropic(title: string): Promise<ClassificationResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || apiKey === 'your-anthropic-key') {
    return null;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 180,
        temperature: 0,
        system: 'Classify content conservatively. Return only JSON with topics (array of short strings), content_type, quality_score from 0 to 100, and reasoning.',
        messages: [{
          role: 'user',
          content: `Classify this title:\n${title.slice(0, 500)}`,
        }],
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json() as { content?: Array<{ text?: string }> };
    const text = body.content?.find((item) => typeof item.text === 'string')?.text;
    return text ? parseAiClassification(text) : null;
  } catch {
    return null;
  }
}

export async function classifyContent(title: string): Promise<ClassificationResult> {
  const deterministic = classifyDeterministically(title);
  if (deterministic.topics.length > 0 && deterministic.topics[0] !== 'General') {
    return deterministic;
  }

  return (await classifyWithAnthropic(title)) ?? deterministic;
}
