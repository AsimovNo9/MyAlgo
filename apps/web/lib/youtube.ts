import type { Algorithm } from '@repo/shared-types';
import { extractGoogleProviderTokens } from './auth.ts';
import { buildDiscoveryQueries, discoveryLimits } from './discovery';

export type YoutubeSubscriptionItem = {
  id: string;
  title: string;
  channel_name: string;
  channel_id?: string | null;
  channel_description?: string | null;
  channel_subscriber_count?: number | null;
  description?: string | null;
  external_id: string;
  published_at?: string;
  topics?: string[];
  source_kind?: 'subscription' | 'discovery';
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

    const channelId = record?.snippet?.resourceId?.channelId ?? record?.id?.channelId ?? null;
    const title = record?.snippet?.title ?? record?.snippet?.channelTitle ?? 'Untitled subscription';
    const channelName = record?.snippet?.channelTitle ?? record?.snippet?.title ?? 'Unknown channel';
    const externalId = channelId ?? title;
    const publishedAt = record?.snippet?.publishedAt ?? new Date().toISOString();

    if (!externalId || !title) {
      continue;
    }

    mapped.push({
      id: externalId,
      title,
      channel_name: channelName,
      channel_id: channelId,
      external_id: externalId,
      published_at: publishedAt,
      topics: [],
    });
  }

  return mapped;
}

type YoutubeChannelMetadata = {
  channel_name: string;
  channel_description: string | null;
  channel_subscriber_count: number | null;
  uploads_playlist_id: string | null;
};

async function fetchYoutubeChannelMetadata(userId: string, channelIds: string[]) {
  const uniqueChannelIds = [...new Set(channelIds.filter(Boolean))];
  if (uniqueChannelIds.length === 0) {
    return new Map<string, YoutubeChannelMetadata>();
  }

  const { createSupabaseServerClient } = await import('./supabase/server');
  const client = await createSupabaseServerClient();
  if (!client) {
    return new Map<string, YoutubeChannelMetadata>();
  }

  const accessToken = await getValidYoutubeAccessToken(userId);
  if (!accessToken) {
    return new Map<string, YoutubeChannelMetadata>();
  }

  const metadataByChannelId = new Map<string, YoutubeChannelMetadata>();

  for (let index = 0; index < uniqueChannelIds.length; index += 50) {
    const chunk = uniqueChannelIds.slice(index, index + 50);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(chunk.join(','))}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch YouTube channel metadata', response.status, await response.text());
      continue;
    }

    const payload = (await response.json()) as { items?: Array<{ id?: string; snippet?: { title?: string; description?: string }; statistics?: { subscriberCount?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }> };

    for (const channel of payload.items ?? []) {
      if (!channel.id) {
        continue;
      }

      metadataByChannelId.set(channel.id, {
        channel_name: channel.snippet?.title ?? 'Unknown channel',
        channel_description: channel.snippet?.description ?? null,
        channel_subscriber_count: channel.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : null,
        uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
      });
    }
  }

  return metadataByChannelId;
}

