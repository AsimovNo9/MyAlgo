import {
  CONCEPT_EXTRACTION_MODEL_ID,
  CONCEPT_EXTRACTION_MODEL_VERSION,
  parseConceptExtractionOutput,
} from '@repo/recommender-core';
import { ensureWorkerOffscreenDocument } from './offscreen-worker.ts';

type ConceptExtractionResponse = {
  ok?: boolean;
  outputs?: string[];
  modelId?: string;
  modelVersion?: string;
  backend?: string;
  error?: string;
};

export type LocalConceptExtractionProvider = {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly execution: 'offscreen_sandbox_text2text';
  extract(prompts: readonly string[]): Promise<{
    concepts: string[][];
    backend: string;
  }>;
};

export function createLocalConceptExtractionProvider(): LocalConceptExtractionProvider {
  return {
    modelId: CONCEPT_EXTRACTION_MODEL_ID,
    modelVersion: CONCEPT_EXTRACTION_MODEL_VERSION,
    execution: 'offscreen_sandbox_text2text',

    async extract(prompts) {
      if (prompts.length === 0) return { concepts: [], backend: 'none' };

      const ready = await ensureWorkerOffscreenDocument(
        'Run local concept extraction outside ranking and first-paint work.',
      );
      if (!ready) throw new Error('Offscreen worker is required for local concept extraction.');

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        chrome.runtime.sendMessage({
          target: 'semantic-embedding-offscreen',
          type: 'EXTRACT_CONCEPTS',
          prompts: [...prompts],
        }) as Promise<ConceptExtractionResponse>,
        new Promise<ConceptExtractionResponse>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out waiting for local concept extraction.')),
            330_000,
          );
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });

      if (
        !response?.ok
        || !Array.isArray(response.outputs)
        || response.modelId !== CONCEPT_EXTRACTION_MODEL_ID
        || response.modelVersion !== CONCEPT_EXTRACTION_MODEL_VERSION
      ) {
        throw new Error(response?.error ?? 'Local concept extraction failed.');
      }
      if (response.outputs.length !== prompts.length) {
        throw new Error('Local concept extraction returned an unexpected output count.');
      }

      return {
        concepts: response.outputs.map((output) => parseConceptExtractionOutput(output, 4)),
        backend: response.backend ?? 'unknown',
      };
    },
  };
}
