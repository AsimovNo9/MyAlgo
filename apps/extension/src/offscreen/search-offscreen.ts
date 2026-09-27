type SearchJob = {
  target?: string;
  type?: string;
  query?: string;
  limit?: number;
  provider?: 'hash' | 'neural';
  texts?: string[];
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

const embedInWorker = (texts: string[], provider: 'hash' | 'neural'): Promise<{
  embeddings: number[][];
  modelId: string;
  modelVersion: string;
  dimensions: number;
}> => {
  const id = `semantic-embedding-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      semanticWorker.removeEventListener('message', onMessage);
      semanticWorker.removeEventListener('error', onError);
      reject(new Error('Semantic embedding worker timed out.'));
    }, provider === 'neural' ? 120_000 : 15_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      semanticWorker.removeEventListener('message', onMessage);
      semanticWorker.removeEventListener('error', onError);
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Semantic embedding worker crashed.'));
    };

    const onMessage = (event: MessageEvent<{
      id: string | null;
      type?: 'progress';
      progress?: {
        status?: string;
        progress?: number;
        loaded?: number;
        total?: number;
        file?: string;
      };
      ok?: boolean;
      embeddings?: number[][];
      modelId?: string;
      modelVersion?: string;
      dimensions?: number;
      error?: string;
    }>) => {
      if (event.data.id !== id) return;
      if (event.data.type === 'progress') {
        const progress = event.data.progress ?? {};
        void chrome.runtime.sendMessage({
          type: 'SEMANTIC_MODEL_STATUS',
          payload: {
            mode: 'neural',
            modelId: 'mixedbread-ai/mxbai-embed-xsmall-v1',
            backend: 'webgpu',
            status: progress.status ?? 'loading',
            progress: typeof progress.progress === 'number' ? progress.progress : null,
            loaded: typeof progress.loaded === 'number' ? progress.loaded : null,
            total: typeof progress.total === 'number' ? progress.total : null,
            file: progress.file ?? null,
            updatedAt: new Date().toISOString(),
          },
        }).catch(() => undefined);
        return;
      }
      cleanup();
      if (!event.data.ok || !event.data.embeddings || !event.data.modelId || !event.data.modelVersion || !event.data.dimensions) {
        reject(new Error(event.data.error ?? 'Semantic embedding worker failed.'));
        return;
      }
      void chrome.runtime.sendMessage({
        type: 'SEMANTIC_MODEL_STATUS',
        payload: {
          mode: provider,
          modelId: event.data.modelId,
          backend: provider === 'neural' ? 'webgpu' : 'hash',
          status: 'ready',
          progress: 100,
          loaded: null,
          total: null,
          file: null,
          updatedAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
      resolve({
        embeddings: event.data.embeddings,
        modelId: event.data.modelId,
        modelVersion: event.data.modelVersion,
        dimensions: event.data.dimensions,
      });
    };
    semanticWorker.addEventListener('message', onMessage);
    semanticWorker.addEventListener('error', onError);
    semanticWorker.postMessage({ id, texts, provider });
  });
};

chrome.runtime.onMessage.addListener((message: SearchJob, _sender, sendResponse) => {
  if (message?.target === 'semantic-embedding-offscreen' && message.type === 'EMBED_TEXTS') {
    void (async () => {
      const texts = Array.isArray(message.texts)
        ? message.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
        : [];
      const result = await embedInWorker(texts, message.provider === 'neural' ? 'neural' : 'hash');
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
