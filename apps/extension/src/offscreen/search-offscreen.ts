type SearchJob = {
  target?: string;
  type?: string;
  query?: string;
  limit?: number;
};

const worker = new Worker(new URL('./youtube-search-worker.ts', import.meta.url), {
  type: 'module',
});
const semanticWorker = new Worker(new URL('./semantic-embedding-worker.ts', import.meta.url), {
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

const embedInWorker = (texts: string[]): Promise<{
  embeddings: number[][];
  modelId: string;
  modelVersion: string;
  dimensions: number;
}> => {
  const id = `semantic-embedding-${++sequence}`;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<{
      id: string;
      ok: boolean;
      embeddings?: number[][];
      modelId?: string;
      modelVersion?: string;
      dimensions?: number;
      error?: string;
    }>) => {
      if (event.data.id !== id) return;
      semanticWorker.removeEventListener('message', onMessage);
      if (!event.data.ok || !event.data.embeddings || !event.data.modelId || !event.data.modelVersion || !event.data.dimensions) {
        reject(new Error(event.data.error ?? 'Semantic embedding worker failed.'));
        return;
      }
      resolve({
        embeddings: event.data.embeddings,
        modelId: event.data.modelId,
        modelVersion: event.data.modelVersion,
        dimensions: event.data.dimensions,
      });
    };
    semanticWorker.addEventListener('message', onMessage);
    semanticWorker.postMessage({ id, texts });
  });
};

chrome.runtime.onMessage.addListener((message: SearchJob & { texts?: string[] }, _sender, sendResponse) => {
  if (message?.target === 'semantic-embedding-offscreen' && message.type === 'EMBED_TEXTS') {
    void (async () => {
      const texts = Array.isArray(message.texts)
        ? message.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
        : [];
      const result = await embedInWorker(texts);
      sendResponse({ ok: true, ...result });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Semantic embedding failed.',
      });
    });
    return true;
  }

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
