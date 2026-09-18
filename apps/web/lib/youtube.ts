export type YoutubeSubscriptionItem = {
  id: string;
  title: string;
  channel_name: string;
  external_id: string;
  published_at?: string;
  topics?: string[];
};

const fixtureItems: YoutubeSubscriptionItem[] = [
  {
    id: 'yt-1',
    title: 'AI agents workflow demo',
    channel_name: 'Build with AI',
    external_id: 'yt-1',
    published_at: new Date().toISOString(),
    topics: ['AI', 'Tutorial', 'Productivity'],
  },
  {
    id: 'yt-2',
    title: 'Deep work systems for founders',
    channel_name: 'Focus Daily',
    external_id: 'yt-2',
    published_at: new Date().toISOString(),
    topics: ['Productivity', 'Business'],
  },
  {
    id: 'yt-3',
    title: 'Celebrity gossip weekly recap',
    channel_name: 'Tabloid Hour',
    external_id: 'yt-3',
    published_at: new Date().toISOString(),
    topics: ['Entertainment'],
  },
  {
    id: 'yt-4',
    title: 'Engineering breakdown: AI browsing agents',
    channel_name: 'Systems Lab',
    external_id: 'yt-4',
    published_at: new Date().toISOString(),
    topics: ['Engineering', 'AI', 'Tutorial'],
  },
];

export function mapYoutubeSubscriptionItems(rawItems: unknown[]): YoutubeSubscriptionItem[] {
  const items = Array.isArray(rawItems) ? rawItems : [];

  const mapped: YoutubeSubscriptionItem[] = [];

  for (const item of items) {
    const record = item as {
      id?: { videoId?: string; channelId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        publishedAt?: string;
        resourceId?: { channelId?: string };
        thumbnails?: Record<string, unknown>;
      };
    };

    const channelId = record?.snippet?.resourceId?.channelId ?? record?.id?.channelId ?? record?.snippet?.channelTitle ?? 'unknown-channel';
    const title = record?.snippet?.title ?? 'Untitled subscription';
    const channelName = record?.snippet?.channelTitle ?? 'Unknown channel';
    const externalId = record?.snippet?.resourceId?.channelId ?? record?.id?.channelId ?? channelId;
    const publishedAt = record?.snippet?.publishedAt ?? new Date().toISOString();

    if (!externalId || !title) {
      continue;
    }

    mapped.push({
      id: externalId,
      title,
      channel_name: channelName,
      external_id: externalId,
      published_at: publishedAt,
      topics: [],
    });
  }

  return mapped;
}

export async function syncYoutubeSubscriptionsForUser(userId: string) {
  const { createSupabaseServerClient } = await import('./supabase/server');
  const { classifyContent } = await import('./classifier');

  const result = await fetchYoutubeSubscriptionFeed(userId);
  const client = await createSupabaseServerClient();

  if (!client || result.source === 'fixture') {
    return { ok: true, source: result.source, synced: 0, classified: 0, items: result.items };
  }

  let synced = 0;
  let classified = 0;

  for (const item of result.items) {
    const { data: contentRow, error: upsertError } = await client
      .from('content_items')
      .upsert(
        {
          source: 'youtube',
          external_id: item.external_id,
          title: item.title,
          channel_name: item.channel_name,
          published_at: item.published_at ? new Date(item.published_at) : new Date(),
        },
        { onConflict: 'source,external_id' },
      )
      .select('id')
      .single();

    if (upsertError || !contentRow) {
      console.error('Failed to upsert content item', upsertError);
      continue;
    }

    synced += 1;

    const classification = await classifyContent(item.title);
    const { error: classificationError } = await client.from('classifications').upsert(
      {
        content_item_id: contentRow.id,
        topics: classification.topics,
        content_type: classification.content_type,
        quality_score: classification.quality_score,
        reasoning: classification.reasoning,
      },
      { onConflict: 'content_item_id' },
    );

    if (!classificationError) {
      classified += 1;
    }
  }

  return {
    ok: true,
    source: result.source,
    synced,
    classified,
    items: result.items,
  };
}

export async function fetchYoutubeSubscriptionFeed(userId?: string): Promise<{ items: YoutubeSubscriptionItem[]; source: string }> {
  if (!userId) {
    return { source: 'fixture', items: fixtureItems };
  }

  const { createSupabaseServerClient } = await import('./supabase/server');
  const client = await createSupabaseServerClient();
  if (!client) {
    return { source: 'fixture', items: fixtureItems };
  }

  const { data, error } = await client
    .from('oauth_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'youtube')
    .maybeSingle();

  if (error || !data?.access_token_encrypted) {
    return { source: 'fixture', items: fixtureItems };
  }

  try {
    const response = await fetch('https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=25', {
      headers: {
        Authorization: `Bearer ${data.access_token_encrypted}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return { source: 'fixture', items: fixtureItems };
    }

    const payload = (await response.json()) as { items?: unknown[] };
    const items = mapYoutubeSubscriptionItems(payload.items ?? []);

    return {
      source: items.length > 0 ? 'youtube_api' : 'fixture',
      items: items.length > 0 ? items : fixtureItems,
    };
  } catch {
    return { source: 'fixture', items: fixtureItems };
  }
}
