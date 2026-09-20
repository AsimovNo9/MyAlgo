export type SemanticVectorMatch = {
  content_item_id: string;
  similarity: number;
  model_version: string;
};

type VectorClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown[] | null; error: unknown | null }>;
};

export async function retrieveSimilarContent(
  client: VectorClient | null,
  embedding: number[] | null,
  options: { threshold?: number; limit?: number; modelVersion?: string } = {},
): Promise<SemanticVectorMatch[]> {
  if (!client || !embedding || embedding.length === 0) return [];

  const { data, error } = await client.rpc('match_content_embeddings', {
    query_embedding: embedding,
    match_threshold: Math.min(1, Math.max(0, options.threshold ?? 0.75)),
    match_count: Math.min(100, Math.max(1, options.limit ?? 50)),
    requested_model_version: options.modelVersion ?? null,
  });

  if (error || !Array.isArray(data)) return [];
  return data
    .map((row) => row as Partial<SemanticVectorMatch>)
    .filter((row): row is SemanticVectorMatch => (
      typeof row.content_item_id === 'string'
      && typeof row.similarity === 'number'
      && typeof row.model_version === 'string'
    ));
}