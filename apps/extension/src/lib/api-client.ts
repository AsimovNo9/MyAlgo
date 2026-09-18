import type { FeedResponse } from '@repo/shared-types';

const API_BASE_URL_KEY = 'personal-algorithm-api-base-url';
const DEFAULT_API_BASE_URL = 'https://my-algo-web.vercel.app';

export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '');
}

export async function getApiBaseUrl(): Promise<string> {
  const result = await chrome.storage.local.get([API_BASE_URL_KEY]);
  const storedBaseUrl = (result[API_BASE_URL_KEY] as string | undefined)?.trim();
  return normalizeApiBaseUrl(storedBaseUrl || DEFAULT_API_BASE_URL);
}

export async function setApiBaseUrl(baseUrl: string): Promise<void> {
  await chrome.storage.local.set({ [API_BASE_URL_KEY]: normalizeApiBaseUrl(baseUrl) });
}

export async function fetchFeed(): Promise<FeedResponse> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/feed`);

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  return (await response.json()) as FeedResponse;
}
