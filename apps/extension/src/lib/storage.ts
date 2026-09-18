export const STORAGE_KEYS = {
  MODE: 'personal-algorithm-mode',
  FEED_CACHE: 'personal-algorithm-feed-cache',
  LAST_SYNC: 'personal-algorithm-last-sync',
} as const;

export async function getStorage<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get([key]);
  return (result[key] ?? fallback) as T;
}

export async function setStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
