import { fetchWithRetry } from './http.ts';

export type ChannelDiscoveryCandidate = {
  topic: string;
  channelId: string;
  channelName: string;
  channelDescription: string;
  subscriberCount: number | null;
  confidence: number;
};

const MAX_TOPICS_PER_RUN = 5;
const MAX_RESULTS_PER_TOPIC = 10;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function scoreChannelCandidate(
  topic: string,
  channelName: string,
  channelDescription: string,
  subscriberCount: number | null,
): number {
  const terms = normalize(topic).split(/\s+/).filter((term) => term.length >= 3);
  const searchable = normalize(`${channelName} ${channelDescription}`);
  if (terms.length === 0 || !searchable) return 0;

  const matchedTerms = terms.filter((term) => searchable.includes(term)).length;
  const termScore = matchedTerms / terms.length;
  const qualityScore = subscriberCount && subscriberCount > 1000
    ? Math.min(0.2, Math.log10(subscriberCount) / 40)
    : 0;

  return clamp(termScore * 0.8 + qualityScore);
}

export function rankChannelCandidates(candidates: ChannelDiscoveryCandidate[]): ChannelDiscoveryCandidate[] {
  return [...candidates].sort((left, right) => right.confidence - left.confidence);
}

export async function discoverChannelCandidates(topics: string[]): Promise<ChannelDiscoveryCandidate[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return [];

  const candidates: ChannelDiscoveryCandidate[] = [];
  for (const topic of [...new Set(topics.map((value) => value.trim()).filter(Boolean))].slice(0, MAX_TOPICS_PER_RUN)) {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      type: 'channel',
      maxResults: String(MAX_RESULTS_PER_TOPIC),
      q: topic,
      key: apiKey,
    });
    const searchResponse = await fetchWithRetry(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, undefined, { maxAttempts: 2 });
    if (!searchResponse.ok) continue;

    const searchPayload = await searchResponse.json() as {
      items?: Array<{ id?: { channelId?: string }; snippet?: { channelTitle?: string; description?: string } }>;
    };
    const searchItems = (searchPayload.items ?? []).filter((item) => item.id?.channelId);
    if (searchItems.length === 0) continue;

    const channelIds = searchItems.map((item) => item.id!.channelId!);
    const channelParams = new URLSearchParams({
      part: 'snippet,statistics',
      id: channelIds.join(','),
      key: apiKey,
    });
    const channelResponse = await fetchWithRetry(`https://www.googleapis.com/youtube/v3/channels?${channelParams}`, undefined, { maxAttempts: 2 });
    if (!channelResponse.ok) continue;

    const channelPayload = await channelResponse.json() as {
      items?: Array<{ id?: string; snippet?: { title?: string; description?: string }; statistics?: { subscriberCount?: string } }>;
    };

    for (const channel of channelPayload.items ?? []) {
      if (!channel.id) continue;
      const channelName = channel.snippet?.title ?? 'Unknown channel';
      const channelDescription = channel.snippet?.description ?? '';
      const subscriberCount = channel.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : null;
      candidates.push({
        topic,
        channelId: channel.id,
        channelName,
        channelDescription,
        subscriberCount,
        confidence: scoreChannelCandidate(topic, channelName, channelDescription, subscriberCount),
      });
    }
  }

  return rankChannelCandidates(candidates);
}

export async function discoverAndQueueSeedChannels() {
  const { createSupabaseAdminClient } = await import('./supabase/server');
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, discovered: 0, error: 'Supabase admin client is not configured.' };

  const { data: concepts, error: conceptError } = await client
    .from('concept_entries')
    .select('canonical_name')
    .order('canonical_name', { ascending: true });
  if (conceptError || !concepts) {
    return { ok: false, discovered: 0, error: 'Unable to load discovery topics.' };
  }

  const candidates = await discoverChannelCandidates(concepts.map((concept) => concept.canonical_name));
  let discovered = 0;
  for (const candidate of candidates) {
    const { error } = await client.from('topic_seed_channels').upsert({
      topic: candidate.topic,
      channel_id: candidate.channelId,
      source: 'discovered_via_search',
      status: 'pending',
      confidence: candidate.confidence,
      channel_name: candidate.channelName,
      channel_description: candidate.channelDescription,
      subscriber_count: candidate.subscriberCount,
      discovered_at: new Date().toISOString(),
    }, { onConflict: 'topic,channel_id', ignoreDuplicates: true });
    if (!error) discovered += 1;
  }

  return { ok: true, discovered, candidates: candidates.length };
}
