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

async function getValidYoutubeAccessToken(userId: string): Promise<string | null> {
  const { createSupabaseServerClient } = await import('./supabase/server');
  const client = await createSupabaseServerClient();

  if (!client) {
    return null;
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const providerToken = sessionData.session?.provider_token;
  const providerRefreshToken = sessionData.session?.provider_refresh_token;

  console.log('YouTube provider session state', {
    userId,
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

    return { ok: false, source: result.source, synced: 0, classified: 0, items: [], error: reason };
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

    console.log('YouTube subscriptions payload debug', {
      userId,
      totalResults: payload.pageInfo?.totalResults ?? rawItems.length,
      returnedItems: rawItems.length,
      mappedItems: items.length,
      sampleIds: rawItems.slice(0, 3).map((entry) => {
        const record = entry as { id?: { channelId?: string; videoId?: string }; snippet?: { resourceId?: { channelId?: string } } };
        return record?.snippet?.resourceId?.channelId ?? record?.id?.channelId ?? record?.id?.videoId ?? null;
      }),
      error: payload.error ?? null,
    });

    return {
      source: items.length > 0 ? 'youtube_api' : 'youtube_api_empty',
      items,
    };
  } catch (error) {
    console.error('Failed to fetch YouTube subscriptions', error);
    return { source: 'youtube_fetch_error', items: [] };
  }
}
