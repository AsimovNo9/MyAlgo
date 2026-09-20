import { fetchWithRetry } from './http.ts';
import type { ConceptCatalogEntry } from './concepts.ts';

export type ClassificationResult = {
  topics: string[];
  content_type: string;
  language: string | null;
  format: string | null;
  confidence: number;
  quality_score: number;
  reasoning: string;
};

const topicRules: Array<{ match: RegExp; topic: string }> = [
  { match: /\b(ai|llm|gpt|agent|machine learning|computer vision|vision model|automation|prompt)\b/i, topic: 'AI' },
  { match: /(productivity|deep work|workflow|focus|systems|habits)/i, topic: 'Productivity' },
  { match: /(engineering|software|code|architecture|systems|build)/i, topic: 'Engineering' },
  { match: /(startup|business|strategy|marketing|founder|product)/i, topic: 'Business' },
  { match: /(tutorial|how to|guide|walkthrough|lesson|demo|lecture|course|university|explainer)/i, topic: 'Tutorial' },
  { match: /(game|gaming|gameplay|playthrough|speedrun|esports|rpg|fps|boss fight|xbox|playstation|nintendo|steam|minecraft|fortnite|valorant|elden ring)/i, topic: 'Gaming' },
  { match: /(celebrity|gossip|entertainment|movie|music|tv|drama)/i, topic: 'Entertainment' },
];

function classifyDeterministically(title: string, catalog: ConceptCatalogEntry[] = []): ClassificationResult {
  const normalizedTitle = title.trim();
  const matchedTopics = Array.from(
    new Set(
      topicRules
        .filter(({ match }) => match.test(normalizedTitle))
        .map(({ topic }) => topic),
    ),
  );

  for (const concept of catalog) {
    const terms = [
      concept.canonicalName,
      ...concept.aliases,
      ...concept.intents,
      ...(concept.entities ?? []),
      ...(concept.positivePhrases ?? []),
    ];
    if (terms.some((term) => matchesWholePhrase(normalizedTitle, term))) {
      matchedTopics.push(concept.canonicalName);
    }
  }

  const uniqueTopics = [...new Set(matchedTopics)];

  const fallbackTopic = 'General';
  const topics = uniqueTopics.length > 0 ? uniqueTopics : [fallbackTopic];

  const contentType =
    uniqueTopics.includes('Tutorial') || /how to|tutorial|guide|walkthrough|demo/i.test(normalizedTitle)
      ? 'tutorial'
      : uniqueTopics.includes('Entertainment')
        ? 'entertainment'
        : uniqueTopics.includes('Business')
          ? 'business'
          : 'general';
  const format = uniqueTopics.includes('Tutorial')
    ? 'tutorial'
    : /review|recap|first look/i.test(normalizedTitle)
      ? 'review'
      : /analysis|deep dive|breakdown|explained/i.test(normalizedTitle)
        ? 'deep analysis'
        : /interview|commentary/i.test(normalizedTitle)
          ? 'developer commentary'
          : null;
  const language = /[\u3040-\u30ff]/.test(normalizedTitle)
    ? 'ja'
    : /[\uac00-\ud7af]/.test(normalizedTitle)
      ? 'ko'
      : /[\u4e00-\u9fff]/.test(normalizedTitle)
        ? 'zh'
        : /[\u0400-\u04ff]/.test(normalizedTitle)
          ? 'ru'
          : null;

  const qualityScore = Math.min(
    98,
    Math.max(65, 72 + uniqueTopics.length * 6 + (normalizedTitle.length > 40 ? 8 : 0)),
  );

  return {
    topics,
    content_type: contentType,
    language,
    format,
    confidence: uniqueTopics.length > 0 ? 0.82 : 0.2,
    quality_score: Math.round(qualityScore),
    reasoning: uniqueTopics.length
      ? `Matched ${uniqueTopics.join(', ')} based on the title's subject signals.`
      : 'No strong topic match; treated as general content.',
  };
}

function matchesWholePhrase(value: string, term: string): boolean {
  const normalizedTerm = term.trim().replace(/\s+/g, ' ');
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(value);
}

function parseAiClassification(payload: unknown): ClassificationResult | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as {
    topics?: unknown;
    content_type?: unknown;
    language?: unknown;
    format?: unknown;
    confidence?: unknown;
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
    language: typeof candidate.language === 'string' && /^[a-z]{2}$/i.test(candidate.language.trim())
      ? candidate.language.trim().toLowerCase()
      : null,
    format: typeof candidate.format === 'string' && candidate.format.trim().length > 0
      ? candidate.format.trim().toLowerCase()
      : null,
    confidence: Number.isFinite(Number(candidate.confidence))
      ? Math.min(1, Math.max(0, Number(candidate.confidence)))
      : 0.7,
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

async function classifyWithAnthropic(title: string, semanticContext: string[] = []): Promise<ClassificationResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || apiKey === 'your-anthropic-key') {
    return null;
  }

  try {
    const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
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
        system: `Classify content conservatively against this approved semantic context when relevant: ${semanticContext.slice(0, 8).join('; ') || 'none'}. Return only JSON with topics (array of short strings), content_type, language (two-letter code or null), format (short format label or null), confidence from 0 to 1, quality_score from 0 to 100, and reasoning. Do not invent concepts outside the context unless the title clearly requires it.`,
        messages: [{
          role: 'user',
          content: `Classify this content:\n${title.slice(0, 500)}`,
        }],
      }),
    }, { timeoutMs: 4000 });

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

export async function classifyContent(
  title: string,
  catalog: ConceptCatalogEntry[] = [],
  metadata: { language?: string | null } = {},
): Promise<ClassificationResult> {
  const deterministic = classifyDeterministically(title, catalog);
  const languageHint = metadata.language?.trim().toLowerCase().match(/^[a-z]{2}/)?.[0] ?? null;
  if (!deterministic.language && languageHint) {
    deterministic.language = languageHint;
  }
  if (deterministic.confidence >= 0.7) {
    return deterministic;
  }

  const semanticContext = catalog.slice(0, 12).flatMap((concept) => [concept.canonicalName, ...concept.intents]).filter(Boolean);
  return (await classifyWithAnthropic(title, semanticContext)) ?? deterministic;
}
