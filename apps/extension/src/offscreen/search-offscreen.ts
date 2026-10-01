type SearchJob = {
  target?: string;
  type?: string;
  query?: string;
  limit?: number;
  provider?: 'hash' | 'neural';
  batchSize?: number;
  texts?: string[];
  conceptItems?: Array<{
    text?: string;
    labels?: string[];
  }>;
};

const worker = new Worker(new URL('./youtube-search-worker.ts', import.meta.url), {
  type: 'module',
});
const semanticWorker = new Worker(new URL('./semantic-embedding-worker.ts', import.meta.url), {
  type: 'module',
});
// Sandbox pages have an opaque origin, so contentDocument is null even after
// load. Remember readiness for later requests to the same iframe.
const readyNeuralFrames = new WeakSet<HTMLIFrameElement>();

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

const ensureModelSandbox = (
  kind: 'embedding' | 'concept',
): HTMLIFrameElement => {
  const selector = kind === 'embedding'
    ? '[data-myalgo-neural-sandbox]'
    : '[data-myalgo-concept-sandbox]';
  let frame = document.querySelector<HTMLIFrameElement>(selector);
  if (frame) return frame;

  frame = document.createElement('iframe');
  if (kind === 'embedding') frame.dataset.myalgoNeuralSandbox = 'true';
  else frame.dataset.myalgoConceptSandbox = 'true';
  frame.src = chrome.runtime.getURL('neural-sandbox.html');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.display = 'none';
  document.body.append(frame);
  return frame;
};

const ensureNeuralSandbox = (): HTMLIFrameElement =>
  ensureModelSandbox('embedding');

const ensureConceptSandbox = (): HTMLIFrameElement =>
  ensureModelSandbox('concept');

const resetModelSandbox = (frame: HTMLIFrameElement): void => {
  readyNeuralFrames.delete(frame);
  if (frame.isConnected) frame.remove();
};

type SemanticResult = {
  embeddings: number[][];
  modelId: string;
  modelVersion: string;
  dimensions: number;
};

type ConceptResult = {
  concepts: string[][];
  modelId: string;
  modelVersion: string;
  backend: string;
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
    inferenceBatch?: number | null;
    inferenceBatchCount?: number | null;
    completedBatches?: number | null;
    batchSize?: number | null;
    inputCount?: number | null;
    tokenMaxLength?: number | null;
    elapsedMs?: number | null;
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
      inferenceBatch: data.inferenceBatch ?? null,
      inferenceBatchCount: data.inferenceBatchCount ?? null,
      completedBatches: data.completedBatches ?? null,
      batchSize: data.batchSize ?? null,
      inputCount: data.inputCount ?? null,
      tokenMaxLength: data.tokenMaxLength ?? null,
      elapsedMs: data.elapsedMs ?? null,
      updatedAt: new Date().toISOString(),
    },
  }).catch(() => undefined);
};