async function fetchYoutubeRecentUploads(
  accessToken: string,
  metadataByChannelId: Map<string, YoutubeChannelMetadata>,
): Promise<YoutubeSubscriptionItem[]> {
  const uploads: YoutubeSubscriptionItem[] = [];

  for (const [channelId, metadata] of metadataByChannelId) {
    if (!metadata.uploads_playlist_id) {
      continue;
    }

    const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(metadata.uploads_playlist_id)}&maxResults=3`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch YouTube channel uploads', channelId, response.status, await response.text());
      continue;
    }

    const payload = (await response.json()) as {
      items?: Array<{
        snippet?: { title?: string; publishedAt?: string };
        contentDetails?: { videoId?: string };
      }>;
    };

    for (const video of payload.items ?? []) {
      const videoId = video.contentDetails?.videoId;
      const title = video.snippet?.title;
      if (!videoId || !title) {
        continue;
      }

      uploads.push({
        id: videoId,
        title,
        channel_name: metadata.channel_name,
        channel_id: channelId,
        channel_description: metadata.channel_description,
        channel_subscriber_count: metadata.channel_subscriber_count,
        external_id: videoId,
        published_at: video.snippet?.publishedAt ?? new Date().toISOString(),
        topics: [],
      });
    }
  }

  return uploads;
}

async function fetchYoutubeDiscoveryItems(accessToken: string, algorithm?: Algorithm | null): Promise<YoutubeSubscriptionItem[]> {
  const discoveryItems: YoutubeSubscriptionItem[] = [];

  for (const query of buildDiscoveryQueries(algorithm)) {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: String(discoveryLimits.maxResultsPerQuery),
      order: 'date',
      q: query,
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error('Failed to fetch YouTube discovery results', response.status, await response.text());
      continue;
    }

    const payload = (await response.json()) as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string; channelId?: string; channelTitle?: string; publishedAt?: string } }>;
    };

    for (const item of payload.items ?? []) {
      const videoId = item.id?.videoId;
      const title = item.snippet?.title;
      if (!videoId || !title) continue;

      discoveryItems.push({
        id: videoId,
        external_id: videoId,
        title,
        description: item.snippet?.description ?? null,
        channel_name: item.snippet?.channelTitle ?? 'Unknown channel',
        channel_id: item.snippet?.channelId ?? null,
        published_at: item.snippet?.publishedAt ?? new Date().toISOString(),
        topics: [],
        source_kind: 'discovery',
      });
    }
  }

  return [...new Map(discoveryItems.map((item) => [item.external_id, item])).values()];
}

async function getValidYoutubeAccessToken(userId: string): Promise<string | null> {
  const { createSupabaseServerClient } = await import('./supabase/server');
  const client = await createSupabaseServerClient();

  if (!client) {
    return null;
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const providerTokens = extractGoogleProviderTokens(sessionData.session);
  const providerToken = providerTokens.accessToken;
  const providerRefreshToken = providerTokens.refreshToken;

  console.log('YouTube provider session state', {
    userId,
    tokenSource: providerTokens.source,
    hasProviderToken: !!providerToken,
    hasProviderRefreshToken: !!providerRefreshToken,
    sessionError: sessionError?.message ?? null,
  });

  if (providerToken) {
    return providerToken;
  }

  const { data, error } = await client
    .from('oauth_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'youtube')
    .maybeSingle();

  if (error || !data) {
    console.log('No stored YouTube OAuth row for user', { userId, error });
    return null;
  }

  const accessToken = data.access_token_encrypted;
  const refreshToken = data.refresh_token_encrypted;
  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;

  console.log('YouTube token check', {
    userId,
    hasAccessToken: !!accessToken,
    hasRefreshToken: !!refreshToken,
    expiresAt,
    expiredSoon: expiresAt <= Date.now() + 60 * 1000,
  });

  if (accessToken && expiresAt > Date.now() + 60 * 1000) {
    return accessToken;
  }

  if (!refreshToken || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return null;
  }

  try {
    const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!refreshResponse.ok) {
      console.error('Failed to refresh YouTube OAuth token', await refreshResponse.text());
      return null;
    }

    const payload = (await refreshResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      return null;
    }

    const nextExpiresAt = new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString();

    const { error: updateError } = await client
      .from('oauth_connections')
      .update({
        access_token_encrypted: payload.access_token,
        refresh_token_encrypted: payload.refresh_token ?? refreshToken,
        expires_at: nextExpiresAt,
      })
      .eq('user_id', userId)
      .eq('provider', 'youtube');

    if (updateError) {
      console.error('Failed to persist refreshed YouTube token', updateError);
    }

    return payload.access_token;
  } catch (error) {
    console.error('Error refreshing YouTube access token', error);
    return null;
  }
}

export async function syncYoutubeSubscriptionsForUser(userId: string) {
  const { createSupabaseServerClient } = await import('./supabase/server');
  const { classifyContent } = await import('./classifier');
  const { listAlgorithms } = await import('./data');

  const result = await fetchYoutubeSubscriptionFeed(userId);
  const client = await createSupabaseServerClient();

  if (!client || (result.source !== 'youtube_api' && result.source !== 'youtube_api_empty')) {
    const reason =
      result.source === 'unauthenticated'
        ? 'Authentication required.'
        : result.source === 'missing_youtube_token'
          ? 'Google YouTube access is not available for this user.'
          : result.source === 'youtube_api_error' || result.source === 'youtube_fetch_error'
            ? 'The YouTube API request failed.'
            : 'No live YouTube subscriptions were available to sync.';

    return { ok: false, source: result.source, synced: 0, discovered: 0, classified: 0, items: [], error: reason };
  }

  const algorithms = await listAlgorithms(userId);
  const activeAlgorithm = algorithms.find((algorithm) => algorithm.is_active) ?? algorithms[0] ?? null;
  const accessToken = await getValidYoutubeAccessToken(userId);
  const discoveryItems = accessToken ? await fetchYoutubeDiscoveryItems(accessToken, activeAlgorithm) : [];
  const items = [...result.items, ...discoveryItems];

  let synced = 0;
  let classified = 0;

  const channelMetadata = await fetchYoutubeChannelMetadata(userId, items.map((item) => item.channel_id ?? '').filter(Boolean));

  for (const item of items) {
    const channelMeta = item.channel_id ? channelMetadata.get(item.channel_id) : undefined;
    const channelName = channelMeta?.channel_name ?? item.channel_name ?? 'Unknown channel';
    const channelDescription = channelMeta?.channel_description ?? null;
    const channelSubscriberCount = channelMeta?.channel_subscriber_count ?? null;

    const { data: contentRow, error: upsertError } = await client
      .from('content_items')
      .upsert(
        {
          source: 'youtube',
          external_id: item.external_id,
          title: item.title,
          channel_name: channelName,
          channel_id: item.channel_id ?? null,
          channel_description: channelDescription,
          channel_subscriber_count: channelSubscriberCount,
          source_kind: item.source_kind ?? 'subscription',
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

    const classification = await classifyContent(`${item.title} ${item.description ?? ''} ${item.channel_name ?? ''}`);
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
    discovered: discoveryItems.length,
    classified,
    items,
  };
}

export async function fetchYoutubeSubscriptionFeed(userId?: string): Promise<{ items: YoutubeSubscriptionItem[]; source: string }> {
  if (!userId) {
    return { source: 'unauthenticated', items: [] };
  }

  const { createSupabaseServerClient } = await import('./supabase/server');
  const client = await createSupabaseServerClient();
  if (!client) {
    return { source: 'supabase_unavailable', items: [] };
  }

  const accessToken = await getValidYoutubeAccessToken(userId);
  if (!accessToken) {
    return { source: 'missing_youtube_token', items: [] };
  }

  try {
    const response = await fetch('https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=25', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('YouTube subscriptions API rejected the token', {
        status: response.status,
        statusText: response.statusText,
        body,
      });

      return {
        source: response.status === 403 ? 'youtube_api_forbidden' : 'youtube_api_error',
        items: [],
      };
    }

    const payload = (await response.json()) as { items?: unknown[]; pageInfo?: { totalResults?: number }; error?: { code?: number; message?: string } };
    const rawItems = payload.items ?? [];
    const items = mapYoutubeSubscriptionItems(rawItems);
    const channelMetadata = await fetchYoutubeChannelMetadata(userId, items.map((item) => item.channel_id ?? '').filter(Boolean));
    const recentUploads = await fetchYoutubeRecentUploads(accessToken, channelMetadata);

    const enrichedSubscriptions = items.map((item) => {
      const channelMeta = item.channel_id ? channelMetadata.get(item.channel_id) : undefined;
      return {
        ...item,
        channel_name: channelMeta?.channel_name ?? item.channel_name,
        channel_description: channelMeta?.channel_description ?? null,
        channel_subscriber_count: channelMeta?.channel_subscriber_count ?? null,
      };
    });
    const enrichedItems = recentUploads.length > 0 ? recentUploads : enrichedSubscriptions;

    console.log('YouTube subscriptions payload debug', {
      userId,
      totalResults: payload.pageInfo?.totalResults ?? rawItems.length,
      returnedItems: rawItems.length,
      mappedItems: items.length,
      recentUploads: recentUploads.length,
      sampleIds: rawItems.slice(0, 3).map((entry) => {
        const record = entry as { id?: { channelId?: string; videoId?: string }; snippet?: { resourceId?: { channelId?: string } } };
        return record?.snippet?.resourceId?.channelId ?? record?.id?.channelId ?? record?.id?.videoId ?? null;
      }),
      error: payload.error ?? null,
    });

    return {
      source: enrichedItems.length > 0 ? 'youtube_api' : 'youtube_api_empty',
      items: enrichedItems,
    };
  } catch (error) {
    console.error('Failed to fetch YouTube subscriptions', error);
    return { source: 'youtube_fetch_error', items: [] };
  }
}
