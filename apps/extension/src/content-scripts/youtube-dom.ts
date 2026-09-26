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

export function extractYouTubeChannelIdFromWatchHtml(html: string): string | null {
  const patterns = [
    /"channelId"\s*:\s*"([^"]+)"/,
    /"externalChannelId"\s*:\s*"([^"]+)"/,
    /"browseId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/,
    /itemprop=["']channelId["'][^>]*content=["']([^"']+)["']/i,
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