const persistConceptStatus = (data: Record<string, unknown>) => {
  void chrome.runtime.sendMessage({
    type: 'CONCEPT_MODEL_STATUS',
    payload: {
      modelId: 'Xenova/nli-deberta-v3-xsmall',
      ...data,
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

const embedNeuralInSandbox = (
  texts: string[],
  requestedBatchSize = 1,
): Promise<SemanticResult> => {
  const id = `neural-sandbox-${++sequence}`;
  const frame = ensureNeuralSandbox();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      // A timed-out request may still be executing inside the iframe scheduler.
      // Reset the sandbox so an orphaned inference cannot block every later
      // embedding/concept request behind it.
      resetModelSandbox(frame);
      reject(new Error('Neural semantic sandbox timed out.'));
    }, 300_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
    };

    let requestSent = false;
    const postRequest = () => {
      if (requestSent || !frame.contentWindow) return;
      requestSent = true;
      frame.contentWindow.postMessage({
        source: 'myalgo-neural-host',
        id,
        type: 'EMBED_TEXTS',
        batchSize: Math.max(1, Math.min(16, Math.floor(requestedBatchSize))),
        texts,
      }, '*');
    };
    const probeReady = () => {
      if (!frame.contentWindow || requestSent) return;
      frame.contentWindow.postMessage({
        source: 'myalgo-neural-host',
        id,
        type: 'PING',
      }, '*');
    };
    const onLoad = () => {
      probeReady();
    };

    const onMessage = (event: MessageEvent<{
      source?: string;
      id?: string | null;
      type?: 'ready' | 'progress' | 'inference' | 'backend-fallback';
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
      inferenceBatch?: number;
      inferenceBatchCount?: number;
      completedBatches?: number;
      batchSize?: number;
      inputCount?: number;
      tokenMaxLength?: number;
      elapsedMs?: number;
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
        if (event.data.id && event.data.id !== id) return;
        readyNeuralFrames.add(frame);
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

      if (event.data.type === 'inference') {
        persistSemanticStatus('neural', {
          status: 'inference',
          backend: event.data.backend ?? 'webgpu-sandbox',
          inferenceBatch: event.data.inferenceBatch,
          inferenceBatchCount: event.data.inferenceBatchCount,
          completedBatches: event.data.completedBatches,
          batchSize: event.data.batchSize,
          inputCount: event.data.inputCount,
          tokenMaxLength: event.data.tokenMaxLength,
          elapsedMs: event.data.elapsedMs,
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

    if (readyNeuralFrames.has(frame)) {
      postRequest();
    } else {
      frame.addEventListener('load', onLoad, { once: true });
      // Covers the race where the packaged iframe has already loaded and emitted
      // its one-shot ready message before the host attached listeners.
      probeReady();
    }
  });
};

const verifyConceptsNeuralInSandbox = (
  conceptItems: Array<{ text: string; labels: string[] }>,
): Promise<ConceptResult> => {
  const id = `concept-sandbox-${++sequence}`;
  // Keep the q8 WASM verifier physically separate from the embedding iframe.
  // A slow/stuck concept request must not occupy the scheduler that services
  // WebGPU candidate embeddings.
  const frame = ensureConceptSandbox();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      // Concept inference shares the iframe scheduler with embeddings. Kill the
      // sandbox on timeout so a stuck q8 WASM verifier cannot strand subsequent
      // WebGPU embedding requests behind an abandoned job.
      resetModelSandbox(frame);
      persistConceptStatus({
        status: 'error',
        backend: 'unknown',
        error: 'Local concept verification sandbox timed out.',
      });
      reject(new Error('Local concept verification sandbox timed out.'));
    }, 300_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
    };

    let requestSent = false;
    const postRequest = () => {
      if (requestSent || !frame.contentWindow) return;
      requestSent = true;
      frame.contentWindow.postMessage({
        source: 'myalgo-neural-host',
        id,
        type: 'VERIFY_CONCEPTS',
        conceptItems,
      }, '*');
    };
    const probeReady = () => {
      if (!frame.contentWindow || requestSent) return;
      frame.contentWindow.postMessage({
        source: 'myalgo-neural-host',
        id,
        type: 'PING',
      }, '*');
    };
    const onLoad = () => {
      probeReady();
    };

    const onMessage = (event: MessageEvent<{
      source?: string;
      id?: string | null;
      type?: 'ready' | 'progress' | 'concept-inference' | 'backend-fallback';
      modelKind?: 'embedding' | 'concept';
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
      item?: number;
      itemCount?: number;
      completedItems?: number;
      inputCount?: number;
      elapsedMs?: number;
      ok?: boolean;
      concepts?: string[][];
      modelId?: string;
      modelVersion?: string;
      error?: string;
    }>) => {
      if (
        event.source !== frame.contentWindow
        || event.data?.source !== 'myalgo-neural-sandbox'
      ) return;

      if (event.data.type === 'ready') {
        if (event.data.id && event.data.id !== id) return;
        readyNeuralFrames.add(frame);
        postRequest();
        return;
      }
      if (event.data.id !== id || event.data.modelKind === 'embedding') return;

      if (event.data.type === 'backend-fallback') {
        persistConceptStatus({
          status: 'loading',
          backend: event.data.to ?? 'wasm-sandbox',
          fallbackReason: event.data.reason ?? null,
        });
        return;
      }
      if (event.data.type === 'progress') {
        const progress = event.data.progress ?? {};
        persistConceptStatus({
          status: progress.status ?? 'loading',
          progress: typeof progress.progress === 'number' ? progress.progress : null,
          loaded: typeof progress.loaded === 'number' ? progress.loaded : null,
          total: typeof progress.total === 'number' ? progress.total : null,
          file: progress.file ?? null,
          backend: event.data.backend ?? 'webgpu-sandbox',
        });
        return;
      }
      if (event.data.type === 'concept-inference') {
        persistConceptStatus({
          status: 'inference',
          backend: event.data.backend ?? 'webgpu-sandbox',
          item: event.data.item ?? null,
          itemCount: event.data.itemCount ?? null,
          completedItems: event.data.completedItems ?? null,
          inputCount: event.data.inputCount ?? null,
          elapsedMs: event.data.elapsedMs ?? null,
        });
        return;
      }

      cleanup();
      if (
        !event.data.ok
        || !Array.isArray(event.data.concepts)
        || !event.data.modelId
        || !event.data.modelVersion
      ) {
        const error = event.data.error ?? 'Local concept verification failed.';
        persistConceptStatus({
          status: 'error',
          backend: event.data.backend ?? 'unknown',
          error,
        });
        reject(new Error(error));
        return;
      }
      persistConceptStatus({
        status: 'ready',
        progress: 100,
        backend: event.data.backend ?? 'webgpu-sandbox',
      });
      resolve({
        concepts: event.data.concepts,
        modelId: event.data.modelId,
        modelVersion: event.data.modelVersion,
        backend: event.data.backend ?? 'webgpu-sandbox',
      });
    };

    window.addEventListener('message', onMessage);
    if (readyNeuralFrames.has(frame)) {
      postRequest();
    } else {
      frame.addEventListener('load', onLoad, { once: true });
      probeReady();
    }
  });
};

const embedSemantics = (
  texts: string[],
  provider: 'hash' | 'neural',
  batchSize = 1,
): Promise<SemanticResult> => (
  provider === 'neural'
    ? embedNeuralInSandbox(texts, batchSize)
    : embedHashInWorker(texts)
);

chrome.runtime.onMessage.addListener((message: SearchJob, _sender, sendResponse) => {
  if (message?.target === 'semantic-embedding-offscreen' && message.type === 'VERIFY_CONCEPTS') {
    void (async () => {
      const conceptItems = Array.isArray(message.conceptItems)
        ? message.conceptItems
            .map((item) => ({
              text: typeof item?.text === 'string' ? item.text : '',
              labels: Array.isArray(item?.labels)
                ? item.labels.filter((label): label is string => typeof label === 'string')
                : [],
            }))
            .slice(0, 4)
        : [];
      const result = await verifyConceptsNeuralInSandbox(conceptItems);
      sendResponse({ ok: true, ...result });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : 'Local concept verification failed.';
      persistConceptStatus({
        status: 'error',
        backend: 'unknown',
        error: message,
      });
      sendResponse({
        ok: false,
        error: message,
      });
    });
    return true;
  }

  if (message?.target === 'semantic-embedding-offscreen' && message.type === 'EMBED_TEXTS') {
    void (async () => {
      const texts = Array.isArray(message.texts)
        ? message.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
        : [];
      const result = await embedSemantics(
        texts,
        message.provider === 'neural' ? 'neural' : 'hash',
        Number(message.batchSize ?? 1),
      );
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
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (
      response.type === 'opaqueredirect'
      || (response.status >= 300 && response.status < 400)
    ) {
      throw new Error(
        'YOUTUBE_SEARCH_BLOCKED: YouTube search redirected to an anti-abuse/interstitial response.',
      );
    }
    if (response.url) {
      const host = new URL(response.url).hostname.toLowerCase();
      if (host !== 'www.youtube.com' && host !== 'youtube.com') {
        throw new Error(
          `YOUTUBE_SEARCH_BLOCKED: YouTube search left the YouTube origin (${host}).`,
        );
      }
    }
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
