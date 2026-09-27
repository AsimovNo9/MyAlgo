import { env, pipeline } from '@huggingface/transformers';

const NEURAL_MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const NEURAL_MODEL_VERSION = 'transformersjs-local-q8-v2';
const NEURAL_DIMENSIONS = 384;
const CONCEPT_MODEL_ID = 'Xenova/flan-t5-small';
const CONCEPT_MODEL_VERSION = 'transformersjs-local-q8-v1';

type FeatureExtractionPipeline = {
  (texts: string[], options: {
    pooling: 'mean';
    normalize: true;
    truncation: true;
    max_length: number;
  }): Promise<{ tolist(): unknown }>;
};

type Text2TextPipeline = {
  (text: string, options: {
    max_new_tokens: number;
    do_sample: false;
    num_beams: number;
  }): Promise<Array<{ generated_text?: string }>>;
};

type NeuralSandboxRequest = {
  source?: 'myalgo-neural-host';
  id?: string;
  type?: 'EMBED_TEXTS' | 'EXTRACT_CONCEPTS';
  batchSize?: number;
  texts?: string[];
  prompts?: string[];
};

type LocalBackend = 'webgpu-sandbox' | 'wasm-sandbox';

let extractorPromise: Promise<{ extractor: FeatureExtractionPipeline; backend: LocalBackend }> | null = null;
let conceptGeneratorPromise: Promise<{ generator: Text2TextPipeline; backend: LocalBackend }> | null = null;
let activeRequestId: string | null = null;
const queuedRequestIds = new Set<string>();
let requestQueue: Promise<void> = Promise.resolve();

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', window.location.href).href;
env.useBrowserCache = false;
env.useWasmCache = false;
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

const backendName = (device: 'webgpu' | 'wasm'): LocalBackend =>
  device === 'webgpu' ? 'webgpu-sandbox' : 'wasm-sandbox';

const progressCallback = (
  device: 'webgpu' | 'wasm',
  modelKind: 'embedding' | 'concept',
) => (progress: unknown) => {
  postToHost({
    id: activeRequestId,
    type: 'progress',
    modelKind,
    backend: backendName(device),
    progress,
  });
};

const buildExtractor = async (
  device: 'webgpu' | 'wasm',
): Promise<FeatureExtractionPipeline> => pipeline(
  'feature-extraction',
  'mxbai-embed-xsmall-v1',
  {
    device,
    dtype: 'q8',
    progress_callback: progressCallback(device, 'embedding'),
  },
) as Promise<FeatureExtractionPipeline>;

