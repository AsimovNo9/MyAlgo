import { NextResponse } from 'next/server';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { syncSeedChannelContent } from '@/lib/seed-channels';
import { runColdStartTopicDiscovery } from '@/lib/channel-discovery';
import type { Algorithm } from '@repo/shared-types';
import { getEligibleTopicNames } from '@/lib/feed';
import { activateAlgorithm } from '@/lib/data';

const MINIMUM_POOL_ITEMS = 15;

type PoolRow = { classifications?: { topics?: string[] | null } | Array<{ topics?: string[] | null }> | null };

function topicMatchesPool(row: PoolRow, topics: string[]): boolean {
  const classification = Array.isArray(row.classifications) ? row.classifications[0] : row.classifications;
  const rowTopics = (classification?.topics ?? []).map((topic) => topic.toLowerCase());
  return topics.some((topic) => rowTopics.includes(topic.toLowerCase()));
}

async function countSharedPool(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, topics: string[]) {
  if (!client) return 0;
  const { data } = await client
    .from('content_items')
    .select('classifications(topics)')
    .limit(200);
  return (data ?? []).filter((row) => topicMatchesPool(row as PoolRow, topics)).length;
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
  let poolCount = await countSharedPool(client, topics);
  if (poolCount >= MINIMUM_POOL_ITEMS) {
    return NextResponse.json({ ok: true, tier: 0, poolCount, rss: false, coldStart: false });
  }

  const rss = await syncSeedChannelContent();
  poolCount = await countSharedPool(client, topics);
  if (poolCount >= MINIMUM_POOL_ITEMS) {
    return NextResponse.json({ ok: true, tier: 1, poolCount, rss, coldStart: false });
  }

  const coldStart = await runColdStartTopicDiscovery(topics);
  const postDiscoveryRss = coldStart.approved > 0 ? await syncSeedChannelContent() : null;
  poolCount = await countSharedPool(client, topics);

  return NextResponse.json({ ok: true, tier: 2, poolCount, rss, coldStart, postDiscoveryRss });
}
