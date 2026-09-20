import { buildConceptCatalog, buildFallbackConceptCatalog, type ConceptCatalogEntry, type ConceptRelationEntry } from './concepts.ts';

type ConceptCatalogClient = {
  from(table: string): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: unknown | null }>;
    };
  };
};

export async function loadConceptCatalog(client: ConceptCatalogClient | null): Promise<ConceptCatalogEntry[]> {
  const fallback = buildFallbackConceptCatalog();
  if (!client) return fallback;

  try {
    const { data, error } = await client
      .from('concept_entries')
      .select('id, canonical_name, description, aliases, intents, entities, positive_phrases, negative_phrases, language, source, version, status')
      .order('canonical_name', { ascending: true });

    if (error || !Array.isArray(data) || data.length === 0) {
      if (error) console.error('Falling back to deterministic concept catalog', error);
      return fallback;
    }

    return buildConceptCatalog((data as Array<{
      id: string;
      canonical_name: string;
      description?: string | null;
      aliases?: string[] | null;
      intents?: string[] | null;
      entities?: string[] | null;
      positive_phrases?: string[] | null;
      negative_phrases?: string[] | null;
      language?: string | null;
      source?: string | null;
      version?: number | null;
      status?: 'pending' | 'approved' | 'rejected' | null;
    }>).filter((concept) => concept.status !== 'rejected' && concept.status !== 'pending'));
  } catch (error) {
    console.error('Falling back to deterministic concept catalog after load failure', error);
    return fallback;
  }
}

export async function loadApprovedConceptGraph(client: ConceptCatalogClient | null): Promise<{
  catalog: ConceptCatalogEntry[];
  relations: ConceptRelationEntry[];
}> {
  const catalog = await loadConceptCatalog(client);
  if (!client || catalog.length === 0) return { catalog, relations: [] };

  try {
    const { data, error } = await client
      .from('concept_relations')
      .select('source_concept_id, target_concept_id, relation_type, weight')
      .order('weight', { ascending: false });
    if (error || !Array.isArray(data)) return { catalog, relations: [] };
    const approvedIds = new Set(catalog.map((concept) => concept.id));
    const relations = (data as ConceptRelationEntry[]).filter((relation) => (
      approvedIds.has(relation.source_concept_id) && approvedIds.has(relation.target_concept_id)
    ));
    return { catalog, relations };
  } catch (error) {
    console.error('Failed to load concept relations', error);
    return { catalog, relations: [] };
  }
}

export async function loadConceptCatalogForRequest(): Promise<ConceptCatalogEntry[]> {
  const { createSupabaseServerClient } = await import('./supabase/server.ts');
  return loadConceptCatalog(await createSupabaseServerClient() as ConceptCatalogClient | null);
}