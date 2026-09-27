import { env, pipeline } from '@huggingface/transformers';
import { createPriorityNeuralScheduler, type NeuralSchedulerStepResult } from './neural-request-scheduler.ts';

const NEURAL_MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const NEURAL_MODEL_VERSION = 'transformersjs-local-q8-v2';
const NEURAL_DIMENSIONS = 384;
const CONCEPT_MODEL_ID = 'Xenova/nli-deberta-v3-xsmall';
const CONCEPT_MODEL_VERSION = 'transformersjs-local-q8-wasm-v1';

type FeatureExtractionPipeline = {
  (texts: string[], options: {
    pooling: 'mean';
    normalize: true;
    truncation: true;
    max_length: number;
  }): Promise<{ tolist(): unknown }>;
};

type ZeroShotClassificationPipeline = {
  (
    text: string,
    labels: string[],
    options: {
      multi_label: true;
      hypothesis_template: string;
    },
  ): Promise<{
    labels: string[];
    scores: number[];
  }>;
};

type NeuralSandboxRequest = {
  source?: 'myalgo-neural-host';
  id?: string;
  type?: 'EMBED_TEXTS' | 'VERIFY_CONCEPTS';
  batchSize?: number;
  texts?: string[];
  conceptItems?: Array<{
    text?: string;
    labels?: string[];
  }>;
};

type LocalBackend = 'webgpu-sandbox' | 'wasm-sandbox';

let extractorPromise: Promise<{ extractor: FeatureExtractionPipeline; backend: LocalBackend }> | null = null;
let conceptClassifierPromise: Promise<{ classifier: ZeroShotClassificationPipeline; backend: LocalBackend }> | null = null;
let activeRequestId: string | null = null;
const scheduler = createPriorityNeuralScheduler();

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

const buildConceptClassifier = async (): Promise<ZeroShotClassificationPipeline> => pipeline(
  'zero-shot-classification',
  'nli-deberta-v3-xsmall-concept-verifier',
  {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: progressCallback('wasm', 'concept'),
  },
) as Promise<ZeroShotClassificationPipeline>;

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

async function getConceptClassifier(): Promise<{
  classifier: ZeroShotClassificationPipeline;
  backend: LocalBackend;
}> {
  if (!conceptClassifierPromise) {
    // DeBERTa zero-shot classification is deliberately kept on q8 WASM.
    // For this model family, Transformers.js users have reported q8 WASM
    // outperforming WebGPU, while embeddings remain WebGPU-accelerated.
    conceptClassifierPromise = buildConceptClassifier().then((classifier) => ({
      classifier,
      backend: 'wasm-sandbox' as const,
    }));

    conceptClassifierPromise.catch(() => {
      conceptClassifierPromise = null;
    });
  }

  return conceptClassifierPromise;
}

type EmbeddingRequestState = {
  texts: string[];
  extractor: FeatureExtractionPipeline;
  backend: LocalBackend;
  batchSize: number;
  inferenceBatchCount: number;
  startedAt: number;
  embeddings: number[][];
  nextIndex: number;
};

