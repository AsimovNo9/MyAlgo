import { fetchWithRetry } from './http.ts';
import { createSupabaseAdminClient } from './supabase/server';

const defaultEmbeddingModel = 'text-embedding-3-small';

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.EMBEDDING_API_KEY?.trim();
  const endpoint = process.env.EMBEDDING_API_URL?.trim() || 'https://api.openai.com/v1/embeddings';
  const model = process.env.EMBEDDING_MODEL?.trim() || defaultEmbeddingModel;
  if (!apiKey || !text.trim()) return null;

  try {
    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
    }, { timeoutMs: 12000, maxAttempts: 2 });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const embedding = body.data?.[0]?.embedding;
    return Array.isArray(embedding) && embedding.every((value) => typeof value === 'number')
      ? embedding as number[]
      : null;
  } catch {
    return null;
  }
}

export async function backfillContentEmbeddings(limit = 25) {
  const client = createSupabaseAdminClient();
  const modelVersion = process.env.EMBEDDING_MODEL_VERSION?.trim() || process.env.EMBEDDING_MODEL?.trim() || defaultEmbeddingModel;
  if (!client) return { ok: false, processed: 0, embedded: 0, error: 'Supabase admin client is not configured.' };
  if (!process.env.EMBEDDING_API_KEY?.trim()) return { ok: false, processed: 0, embedded: 0, error: 'EMBEDDING_API_KEY is not configured.' };

  const { data, error } = await client
    .from('content_items')
    .select('id, title, channel_name, raw_metadata')
    .order('fetched_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  if (error || !data) return { ok: false, processed: 0, embedded: 0, error: 'Unable to load content for embedding backfill.' };

  let embedded = 0;
  for (const item of data) {
    const rawDescription = item.raw_metadata && typeof item.raw_metadata === 'object'
      ? (item.raw_metadata as { description?: unknown }).description
      : null;
    const description = typeof rawDescription === 'string' ? rawDescription : null;
    const text = [item.title, description, item.channel_name].filter(Boolean).join('\n');
    const embedding = await generateEmbedding(text);
    if (!embedding) continue;
    const { error: upsertError } = await client.from('content_embeddings').upsert({
      content_item_id: item.id,
      model_version: modelVersion,
      embedding,
    }, { onConflict: 'content_item_id,model_version' });
    if (!upsertError) embedded += 1;
  }

  return { ok: true, processed: data.length, embedded, modelVersion };
}