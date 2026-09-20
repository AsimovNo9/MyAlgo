import { fetchChannelRssItems } from './rss.ts';
import { buildCandidateRawMetadata, normalizeRssCandidate } from './candidates.ts';
import { assembleCandidatePool } from './candidate-generation.ts';
import { loadConceptCatalog } from './semantic-catalog.ts';
import { buildContentConceptMatches, persistContentConceptMatches } from './content-concepts.ts';
import { buildRecommendationQualityMetrics } from './recommendation-quality.ts';

export type SeedChannelRow = { topic: string; channel_id: string; status?: 'pending' | 'approved' | 'rejected' };

const MAX_CHANNELS_PER_SYNC = 25;
const MAX_ITEMS_PER_CHANNEL = 5;

// Groups seed-channel rows by channel so a channel mapped to multiple topics is only
// fetched once per sync, while every topic it was curated for is still tagged.
export function groupSeedChannelsByChannel(rows: SeedChannelRow[]): Array<{ channelId: string; topics: string[] }> {
  const byChannel = new Map<string, Set<string>>();

  for (const row of rows) {
    const channelId = row.channel_id?.trim();
    const topic = row.topic?.trim();
    if (!channelId || !topic) {
      continue;
    }

    const topics = byChannel.get(channelId) ?? new Set<string>();
    topics.add(topic);
    byChannel.set(channelId, topics);
  }

  return [...byChannel.entries()].map(([channelId, topics]) => ({ channelId, topics: [...topics] }));
}

// A seed channel is manually vetted for its topic, so that topic is guaranteed on the
// classification regardless of what the title-based classifier independently detects.
export function buildSeedClassificationTopics(seedTopics: string[], detectedTopics: string[]): string[] {
  return [...new Set([...seedTopics, ...detectedTopics])];
}

export async function syncSeedChannelContent() {
  const { createSupabaseServerClient } = await import('./supabase/server');
  const { classifyContent } = await import('./classifier');

  const client = await createSupabaseServerClient();
  if (!client) {
    return { ok: false, channels: 0, synced: 0, classified: 0, error: 'Supabase is not configured.' };
  }

  const conceptCatalog = await loadConceptCatalog(client);

  const { data: seedRows, error: seedError } = await client
    .from('topic_seed_channels')
    .select('topic, channel_id')
    .eq('status', 'approved')
    .limit(500);

  if (seedError || !seedRows) {
    console.error('Failed to load topic seed channels', seedError);
    return { ok: false, channels: 0, synced: 0, classified: 0, error: 'Unable to load seed channels.' };
  }

  const channels = groupSeedChannelsByChannel(seedRows).slice(0, MAX_CHANNELS_PER_SYNC);
  let synced = 0;
  let classified = 0;
  const rssCandidates = [];

  for (const { channelId, topics } of channels) {
    const items = (await fetchChannelRssItems(channelId)).slice(0, MAX_ITEMS_PER_CHANNEL);

    for (const item of items) {
      const candidate = normalizeRssCandidate(item, channelId);
      rssCandidates.push({ ...candidate, topics });
      const { data: contentRow, error: upsertError } = await client
        .from('content_items')
        .upsert(
          {
            source: 'youtube',
            external_id: candidate.external_id,
            title: candidate.title,
            channel_name: candidate.channel_name,
            channel_id: channelId,
            source_kind: 'discovery',
            published_at: candidate.published_at ? new Date(candidate.published_at) : new Date(),
            raw_metadata: buildCandidateRawMetadata(candidate),
          },
          { onConflict: 'source,external_id' },
        )
        .select('id')
        .single();

      if (upsertError || !contentRow) {
        console.error('Failed to upsert seed-channel content item', upsertError);
        continue;
      }

      synced += 1;

      const { data: existingClassification } = await client
        .from('classifications')
        .select('id')
        .eq('content_item_id', contentRow.id)
        .maybeSingle();

      if (existingClassification) {
        continue;
      }

      const detected = await classifyContent(`${candidate.title} ${candidate.description ?? ''} ${candidate.channel_name}`, conceptCatalog);
      const { error: classificationError } = await client.from('classifications').upsert(
        {
          content_item_id: contentRow.id,
          topics: buildSeedClassificationTopics(topics, detected.topics),
          content_type: detected.content_type,
          language: detected.language,
          format: detected.format,
          confidence: detected.confidence,
          quality_score: detected.quality_score,
          reasoning: detected.reasoning,
        },
        { onConflict: 'content_item_id' },
      );

      if (!classificationError) {
        await persistContentConceptMatches(
          client,
          buildContentConceptMatches(contentRow.id, detected.topics, conceptCatalog, detected.confidence),
        );
        classified += 1;
      }
    }
  }

  const candidatePool = assembleCandidatePool([
    { source: 'youtube_rss', items: rssCandidates },
  ], [...new Set(seedRows.map((row) => row.topic))]);
  const freshnessCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const freshCount = rssCandidates.filter((item) => item.published_at && new Date(item.published_at).getTime() >= freshnessCutoff).length;

  return {
    ok: true,
    channels: channels.length,
    synced,
    classified,
    candidatePool: candidatePool.metrics,
    quality: buildRecommendationQualityMetrics(candidatePool.metrics, classified, freshCount),
  };
}
