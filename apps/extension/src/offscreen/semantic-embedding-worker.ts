import { createLocalHashEmbeddingProvider } from '@repo/recommender-core';

type SemanticWorkerRequest = {
  id: string;
  texts: string[];
};

const hashProvider = createLocalHashEmbeddingProvider(192);

self.onmessage = async (event: MessageEvent<SemanticWorkerRequest>) => {
  const { id, texts } = event.data;
  try {
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