const buildConceptGenerator = async (
  device: 'webgpu' | 'wasm',
): Promise<Text2TextPipeline> => pipeline(
  'text2text-generation',
  'flan-t5-small',
  {
    device,
    dtype: 'q8',
    progress_callback: progressCallback(device, 'concept'),
  },
) as Promise<Text2TextPipeline>;

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
  backend: LocalBackend;
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
            modelKind: 'embedding',
            from: 'webgpu-sandbox',
            to: 'wasm-sandbox',
            reason: error instanceof Error ? error.message : 'WebGPU embedding initialization failed.',
          });
        }
      } else {
        postToHost({
          id: activeRequestId,
          type: 'backend-fallback',
          modelKind: 'embedding',
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

async function getConceptGenerator(): Promise<{
  generator: Text2TextPipeline;
  backend: LocalBackend;
}> {
  if (!conceptGeneratorPromise) {
    conceptGeneratorPromise = (async () => {
      if (await hasUsableWebGpuAdapter()) {
        try {
          return {
            generator: await buildConceptGenerator('webgpu'),
            backend: 'webgpu-sandbox' as const,
          };
        } catch (error) {
          postToHost({
            id: activeRequestId,
            type: 'backend-fallback',
            modelKind: 'concept',
            from: 'webgpu-sandbox',
            to: 'wasm-sandbox',
            reason: error instanceof Error ? error.message : 'WebGPU concept-model initialization failed.',
          });
        }
      } else {
        postToHost({
          id: activeRequestId,
          type: 'backend-fallback',
          modelKind: 'concept',
          from: 'webgpu-sandbox',
          to: 'wasm-sandbox',
          reason: 'No usable WebGPU adapter is available.',
        });
      }

      return {
        generator: await buildConceptGenerator('wasm'),
        backend: 'wasm-sandbox' as const,
      };
    })();

    conceptGeneratorPromise.catch(() => {
      conceptGeneratorPromise = null;
    });
  }

  return conceptGeneratorPromise;
}

async function runEmbeddingRequest(id: string, request: NeuralSandboxRequest) {
  const texts = Array.isArray(request.texts)
    ? request.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
    : [];
  const { extractor, backend } = await getExtractor();
  const requestedBatchSize = Math.max(
    1,
    Math.min(16, Math.floor(Number(request.batchSize ?? 1))),
  );
  const batchSize = backend === 'wasm-sandbox' ? 16 : requestedBatchSize;
  const inferenceBatchCount = Math.ceil(texts.length / batchSize);
  const startedAt = performance.now();
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize);
    const progress = {
      id,
      type: 'inference',
      modelKind: 'embedding',
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
    modelKind: 'embedding',
    modelId: NEURAL_MODEL_ID,
    modelVersion: NEURAL_MODEL_VERSION,
    dimensions: NEURAL_DIMENSIONS,
    backend,
    embeddings,
  });
}

async function runConceptRequest(id: string, request: NeuralSandboxRequest) {
  const prompts = Array.isArray(request.prompts)
    ? request.prompts
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.slice(0, 3_000))
        .slice(0, 4)
    : [];
  const { generator, backend } = await getConceptGenerator();
  const startedAt = performance.now();
  const outputs: string[] = [];

  for (let index = 0; index < prompts.length; index += 1) {
    postToHost({
      id,
      type: 'concept-inference',
      modelKind: 'concept',
      backend,
      item: index + 1,
      itemCount: prompts.length,
      completedItems: index,
      inputCount: prompts.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    const generated = await generator(prompts[index], {
      max_new_tokens: 40,
      do_sample: false,
      num_beams: 1,
    });
    const text = generated?.[0]?.generated_text;
    if (typeof text !== 'string') {
      throw new Error('Concept extraction model returned an unexpected output.');
    }
    outputs.push(text);
    postToHost({
      id,
      type: 'concept-inference',
      modelKind: 'concept',
      backend,
      item: index + 1,
      itemCount: prompts.length,
      completedItems: index + 1,
      inputCount: prompts.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }

  postToHost({
    id,
    ok: true,
    modelKind: 'concept',
    modelId: CONCEPT_MODEL_ID,
    modelVersion: CONCEPT_MODEL_VERSION,
    backend,
    outputs,
  });
}

window.addEventListener('message', (event: MessageEvent<NeuralSandboxRequest>) => {
  const request = event.data;
  if (
    event.source !== window.parent
    || request?.source !== 'myalgo-neural-host'
    || (request.type !== 'EMBED_TEXTS' && request.type !== 'EXTRACT_CONCEPTS')
    || typeof request.id !== 'string'
  ) {
    return;
  }

  const id = request.id;
  if (queuedRequestIds.has(id)) return;
  queuedRequestIds.add(id);

  const runRequest = async () => {
    activeRequestId = id;
    if (request.type === 'EXTRACT_CONCEPTS') {
      await runConceptRequest(id, request);
      return;
    }
    await runEmbeddingRequest(id, request);
  };

  requestQueue = requestQueue.then(runRequest).catch((error) => {
    postToHost({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Local neural sandbox failed.',
    });
  }).finally(() => {
    activeRequestId = null;
    queuedRequestIds.delete(id);
  });
});

postToHost({ type: 'ready' });
