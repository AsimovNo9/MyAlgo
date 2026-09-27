import { createLocalHashEmbeddingProvider } from '@repo/recommender-core';
import { env, pipeline } from '@huggingface/transformers';

type SemanticWorkerRequest = {
  id: string;
  provider?: 'hash' | 'neural';
  texts: string[];
};

const hashProvider = createLocalHashEmbeddingProvider(192);
const NEURAL_MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const NEURAL_MODEL_VERSION = 'transformersjs-webgpu-q8-v1';
const NEURAL_DIMENSIONS = 384;

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline>>;
let neuralPipeline: Promise<FeatureExtractionPipeline> | null = null;

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;
env.cacheKey = 'myalgo-transformers-cache-v1';

async function getNeuralPipeline(): Promise<FeatureExtractionPipeline> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU is unavailable in this browser.');
  }
  if (!neuralPipeline) {
    neuralPipeline = pipeline(
      'feature-extraction',
      NEURAL_MODEL_ID,
      {
        device: 'webgpu',
        dtype: 'q8',
      },
    );
    neuralPipeline.catch(() => {
      neuralPipeline = null;
    });
  }
  return neuralPipeline;
}

async function embedNeural(texts: string[]): Promise<number[][]> {
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
  return values;
}

self.onmessage = async (event: MessageEvent<SemanticWorkerRequest>) => {
  const { id, texts, provider = 'hash' } = event.data;
  try {
    if (provider === 'neural') {
      const embeddings = await embedNeural(texts);
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
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Semantic embedding worker failed.',
    });
  }
};
