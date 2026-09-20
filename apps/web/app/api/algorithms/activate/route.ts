import { NextResponse } from 'next/server';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { syncSeedChannelContent } from '@/lib/seed-channels';
import { runColdStartTopicDiscovery } from '@/lib/channel-discovery';
import type { Algorithm } from '@repo/shared-types';
import { getEligibleTopicNames } from '@/lib/feed';
import { summarizeActivationCoverage, type ClassifiedCandidateRow } from '@/lib/candidates';
import { activateAlgorithm } from '@/lib/data';

const MINIMUM_POOL_ITEMS_PER_TOPIC = 5;

type PoolRow = { classifications?: { topics?: string[] | null } | Array<{ topics?: string[] | null }> | null };

function topicMatchesPool(row: PoolRow, topics: string[]): boolean {
  const classification = Array.isArray(row.classifications) ? row.classifications[0] : row.classifications;
  const rowTopics = (classification?.topics ?? []).map((topic) => topic.toLowerCase());
  return topics.some((topic) => rowTopics.includes(topic.toLowerCase()));
}

async function countSharedPool(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, topics: string[]) {
  if (!client) return { poolCount: 0, topicCoverage: {}, sufficient: false };
  const { data } = await client
    .from('content_items')
    .select('classifications(topics)')
    .limit(200);
  const rows = (data ?? []) as PoolRow[];
  const matchingRows = rows.filter((row) => topicMatchesPool(row, topics));
  return summarizeActivationCoverage(matchingRows, topics, MINIMUM_POOL_ITEMS_PER_TOPIC);
}

export async function POST(request: Request) {
  const userId = await getCurrentUserIdFromServer();
  if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const payload = (await request.json()) as { algorithmId?: string };
  const client = await createSupabaseServerClient();
  if (!client) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });

  const { ensureDefaultAlgorithmsForUser } = await import('@/lib/bootstrap');
  const algorithms = await ensureDefaultAlgorithmsForUser(userId);
  const algorithm = algorithms.find((item) => item.id === payload.algorithmId) ?? algorithms.find((item) => item.is_active) ?? algorithms[0];
  if (!algorithm) return NextResponse.json({ error: 'Algorithm not found.' }, { status: 404 });
  if (!algorithm.id) return NextResponse.json({ error: 'Algorithm id is required.' }, { status: 400 });

  const activation = await activateAlgorithm(userId, algorithm.id);
  if (!activation.ok) return NextResponse.json({ error: activation.error }, { status: 500 });

  const topics = [...getEligibleTopicNames(algorithm as Algorithm)];
  let coverage = await countSharedPool(client, topics);
  if (coverage.sufficient) {
    return NextResponse.json({ ok: true, tier: 0, poolCount: coverage.poolCount, topicCoverage: coverage.topicCoverage, rss: false, coldStart: false, candidatePool: null });
  }

  const rss = await syncSeedChannelContent();
  coverage = await countSharedPool(client, topics);
  if (coverage.sufficient) {
    return NextResponse.json({ ok: true, tier: 1, poolCount: coverage.poolCount, topicCoverage: coverage.topicCoverage, rss, coldStart: false, candidatePool: rss.candidatePool ?? null });
  }

  const coldStart = await runColdStartTopicDiscovery(topics);
  const postDiscoveryRss = coldStart.approved > 0 ? await syncSeedChannelContent() : null;
  coverage = await countSharedPool(client, topics);

  return NextResponse.json({ ok: true, tier: 2, poolCount: coverage.poolCount, topicCoverage: coverage.topicCoverage, rss, coldStart, postDiscoveryRss, candidatePool: postDiscoveryRss?.candidatePool ?? rss.candidatePool ?? null });
}
