type SearchJob = {
  target?: string;
  type?: string;
  query?: string;
  limit?: number;
};

const worker = new Worker(new URL('./youtube-search-worker.ts', import.meta.url), {
  type: 'module',
});

let sequence = 0;
const pending = new Map<string, {
  resolve: (value: unknown[]) => void;
  reject: (reason?: unknown) => void;
}>();

worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; results?: unknown[]; error?: string }>) => {
  const request = pending.get(event.data.id);
  if (!request) return;
  pending.delete(event.data.id);
  if (event.data.ok) request.resolve(event.data.results ?? []);
  else request.reject(new Error(event.data.error ?? 'YouTube search worker failed.'));
};

worker.onerror = (event) => {
  for (const request of pending.values()) {
    request.reject(new Error(event.message || 'YouTube search worker failed.'));
  }
  pending.clear();
};

const parseInWorker = (html: string, limit: number): Promise<unknown[]> => {
  const id = `youtube-search-${++sequence}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, html, limit });
  });
};

chrome.runtime.onMessage.addListener((message: SearchJob, _sender, sendResponse) => {
  if (message?.target !== 'youtube-search-offscreen' || message.type !== 'SEARCH_YOUTUBE_PAGE') {
    return false;
  }

  void (async () => {
    const query = message.query?.trim();
    if (!query) throw new Error('YouTube search query is required.');
    const limit = Math.max(1, Math.min(20, Math.floor(message.limit ?? 8)));
    const url = new URL('https://www.youtube.com/results');
    url.searchParams.set('search_query', query);

    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) throw new Error(`YouTube search HTTP ${response.status}`);

    const results = await parseInWorker(await response.text(), limit);
    sendResponse({ ok: true, results });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'YouTube search failed.',
    });
  });

  return true;
});
