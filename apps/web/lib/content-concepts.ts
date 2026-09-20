import type { ConceptCatalogEntry } from './concepts.ts';

export type ContentConceptMatchRow = {
  content_item_id: string;
  concept_id: string;
  confidence: number;
  source: 'deterministic' | 'graph' | 'embedding' | 'llm';
  model_version: string;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildContentConceptMatches(
  contentItemId: string,
  topics: string[],
  catalog: ConceptCatalogEntry[],
  confidence: number,
  modelVersion = 'deterministic-v1',
): ContentConceptMatchRow[] {
  const normalizedTopics = new Set(topics.map(normalize).filter(Boolean));
  const boundedConfidence = Math.min(1, Math.max(0, Number.isFinite(confidence) ? confidence : 0));

  return catalog
    .filter((concept) => [concept.canonicalName, ...concept.aliases, ...concept.intents].some((term) => normalizedTopics.has(normalize(term))))
    .map((concept) => ({
      content_item_id: contentItemId,
      concept_id: concept.id,
      confidence: boundedConfidence,
      source: 'deterministic' as const,
      model_version: modelVersion,
    }));
}

export async function persistContentConceptMatches(
  client: { from(table: string): { upsert(rows: ContentConceptMatchRow[], options: { onConflict: string }): PromiseLike<{ error: unknown | null }> } },
  rows: ContentConceptMatchRow[],
): Promise<void> {
  const persistableRows = rows.filter((row) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.concept_id));
  if (persistableRows.length === 0) return;
  const { error } = await client.from('content_concepts').upsert(persistableRows, { onConflict: 'content_item_id,concept_id' });
  if (error) console.error('Failed to persist content concept matches', error);
}