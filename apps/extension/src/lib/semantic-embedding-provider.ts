import type { LocalEmbeddingProvider } from '@repo/recommender-core';
import { createLocalHashEmbeddingProvider } from '@repo/recommender-core';
import { ensureWorkerOffscreenDocument } from './offscreen-worker.ts';

type SemanticEmbeddingResponse = {
  ok?: boolean;
  embeddings?: number[][];
  modelId?: string;
  modelVersion?: string;
  dimensions?: number;
  error?: string;
};

export type OffscreenEmbeddingProvider = LocalEmbeddingProvider & {
  readonly execution: 'offscreen_worker_with_hash_fallback';
};

export function createOffscreenEmbeddingProvider(
  dimensions = 192,
): OffscreenEmbeddingProvider {
  const fallback = createLocalHashEmbeddingProvider(dimensions);

  return {
    modelId: fallback.modelId,
    modelVersion: fallback.modelVersion,
    dimensions: fallback.dimensions,
    execution: 'offscreen_worker_with_hash_fallback',

    async embed(texts) {
      if (texts.length === 0) return [];

      try {
        const ready = await ensureWorkerOffscreenDocument(
          'Run semantic embedding generation in a dedicated worker so ranking UI remains responsive.',
        );
        if (!ready) return fallback.embed(texts);

        const response = await chrome.runtime.sendMessage({
          target: 'semantic-embedding-offscreen',
          type: 'EMBED_TEXTS',
          texts: [...texts],
        }) as SemanticEmbeddingResponse;

        if (!response?.ok || !Array.isArray(response.embeddings)) {
          throw new Error(response?.error ?? 'Semantic embedding worker failed.');
        }
        if (
          response.modelId !== fallback.modelId
          || response.modelVersion !== fallback.modelVersion
          || response.dimensions !== fallback.dimensions
        ) {
          throw new Error('Semantic embedding worker identity does not match the configured provider.');
        }
        if (response.embeddings.length !== texts.length) {
          throw new Error('Semantic embedding worker returned an unexpected number of vectors.');
        }

        return response.embeddings;
      } catch (error) {
        console.warn('[MyAlgo] offscreen semantic embedding unavailable; using local hash fallback', error);
        return fallback.embed(texts);
      }
    },
  };
}
