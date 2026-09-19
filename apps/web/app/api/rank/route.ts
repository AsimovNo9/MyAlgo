import { NextResponse } from 'next/server';
import { buildFeedResponse, type FeedCandidate } from '@/lib/feed';
import { ensureDefaultAlgorithmsForUser } from '@/lib/bootstrap';
import { fetchFeedbackSignalsForUser } from '@/lib/feedback-signals';
import { getCurrentUserIdFromServer } from '@/lib/server-user';

type RankRequest = {
  mode?: string;
  candidates?: Array<{
    external_id?: string;
    title?: string;
    channel_name?: string | null;
  }>;
};

const modeTopicDefaults: Record<string, string[]> = {
  work: ['AI', 'Engineering', 'Business', 'Productivity'],
  learning: ['Tutorial', 'Engineering', 'AI', 'Science', 'Education'],
  relax: ['Entertainment', 'Nature', 'Lifestyle', 'Travel'],
};

const topicAliases: Record<string, RegExp> = {
  gaming: /\b(game|gaming|gameplay|walkthrough|speedrun|esports|rpg|fps|xbox|playstation|nintendo|steam)\b/i,
  sports: /\b(sport|sports|football|soccer|basketball|tennis|nba|nfl|formula 1|f1)\b/i,
  travel: /\b(travel|trip|vacation|tourism|destination|flight|hotel)\b/i,
  nature: /\b(nature|wildlife|animals|landscape|ocean|forest|climate)\b/i,
  science: /\b(science|physics|biology|chemistry|space|astronomy)\b/i,
};

function inferCandidateTopics(title: string, algorithmTopics: string[]): string[] {
  return algorithmTopics.filter((topic) => {
    const normalizedTopic = topic.trim().toLowerCase();
    const pattern = topicAliases[normalizedTopic] ?? new RegExp(`\\b${normalizedTopic.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
    return pattern.test(title);
  });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserIdFromServer();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const payload = (await request.json()) as RankRequest;
  const algorithms = await ensureDefaultAlgorithmsForUser(userId);
  const requestedMode = payload.mode?.trim().toLowerCase();
  const algorithm = (requestedMode
    ? algorithms.find((item) => item.name.trim().toLowerCase() === requestedMode)
    : null) ?? algorithms.find((item) => item.is_active) ?? algorithms[0] ?? null;

  const modeTopics = modeTopicDefaults[requestedMode ?? ''] ?? [];
  const algorithmTopics = algorithm?.topic_weights?.map((item) => item.topic) ?? modeTopics;
  const candidates: FeedCandidate[] = (payload.candidates ?? [])
    .filter((candidate) => typeof candidate.title === 'string' && candidate.title.trim().length > 0)
    .slice(0, 100)
    .map((candidate, index) => ({
      id: candidate.external_id ?? `page-${index}`,
      external_id: candidate.external_id ?? `page-${index}`,
      title: candidate.title!.trim(),
      channel_name: candidate.channel_name ?? null,
      published_at: new Date().toISOString(),
      base_score: 50,
      topics: inferCandidateTopics(candidate.title!, algorithmTopics),
    }));

  const feedbackSignals = await fetchFeedbackSignalsForUser(userId);
  return NextResponse.json(buildFeedResponse(algorithm, feedbackSignals, candidates));
}