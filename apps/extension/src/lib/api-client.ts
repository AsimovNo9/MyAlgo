import type { FeedResponse } from '@repo/shared-types';

const API_BASE_URL_KEY = 'personal-algorithm-api-base-url';
const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export async function getApiBaseUrl(): Promise<string> {
  const result = await chrome.storage.local.get([API_BASE_URL_KEY]);
  return (result[API_BASE_URL_KEY] as string | undefined) ?? DEFAULT_API_BASE_URL;
}

export async function setApiBaseUrl(baseUrl: string): Promise<void> {
  await chrome.storage.local.set({ [API_BASE_URL_KEY]: baseUrl });
}

export async function fetchFeed(): Promise<FeedResponse> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/feed`);

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  return (await response.json()) as FeedResponse;
}
