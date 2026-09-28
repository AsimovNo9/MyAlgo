import {
  CONCEPT_EXTRACTION_MODEL_ID,
  CONCEPT_EXTRACTION_MODEL_VERSION,
  type ConceptVerificationInput,
} from '@repo/recommender-core';
import { ensureWorkerOffscreenDocument } from './offscreen-worker.ts';

type ConceptVerificationResponse = {
  ok?: boolean;
  concepts?: string[][];
  modelId?: string;
  modelVersion?: string;
  backend?: string;
  error?: string;
};

export type LocalConceptExtractionProvider = {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly execution: 'offscreen_sandbox_zero_shot_classification';
  verify(items: readonly ConceptVerificationInput[]): Promise<{
    concepts: string[][];
    backend: string;
  }>;
};

export function createLocalConceptExtractionProvider(): LocalConceptExtractionProvider {
  return {
    modelId: CONCEPT_EXTRACTION_MODEL_ID,
    modelVersion: CONCEPT_EXTRACTION_MODEL_VERSION,
    execution: 'offscreen_sandbox_zero_shot_classification',

    async verify(items) {
      if (items.length === 0) return { concepts: [], backend: 'none' };

      const ready = await ensureWorkerOffscreenDocument(
        'Run local concept verification outside ranking and first-paint work.',
      );
      if (!ready) throw new Error('Offscreen worker is required for local concept verification.');

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        chrome.runtime.sendMessage({
          target: 'semantic-embedding-offscreen',
          type: 'VERIFY_CONCEPTS',
          conceptItems: items.map((item) => ({
            text: item.text,
            labels: [...item.labels],
          })),
        }) as Promise<ConceptVerificationResponse>,
        new Promise<ConceptVerificationResponse>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out waiting for local concept verification.')),
            // The offscreen sandbox owns the 300s execution timeout. Do not
            // abandon this request earlier and leave its verifier job running
            // in the shared scheduler while embeddings queue behind it.
            330_000,
          );
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });

      if (
        !response?.ok
        || !Array.isArray(response.concepts)
        || response.modelId !== CONCEPT_EXTRACTION_MODEL_ID
        || response.modelVersion !== CONCEPT_EXTRACTION_MODEL_VERSION
      ) {
        throw new Error(response?.error ?? 'Local concept verification failed.');
      }
      if (response.concepts.length !== items.length) {
        throw new Error('Local concept verification returned an unexpected output count.');
      }

      return {
        concepts: response.concepts.map((concepts) => [...concepts]),
        backend: response.backend ?? 'unknown',
      };
    },
  };
}
