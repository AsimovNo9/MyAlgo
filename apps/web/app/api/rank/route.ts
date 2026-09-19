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
      topics: modeTopics.filter((topic) => new RegExp(`\\b${topic.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(candidate.title!)),
    }));

  const feedbackSignals = await fetchFeedbackSignalsForUser(userId);
  return NextResponse.json(buildFeedResponse(algorithm, feedbackSignals, candidates));
}