function createEmbeddingRequestStep(
  id: string,
  request: NeuralSandboxRequest,
): () => Promise<NeuralSchedulerStepResult> {
  let state: EmbeddingRequestState | null = null;

  return async () => {
    activeRequestId = id;

    if (!state) {
      const texts = Array.isArray(request.texts)
        ? request.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
        : [];
      const { extractor, backend } = await getExtractor();
      const requestedBatchSize = Math.max(
        1,
        Math.min(16, Math.floor(Number(request.batchSize ?? 1))),
      );
      const batchSize = backend === 'wasm-sandbox' ? 16 : requestedBatchSize;
      state = {
        texts,
        extractor,
        backend,
        batchSize,
        inferenceBatchCount: Math.ceil(texts.length / batchSize),
        startedAt: performance.now(),
        embeddings: [],
        nextIndex: 0,
      };
    }

    if (state.nextIndex >= state.texts.length) {
      postToHost({
        id,
        ok: true,
        modelKind: 'embedding',
        modelId: NEURAL_MODEL_ID,
        modelVersion: NEURAL_MODEL_VERSION,
        dimensions: NEURAL_DIMENSIONS,
        backend: state.backend,
        embeddings: state.embeddings,
      });
      return 'done';
    }

    const index = state.nextIndex;
    const batch = state.texts.slice(index, index + state.batchSize);
    const progress = {
      id,
      type: 'inference',
      modelKind: 'embedding',
      backend: state.backend,
      inferenceBatch: Math.floor(index / state.batchSize) + 1,
      inferenceBatchCount: state.inferenceBatchCount,
      completedBatches: Math.floor(index / state.batchSize),
      batchSize: state.batchSize,
      inputCount: state.texts.length,
      tokenMaxLength: 128,
    };

    postToHost({
      ...progress,
      elapsedMs: Math.round(performance.now() - state.startedAt),
    });

    const output = await state.extractor(batch, {
      pooling: 'mean',
      normalize: true,
      truncation: true,
      max_length: 128,
    });
    const batchEmbeddings = output.tolist() as number[][];
    if (!Array.isArray(batchEmbeddings) || batchEmbeddings.length !== batch.length) {
      throw new Error('Neural embedding pipeline returned an unexpected batch shape.');
    }
    if (batchEmbeddings.some((vector) => !Array.isArray(vector) || vector.length !== NEURAL_DIMENSIONS)) {
      throw new Error('Neural embedding pipeline returned an unexpected embedding dimension.');
    }

    state.embeddings.push(...batchEmbeddings);
    state.nextIndex += batch.length;
    postToHost({
      ...progress,
      completedBatches: progress.inferenceBatch,
      elapsedMs: Math.round(performance.now() - state.startedAt),
    });

    if (state.nextIndex >= state.texts.length) {
      if (state.embeddings.length !== state.texts.length) {
        throw new Error('Neural embedding pipeline returned an unexpected batch shape.');
      }
      postToHost({
        id,
        ok: true,
        modelKind: 'embedding',
        modelId: NEURAL_MODEL_ID,
        modelVersion: NEURAL_MODEL_VERSION,
        dimensions: NEURAL_DIMENSIONS,
        backend: state.backend,
        embeddings: state.embeddings,
      });
      return 'done';
    }

    return 'yield';
  };
}

async function runConceptRequest(id: string, request: NeuralSandboxRequest) {
  const items = Array.isArray(request.conceptItems)
    ? request.conceptItems
        .map((item) => ({
          text: typeof item?.text === 'string' ? item.text.slice(0, 3_000) : '',
          labels: Array.isArray(item?.labels)
            ? item.labels
                .filter((label): label is string => typeof label === 'string')
                .map((label) => label.trim())
                .filter(Boolean)
                .slice(0, 12)
            : [],
        }))
        .slice(0, 4)
    : [];

  const { classifier, backend } = await getConceptClassifier();
  const startedAt = performance.now();
  const concepts: string[][] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    postToHost({
      id,
      type: 'concept-inference',
      modelKind: 'concept',
      backend,
      item: index + 1,
      itemCount: items.length,
      completedItems: index,
      inputCount: items.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });

    if (!item.text || item.labels.length === 0) {
      concepts.push([]);
    } else {
      const result = await classifier(item.text, item.labels, {
        multi_label: true,
        hypothesis_template: 'This video is about {}.',
      });
      concepts.push(
        result.labels
          .map((label, scoreIndex) => ({
            label,
            score: Number(result.scores[scoreIndex] ?? Number.NEGATIVE_INFINITY),
          }))
          .filter((entry) => Number.isFinite(entry.score) && entry.score >= 0.58)
          .sort((left, right) => (
            right.score - left.score
            || left.label.localeCompare(right.label)
          ))
          .slice(0, 4)
          .map((entry) => entry.label),
      );
    }

    postToHost({
      id,
      type: 'concept-inference',
      modelKind: 'concept',
      backend,
      item: index + 1,
      itemCount: items.length,
      completedItems: index + 1,
      inputCount: items.length,
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
    concepts,
  });
}

window.addEventListener('message', (event: MessageEvent<NeuralSandboxRequest>) => {
  const request = event.data;
  if (
    event.source !== window.parent
    || request?.source !== 'myalgo-neural-host'
    || (request.type !== 'EMBED_TEXTS' && request.type !== 'VERIFY_CONCEPTS')
    || typeof request.id !== 'string'
  ) {
    return;
  }

  const id = request.id;
  if (scheduler.isQueued(id)) return;

  const onError = (error: unknown) => {
    if (activeRequestId === id) activeRequestId = null;
    postToHost({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Local neural sandbox failed.',
    });
  };
  const onDone = () => {
    if (activeRequestId === id) activeRequestId = null;
  };

  if (request.type === 'VERIFY_CONCEPTS') {
    scheduler.enqueue({
      id,
      kind: 'concept',
      step: async () => {
        activeRequestId = id;
        await runConceptRequest(id, request);
        return 'done';
      },
      onDone,
      onError,
    });
    return;
  }

  scheduler.enqueue({
    id,
    kind: 'embedding',
    step: createEmbeddingRequestStep(id, request),
    onDone,
    onError,
  });
});

postToHost({ type: 'ready' });
