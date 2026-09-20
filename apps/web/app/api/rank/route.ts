import { NextResponse } from 'next/server';
import type { FeedSourceFilters } from '@repo/shared-types';
import { buildFeedResponse, getRankingTopicWeights, type FeedCandidate } from '@/lib/feed';
import { ensureDefaultAlgorithmsForUser } from '@/lib/bootstrap';
import { fetchFeedbackSignalsForUser } from '@/lib/feedback-signals';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { inferPageCandidateTopics } from '@/lib/page-relevance';
import { applyCorsHeaders, isAllowedOrigin } from '@/lib/cors';

type RankRequest = {
  mode?: string;
  candidates?: Array<{
    external_id?: string;
    title?: string;
    channel_name?: string | null;
    is_short?: boolean;
    is_live?: boolean;
  }>;
  sourceFilters?: FeedSourceFilters;
};

const modeTopicDefaults: Record<string, string[]> = {
  work: ['AI', 'Engineering', 'Business', 'Productivity'],
  learning: ['Tutorial', 'Engineering', 'AI', 'Science', 'Education'],
  relax: ['Entertainment', 'Nature', 'Lifestyle', 'Travel'],
  gaming: ['Gaming'],
};

function jsonResponse(request: Request, body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  applyCorsHeaders(response.headers, request.headers.get('origin'));
  return response;
}

export function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(request, { error: 'Origin is not allowed.' }, { status: 403 });
  }

  const response = new NextResponse(null, { status: 204 });
  applyCorsHeaders(response.headers, origin);
  return response;
}

function matchesRule(title: string, condition: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedCondition = condition.toLowerCase().trim();
  return normalizedCondition.length > 0 && normalizedTitle.includes(normalizedCondition);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(request, { error: 'Origin is not allowed.' }, { status: 403 });
  }

  const userId = await getCurrentUserIdFromServer();
  if (!userId) {
    return jsonResponse(request, { error: 'Authentication required.' }, { status: 401 });
  }

  const payload = (await request.json()) as RankRequest;
  const algorithms = await ensureDefaultAlgorithmsForUser(userId);
  const requestedMode = payload.mode?.trim().toLowerCase();
  const algorithm = (requestedMode
    ? algorithms.find((item) => item.name.trim().toLowerCase() === requestedMode)
    : null) ?? algorithms.find((item) => item.is_active) ?? algorithms[0] ?? null;

  const modeTopics = modeTopicDefaults[requestedMode ?? ''] ?? [];
  const algorithmTopics = algorithm ? getRankingTopicWeights(algorithm).map((item) => item.topic) : modeTopics;
  const semanticTerms = algorithm?.semantic_terms ?? [];
  const candidates: FeedCandidate[] = (payload.candidates ?? [])
    .filter((candidate) => typeof candidate.title === 'string' && candidate.title.trim().length > 0)
    .slice(0, 100)
    .map((candidate, index) => {
      const title = candidate.title!.trim();
      const topics = inferPageCandidateTopics(title, algorithmTopics, algorithm?.goal_text, semanticTerms);
      const matchingRule = algorithm?.rules?.some((rule) => matchesRule(title, rule.condition_text));
      return {
      id: candidate.external_id ?? `page-${index}`,
      external_id: candidate.external_id ?? `page-${index}`,
      title,
      channel_name: candidate.channel_name ?? null,
      is_short: candidate.is_short === true,
      is_live: candidate.is_live === true,
      published_at: new Date().toISOString(),
      base_score: 50,
      topics,
      candidate_relevance: topics.length > 0 || matchingRule ? 'matched' : 'unmatched',
    }; });

  const feedbackSignals = await fetchFeedbackSignalsForUser(userId);
  return jsonResponse(request, buildFeedResponse(algorithm, feedbackSignals, candidates, {
    includeHidden: true,
    sourceFilters: payload.sourceFilters,
  }));
}