import type { LocalEmbeddingProvider } from '@repo/recommender-core';
import { createLocalHashEmbeddingProvider } from '@repo/recommender-core';
import { ensureWorkerOffscreenDocument } from './offscreen-worker.ts';

export type SemanticModelMode = 'hash' | 'neural';

const NEURAL_MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const NEURAL_MODEL_VERSION = 'transformersjs-local-q8-v2';
const NEURAL_DIMENSIONS = 384;

type SemanticEmbeddingResponse = {
  ok?: boolean;
  embeddings?: number[][];
  modelId?: string;
  modelVersion?: string;
  dimensions?: number;
  backend?: string;
  error?: string;
};

export type OffscreenEmbeddingProvider = LocalEmbeddingProvider & {
  readonly execution: string;
  readonly mode: SemanticModelMode;
};

export const semanticProviderIdentity = (mode: SemanticModelMode): {
  modelId: string;
  modelVersion: string;
  dimensions: number;
} => mode === 'neural'
  ? {
      modelId: NEURAL_MODEL_ID,
      modelVersion: NEURAL_MODEL_VERSION,
      dimensions: NEURAL_DIMENSIONS,
    }
  : {
      modelId: 'myalgo-local-hash-embedding',
      modelVersion: 'hash-v1-d192',
      dimensions: 192,
    };

export function createOffscreenEmbeddingProvider(
  mode: SemanticModelMode = 'hash',
): OffscreenEmbeddingProvider {
  const fallback = createLocalHashEmbeddingProvider(192);
  const identity = semanticProviderIdentity(mode);

  return {
    ...identity,
    mode,
    execution: mode === 'neural'
      ? 'offscreen_sandbox_neural'
      : 'offscreen_worker_with_hash_fallback',

    async embed(texts) {
      if (texts.length === 0) return [];

      try {
        const ready = await ensureWorkerOffscreenDocument(
          'Run semantic embedding generation in a dedicated worker so ranking UI remains responsive.',
        );
        if (!ready) {
          if (mode === 'neural') throw new Error('Offscreen worker is required for neural semantic embeddings.');
          return fallback.embed(texts);
        }

        let timeout: ReturnType<typeof setTimeout> | undefined;
        const response = await Promise.race([
          chrome.runtime.sendMessage({
            target: 'semantic-embedding-offscreen',
            type: 'EMBED_TEXTS',
            provider: mode,
            texts: [...texts],
          }) as Promise<SemanticEmbeddingResponse>,
          new Promise<SemanticEmbeddingResponse>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Timed out waiting for semantic offscreen response.')),
              // Let the sandbox host report its own timeout first, preserving
              // whether the request was posted and which inference batch ran.
              mode === 'neural' ? 330_000 : 20_000,
            );
          }),
        ]).finally(() => {
          if (timeout !== undefined) clearTimeout(timeout);
        });

        if (!response?.ok || !Array.isArray(response.embeddings)) {
          throw new Error(response?.error ?? 'Semantic embedding worker failed.');
        }
        if (
          response.modelId !== identity.modelId
          || response.modelVersion !== identity.modelVersion
          || response.dimensions !== identity.dimensions
        ) {
          throw new Error('Semantic embedding worker identity does not match the configured provider.');
        }
        if (response.embeddings.length !== texts.length) {
          throw new Error('Semantic embedding worker returned an unexpected number of vectors.');
        }

        return response.embeddings;
      } catch (error) {
        if (mode === 'neural') {
          console.warn('[MyAlgo] neural semantic embedding unavailable', error);
          throw error;
        }
        console.warn('[MyAlgo] offscreen semantic embedding unavailable; using local hash fallback', error);
        return fallback.embed(texts);
      }
    },
  };
}
