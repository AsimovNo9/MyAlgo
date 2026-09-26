import type { EmbeddingRecord } from '@repo/shared-types';
import type { EmbeddingCache } from '@repo/recommender-core';
import { STORAGE_KEYS } from './storage';

type CacheState = Record<string, EmbeddingRecord>;

export function createChromeEmbeddingCache(
  maxRecords = 600,
): EmbeddingCache & { size(): Promise<number> } {
  const limit = Math.max(32, Math.floor(maxRecords));
  let loaded: Promise<Map<string, EmbeddingRecord>> | null = null;
  let dirty = false;

  const load = async (): Promise<Map<string, EmbeddingRecord>> => {
    if (!loaded) {
      loaded = chrome.storage.local.get([STORAGE_KEYS.SEMANTIC_EMBEDDING_CACHE]).then((result) => {
        const raw = result[STORAGE_KEYS.SEMANTIC_EMBEDDING_CACHE] as CacheState | undefined;
        return new Map(Object.entries(raw ?? {}));
      });
    }
    return loaded;
  };

  const trim = (records: Map<string, EmbeddingRecord>): void => {
    if (records.size <= limit) return;
    const retained = [...records.entries()]
      .sort(([, left], [, right]) => (
        right.generated_at.localeCompare(left.generated_at)
      ))
      .slice(0, limit);
    records.clear();
    for (const [key, record] of retained) records.set(key, record);
  };

  return {
    async get(key) {
      return (await load()).get(key) ?? null;
    },

    async set(key, record) {
      const records = await load();
      records.set(key, record);
      dirty = true;
    },

    async flush() {
      if (!dirty) return;
      const records = await load();
      trim(records);
      await chrome.storage.local.set({
        [STORAGE_KEYS.SEMANTIC_EMBEDDING_CACHE]: Object.fromEntries(records),
      });
      dirty = false;
    },

    async size() {
      return (await load()).size;
    },
  };
}
