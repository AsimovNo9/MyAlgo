import { createLocalHashEmbeddingProvider } from '@repo/recommender-core';

type SemanticWorkerRequest = {
  id: string;
  provider?: 'hash' | 'neural';
  texts: string[];
};

const hashProvider = createLocalHashEmbeddingProvider(192);
const NEURAL_MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const NEURAL_MODEL_VERSION = 'transformersjs-webgpu-q8-v1';
const NEURAL_DIMENSIONS = 384;

type FeatureExtractionPipeline = {
  (texts: string[], options: { pooling: 'mean'; normalize: true }): Promise<{ tolist(): unknown }>;
};

let neuralPipeline: Promise<FeatureExtractionPipeline> | null = null;
let activeLoadRequestId: string | null = null;

async function getNeuralPipeline(): Promise<FeatureExtractionPipeline> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU is unavailable in this browser.');
  }

  if (!neuralPipeline) {
    neuralPipeline = (async () => {
      // Keep the deterministic hash baseline independent of the neural runtime:
      // Transformers.js is loaded only after the user explicitly selects neural
      // semantics and a neural embedding request actually arrives.
      const { env, pipeline } = await import('@huggingface/transformers');
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.cacheKey = 'myalgo-transformers-cache-v1';

      return pipeline(
        'feature-extraction',
        NEURAL_MODEL_ID,
        {
          device: 'webgpu',
          dtype: 'q8',
          progress_callback: (progress: unknown) => {
            self.postMessage({
              id: activeLoadRequestId,
              type: 'progress',
              progress,
            });
          },
        },
      ) as Promise<FeatureExtractionPipeline>;
    })();

    neuralPipeline.catch(() => {
      neuralPipeline = null;
    });
  }

  return neuralPipeline;
}

async function embedNeural(texts: string[], requestId: string): Promise<number[][]> {
  activeLoadRequestId = requestId;
  const extractor = await getNeuralPipeline();
  const output = await extractor(texts, {
    pooling: 'mean',
    normalize: true,
  });
  const values = output.tolist() as number[][];
  if (!Array.isArray(values) || values.length !== texts.length) {
    throw new Error('Neural embedding pipeline returned an unexpected batch shape.');
  }
  if (values.some((vector) => !Array.isArray(vector) || vector.length !== NEURAL_DIMENSIONS)) {
    throw new Error('Neural embedding pipeline returned an unexpected embedding dimension.');
  }
  activeLoadRequestId = null;
  return values;
}

self.onmessage = async (event: MessageEvent<SemanticWorkerRequest>) => {
  const { id, texts, provider = 'hash' } = event.data;
  try {
    if (provider === 'neural') {
      const embeddings = await embedNeural(texts, id);
      self.postMessage({
        id,
        ok: true,
        modelId: NEURAL_MODEL_ID,
        modelVersion: NEURAL_MODEL_VERSION,
        dimensions: NEURAL_DIMENSIONS,
        backend: 'webgpu',
        embeddings,
      });
      return;
    }

    const embeddings = await hashProvider.embed(texts);
    self.postMessage({
      id,
      ok: true,
      modelId: hashProvider.modelId,
      modelVersion: hashProvider.modelVersion,
      dimensions: hashProvider.dimensions,
      backend: 'hash',
      embeddings,
    });
  } catch (error) {
    activeLoadRequestId = null;
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Semantic embedding worker failed.',
    });
  }
};
