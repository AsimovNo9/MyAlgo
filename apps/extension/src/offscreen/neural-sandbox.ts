import { env, pipeline } from '@huggingface/transformers';

const NEURAL_MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const NEURAL_MODEL_VERSION = 'transformersjs-local-q8-v2';
const NEURAL_DIMENSIONS = 384;

type FeatureExtractionPipeline = {
  (texts: string[], options: {
    pooling: 'mean';
    normalize: true;
    truncation: true;
    max_length: number;
  }): Promise<{ tolist(): unknown }>;
};

type NeuralSandboxRequest = {
  source?: 'myalgo-neural-host';
  id?: string;
  type?: 'EMBED_TEXTS';
  texts?: string[];
};

let extractorPromise: Promise<{ extractor: FeatureExtractionPipeline; backend: 'webgpu-sandbox' | 'wasm-sandbox' }> | null = null;
let activeRequestId: string | null = null;
const queuedRequestIds = new Set<string>();
let requestQueue: Promise<void> = Promise.resolve();

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', window.location.href).href;
// Chrome extension sandbox pages use an opaque origin and cannot access
// CacheStorage because extension sandbox CSP cannot opt into allow-same-origin.
env.useBrowserCache = false;
env.useWasmCache = false;
// ONNX Runtime defaults these executable runtime files to a CDN. MV3 must
// execute only code packaged with the extension, so force both URLs to local
// packaged assets. Model/configuration files are also packaged at build time.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL('./runtime/onnx/ort-wasm-simd-threaded.asyncify.mjs', window.location.href).href,
  wasm: new URL('./runtime/onnx/ort-wasm-simd-threaded.asyncify.wasm', window.location.href).href,
};

const postToHost = (message: Record<string, unknown>) => {
  window.parent.postMessage({
    source: 'myalgo-neural-sandbox',
    ...message,
  }, '*');
};

const buildExtractor = async (
  device: 'webgpu' | 'wasm',
): Promise<FeatureExtractionPipeline> => pipeline(
  'feature-extraction',
  'mxbai-embed-xsmall-v1',
  {
    device,
    dtype: 'q8',
    progress_callback: (progress: unknown) => {
      postToHost({
        id: activeRequestId,
        type: 'progress',
        backend: device === 'webgpu' ? 'webgpu-sandbox' : 'wasm-sandbox',
        progress,
      });
    },
  },
) as Promise<FeatureExtractionPipeline>;

async function hasUsableWebGpuAdapter(): Promise<boolean> {
  const gpu = (navigator as Navigator & {
    gpu?: { requestAdapter(): Promise<unknown | null> };
  }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function getExtractor(): Promise<{
  extractor: FeatureExtractionPipeline;
  backend: 'webgpu-sandbox' | 'wasm-sandbox';
}> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      if (await hasUsableWebGpuAdapter()) {
        try {
          return {
            extractor: await buildExtractor('webgpu'),
            backend: 'webgpu-sandbox' as const,
          };
        } catch (error) {
          postToHost({
            id: activeRequestId,
            type: 'backend-fallback',
            from: 'webgpu-sandbox',
            to: 'wasm-sandbox',
            reason: error instanceof Error ? error.message : 'WebGPU initialization failed.',
          });
        }
      } else {
        postToHost({
          id: activeRequestId,
          type: 'backend-fallback',
          from: 'webgpu-sandbox',
          to: 'wasm-sandbox',
          reason: 'No usable WebGPU adapter is available.',
        });
      }

      return {
        extractor: await buildExtractor('wasm'),
        backend: 'wasm-sandbox' as const,
      };
    })();

    extractorPromise.catch(() => {
      extractorPromise = null;
    });
  }

  return extractorPromise;
}

window.addEventListener('message', (event: MessageEvent<NeuralSandboxRequest>) => {
  const request = event.data;
  if (
    event.source !== window.parent
    || request?.source !== 'myalgo-neural-host'
    || request.type !== 'EMBED_TEXTS'
    || typeof request.id !== 'string'
  ) {
    return;
  }

  const texts = Array.isArray(request.texts)
    ? request.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
    : [];
  const id = request.id;
  if (queuedRequestIds.has(id)) return;
  queuedRequestIds.add(id);

  const runRequest = async () => {
    activeRequestId = id;
    const { extractor, backend } = await getExtractor();
    // One text per WebGPU call while diagnosing Pascal-era GPU stalls.
    const batchSize = backend === 'wasm-sandbox' ? 16 : 1;
    const inferenceBatchCount = Math.ceil(texts.length / batchSize);
    const startedAt = performance.now();
    const embeddings: number[][] = [];
    for (let index = 0; index < texts.length; index += batchSize) {
      const batch = texts.slice(index, index + batchSize);
      const progress = {
        id,
        type: 'inference',
        backend,
        inferenceBatch: Math.floor(index / batchSize) + 1,
        inferenceBatchCount,
        completedBatches: Math.floor(index / batchSize),
        batchSize,
        inputCount: texts.length,
        tokenMaxLength: 128,
      };
      postToHost({ ...progress, elapsedMs: Math.round(performance.now() - startedAt) });
      const output = await extractor(batch, {
        pooling: 'mean',
        normalize: true,
        truncation: true,
        max_length: 128,
      });
      const batchEmbeddings = output.tolist() as number[][];
      if (!Array.isArray(batchEmbeddings) || batchEmbeddings.length !== batch.length) {
        throw new Error('Neural embedding pipeline returned an unexpected batch shape.');
      }
      embeddings.push(...batchEmbeddings);
      postToHost({
        ...progress,
        completedBatches: progress.inferenceBatch,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }

    if (embeddings.length !== texts.length) {
      throw new Error('Neural embedding pipeline returned an unexpected batch shape.');
    }
    if (embeddings.some((vector) => !Array.isArray(vector) || vector.length !== NEURAL_DIMENSIONS)) {
      throw new Error('Neural embedding pipeline returned an unexpected embedding dimension.');
    }

    postToHost({
      id,
      ok: true,
      modelId: NEURAL_MODEL_ID,
      modelVersion: NEURAL_MODEL_VERSION,
      dimensions: NEURAL_DIMENSIONS,
      backend,
      embeddings,
    });
  };

  requestQueue = requestQueue.then(runRequest).catch((error) => {
    postToHost({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Neural semantic sandbox failed.',
    });
  }).finally(() => {
    activeRequestId = null;
    queuedRequestIds.delete(id);
  });
});

postToHost({ type: 'ready' });
