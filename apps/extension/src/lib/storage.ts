export const STORAGE_KEYS = {
  MODE: 'personal-algorithm-mode',
  ENABLED: 'personal-algorithm-enabled',
  FEED_CACHE: 'personal-algorithm-feed-cache',
  FEED_CANDIDATE_POOL: 'personal-algorithm-feed-candidate-pool',
  VIDEO_STORE: 'personal-algorithm-video-store',
  LAST_SYNC: 'personal-algorithm-last-sync',
  SOURCE_FILTERS: 'personal-algorithm-source-filters',
  HISTORY_EVIDENCE: 'personal-algorithm-history-evidence',
  HISTORY_METRICS: 'personal-algorithm-history-metrics',
  HOME_OBSERVATION_ENABLED: 'personal-algorithm-home-observation-enabled',
  HOME_OBSERVATIONS: 'personal-algorithm-home-observations',
  HOME_METRICS: 'personal-algorithm-home-metrics',
} as const;

export async function getStorage<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get([key]);
  return (result[key] ?? fallback) as T;
}

export async function setStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeStorage(keys: string[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}
