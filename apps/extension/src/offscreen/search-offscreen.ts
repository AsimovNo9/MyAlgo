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

const ensureNeuralSandbox = (): HTMLIFrameElement => {
  let frame = document.querySelector<HTMLIFrameElement>('[data-myalgo-neural-sandbox]');
  if (frame) return frame;

  frame = document.createElement('iframe');
  frame.dataset.myalgoNeuralSandbox = 'true';
  frame.src = chrome.runtime.getURL('neural-sandbox.html');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.display = 'none';
  document.body.append(frame);
  return frame;
};

type SemanticResult = {
  embeddings: number[][];
  modelId: string;
  modelVersion: string;
  dimensions: number;
};

const persistSemanticStatus = (
  provider: 'hash' | 'neural',
  data: {
    modelId?: string;
    status?: string;
    progress?: number | null;
    loaded?: number | null;
    total?: number | null;
    file?: string | null;
    backend?: string;
  },
) => {
  void chrome.runtime.sendMessage({
    type: 'SEMANTIC_MODEL_STATUS',
    payload: {
      mode: provider,
      modelId: data.modelId ?? (
        provider === 'neural'
          ? 'mixedbread-ai/mxbai-embed-xsmall-v1'
          : 'myalgo-local-hash-embedding'
      ),
      backend: data.backend ?? (provider === 'neural' ? 'webgpu-sandbox' : 'hash'),
      status: data.status ?? 'loading',
      progress: data.progress ?? null,
      loaded: data.loaded ?? null,
      total: data.total ?? null,
      file: data.file ?? null,
      updatedAt: new Date().toISOString(),
    },
  }).catch(() => undefined);
};

const embedHashInWorker = (texts: string[]): Promise<SemanticResult> => {
  const id = `semantic-embedding-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      semanticWorker.removeEventListener('message', onMessage);
      semanticWorker.removeEventListener('error', onError);
      reject(new Error('Semantic embedding worker timed out.'));
    }, 15_000);

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
      id: string;
      ok?: boolean;
      embeddings?: number[][];
      modelId?: string;
      modelVersion?: string;
      dimensions?: number;
      error?: string;
    }>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (!event.data.ok || !event.data.embeddings || !event.data.modelId || !event.data.modelVersion || !event.data.dimensions) {
        reject(new Error(event.data.error ?? 'Semantic embedding worker failed.'));
        return;
      }
      persistSemanticStatus('hash', {
        modelId: event.data.modelId,
        backend: 'hash',
        status: 'ready',
        progress: 100,
      });
      resolve({
        embeddings: event.data.embeddings,
        modelId: event.data.modelId,
        modelVersion: event.data.modelVersion,
        dimensions: event.data.dimensions,
      });
    };

    semanticWorker.addEventListener('message', onMessage);
    semanticWorker.addEventListener('error', onError);
    semanticWorker.postMessage({ id, texts });
  });
};

const embedNeuralInSandbox = (texts: string[]): Promise<SemanticResult> => {
  const id = `neural-sandbox-${++sequence}`;
  const frame = ensureNeuralSandbox();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Neural semantic sandbox timed out.'));
    }, 300_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };

    const postRequest = () => {
      frame.contentWindow?.postMessage({
        source: 'myalgo-neural-host',
        id,
        type: 'EMBED_TEXTS',
        texts,
      }, '*');
    };

    const onMessage = (event: MessageEvent<{
      source?: string;
      id?: string | null;
      type?: 'ready' | 'progress' | 'backend-fallback';
      backend?: string;
      from?: string;
      to?: string;
      reason?: string;
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
      if (
        event.source !== frame.contentWindow
        || event.data?.source !== 'myalgo-neural-sandbox'
      ) {
        return;
      }

      if (event.data.type === 'ready') {
        postRequest();
        return;
      }
      if (event.data.id !== id) return;

      if (event.data.type === 'backend-fallback') {
        persistSemanticStatus('neural', {
          status: 'loading',
          progress: null,
          backend: event.data.to ?? 'wasm-sandbox',
        });
        return;
      }

      if (event.data.type === 'progress') {
        const progress = event.data.progress ?? {};
        persistSemanticStatus('neural', {
          status: progress.status ?? 'loading',
          progress: typeof progress.progress === 'number' ? progress.progress : null,
          loaded: typeof progress.loaded === 'number' ? progress.loaded : null,
          total: typeof progress.total === 'number' ? progress.total : null,
          file: progress.file ?? null,
          backend: event.data.backend ?? 'webgpu-sandbox',
        });
        return;
      }

      cleanup();
      if (!event.data.ok || !event.data.embeddings || !event.data.modelId || !event.data.modelVersion || !event.data.dimensions) {
        reject(new Error(event.data.error ?? 'Neural semantic sandbox failed.'));
        return;
      }

      persistSemanticStatus('neural', {
        modelId: event.data.modelId,
        status: 'ready',
        progress: 100,
        backend: event.data.backend ?? 'webgpu-sandbox',
      });
      resolve({
        embeddings: event.data.embeddings,
        modelId: event.data.modelId,
        modelVersion: event.data.modelVersion,
        dimensions: event.data.dimensions,
      });
    };

    window.addEventListener('message', onMessage);

    if (frame.contentDocument?.readyState === 'complete') {
      postRequest();
    } else {
      frame.addEventListener('load', postRequest, { once: true });
    }
  });
};

const embedSemantics = (
  texts: string[],
  provider: 'hash' | 'neural',
): Promise<SemanticResult> => (
  provider === 'neural'
    ? embedNeuralInSandbox(texts)
    : embedHashInWorker(texts)
);

chrome.runtime.onMessage.addListener((message: SearchJob, _sender, sendResponse) => {
  if (message?.target === 'semantic-embedding-offscreen' && message.type === 'EMBED_TEXTS') {
    void (async () => {
      const texts = Array.isArray(message.texts)
        ? message.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
        : [];
      const result = await embedSemantics(texts, message.provider === 'neural' ? 'neural' : 'hash');
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
