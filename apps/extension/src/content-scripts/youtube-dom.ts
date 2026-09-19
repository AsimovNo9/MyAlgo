export const videoLinkSelector = 'a[href*="/watch"], a[href*="/shorts/"]';

export function normalizeYouTubeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function extractYouTubeVideoId(href: string): string | undefined {
  try {
    const url = new URL(href, 'https://www.youtube.com');
    const fromQuery = url.searchParams.get('v');
    if (fromQuery && ['/watch', '/live'].includes(url.pathname)) return fromQuery;

    return url.pathname.match(/\/(?:shorts|live|embed)\/([^/?]+)/)?.[1]
      ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0] : undefined);
  } catch {
    return undefined;
  }
}

export function extractYouTubeLinkTitle(attributes: { title?: string | null; ariaLabel?: string | null; textContent?: string | null }): string {
  return normalizeYouTubeText(
    [attributes.title, attributes.ariaLabel, attributes.textContent]
      .find((value) => typeof value === 'string' && value.trim().length > 0) ?? '',
  );
}
