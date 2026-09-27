import { createLocalHashEmbeddingProvider } from '@repo/recommender-core';

type SemanticWorkerRequest = {
  id: string;
  texts: string[];
};

const provider = createLocalHashEmbeddingProvider(192);

self.onmessage = async (event: MessageEvent<SemanticWorkerRequest>) => {
  const { id, texts } = event.data;
  try {
    const embeddings = await provider.embed(texts);
    self.postMessage({
      id,
      ok: true,
      modelId: provider.modelId,
      modelVersion: provider.modelVersion,
      dimensions: provider.dimensions,
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
