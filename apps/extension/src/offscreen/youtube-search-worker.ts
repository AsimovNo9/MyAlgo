import { parseYoutubeSearchResultsHtml } from '../connectors/youtube-acquisition';

self.onmessage = (event: MessageEvent<{ id: string; html: string; limit: number }>) => {
  const { id, html, limit } = event.data;
  try {
    const results = parseYoutubeSearchResultsHtml(html, limit);
    self.postMessage({ id, ok: true, results });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to parse YouTube search results.',
    });
  }
};
