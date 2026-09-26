export const videoLinkSelector = 'a[href*="/watch"], a[href*="/shorts/"], a[href*="/live/"]';

export function normalizeYouTubeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function extractYouTubeVideoId(href: string): string | undefined {
  try {
    const url = new URL(href, 'https://www.youtube.com');
    const hostname = url.hostname.toLowerCase();
    const isYouTubeHost = hostname === 'youtube.com'
      || hostname.endsWith('.youtube.com')
      || hostname === 'youtu.be';
    if (!isYouTubeHost) return undefined;

    const fromQuery = url.searchParams.get('v');
    if (fromQuery && ['/watch', '/live'].includes(url.pathname)) return fromQuery;

    return url.pathname.match(/\/(?:shorts|live|embed)\/([^/?]+)/)?.[1]
      ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0] : undefined);
  } catch {
    return undefined;
  }
}

export type YouTubeWatchMetadata = {
  title: string | null;
  description: string | null;
  channelId: string | null;
  channelName: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  keywords: string[];
  category: string | null;
  isLive: boolean;
};

function extractBalancedJsonObject(source: string, marker: string): string | null {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

export function extractYouTubeWatchMetadataFromHtml(html: string): YouTubeWatchMetadata {
  const markers = ['ytInitialPlayerResponse =', 'ytInitialPlayerResponse=', '"playerResponse":'];
  let player: any = null;
  for (const marker of markers) {
    const raw = extractBalancedJsonObject(html, marker);
    if (!raw) continue;
    try {
      player = JSON.parse(raw);
      if (player?.videoDetails || player?.microformat) break;
    } catch {
      // Fall back to the next representation/meta tags.
    }
  }

  const details = player?.videoDetails ?? {};
  const renderer = player?.microformat?.playerMicroformatRenderer ?? {};
  const thumbnails = Array.isArray(details?.thumbnail?.thumbnails)
    ? details.thumbnail.thumbnails
    : Array.isArray(renderer?.thumbnail?.thumbnails)
      ? renderer.thumbnail.thumbnails
      : [];
  const thumbnailUrl = thumbnails
    .filter((item: any) => typeof item?.url === 'string')
    .sort((left: any, right: any) => Number(right?.width ?? 0) - Number(left?.width ?? 0))[0]?.url ?? null;
  const duration = Number(details?.lengthSeconds);

  const fallback = (pattern: RegExp): string | null => html.match(pattern)?.[1]?.trim() ?? null;
  const title = typeof details?.title === 'string'
    ? details.title.trim()
    : fallback(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const description = typeof details?.shortDescription === 'string'
    ? details.shortDescription.trim()
    : fallback(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const channelId = typeof details?.channelId === 'string'
    ? details.channelId.trim()
    : extractYouTubeChannelIdFromWatchHtml(html);
  const channelName = typeof details?.author === 'string'
    ? details.author.trim()
    : fallback(/<meta[^>]+itemprop=["']author["'][^>]+content=["']([^"']+)["']/i);
  const publishedAt = typeof renderer?.publishDate === 'string'
    ? renderer.publishDate
    : typeof renderer?.uploadDate === 'string'
      ? renderer.uploadDate
      : fallback(/<meta[^>]+itemprop=["'](?:datePublished|uploadDate)["'][^>]+content=["']([^"']+)["']/i);
  const keywords = Array.isArray(details?.keywords)
    ? details.keywords.filter((item: unknown): item is string => typeof item === 'string').map((item: string) => item.trim()).filter(Boolean).slice(0, 24)
    : [];
  const category = typeof renderer?.category === 'string' ? renderer.category.trim() || null : null;

  return {
    title: title || null,
    description: description || null,
    channelId: channelId || null,
    channelName: channelName || null,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    publishedAt: publishedAt || null,
    thumbnailUrl,
    keywords,
    category,
    isLive: Boolean(details?.isLiveContent || renderer?.liveBroadcastDetails),
  };
}

export function extractYouTubeChannelIdFromWatchHtml(html: string): string | null {
  const patterns = [
    /"videoDetails"\s*:\s*\{[\s\S]{0,5000}?"channelId"\s*:\s*"([^"]+)"/,
    /"externalChannelId"\s*:\s*"([^"]+)"/,
    /itemprop=["']channelId["'][^>]*content=["']([^"']+)["']/i,
    /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/,
  ];

  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1]?.trim();
    if (value && /^UC[A-Za-z0-9_-]{20,}$/.test(value)) return value;
  }
  return null;
}

export function extractYouTubeCreator(element: Element): string | null {
  const channelLabel = element
    .querySelector<HTMLElement>('[aria-label^="Go to channel "]')
    ?.getAttribute('aria-label')
    ?.match(/^Go to channel\s+(.+)$/)?.[1];

  if (channelLabel) return normalizeYouTubeText(channelLabel) || null;

  const metadataRow = element.querySelector<HTMLElement>(
    '.ytContentMetadataViewModelMetadataRow',
  );
  const creatorText = metadataRow
    ?.querySelector<HTMLElement>(
      '.ytContentMetadataViewModelMetadataText:not(.ytContentMetadataViewModelMetadataTextLastPart)',
    )
    ?.textContent;

  return normalizeYouTubeText(creatorText ?? '') || null;
}

export function extractYouTubeLinkTitle(attributes: { title?: string | null; ariaLabel?: string | null; textContent?: string | null }): string {
  return normalizeYouTubeText(
    [attributes.title, attributes.ariaLabel, attributes.textContent]
      .find((value) => typeof value === 'string' && value.trim().length > 0) ?? '',
  );
}


export function extractYouTubeShortsTitle(element: Element): string | null {
  const values = Array.from(element.querySelectorAll<HTMLElement>(
    'a[href*="/shorts/"][title], a[href*="/shorts/"][aria-label], a[href*="/shorts/"]',
  ))
    .flatMap((node) => [
      node.getAttribute('title'),
      node.getAttribute('aria-label'),
      node.textContent,
    ])
    .map((value) => normalizeYouTubeText(value ?? ''))
    .filter((value) => value && !/^watch$/i.test(value) && !/^go to channel\s+/i.test(value));

  return values[0] ?? null;
}
