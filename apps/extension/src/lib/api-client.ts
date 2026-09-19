import type { Algorithm, FeedResponse } from '@repo/shared-types';
import { getExtensionAccessToken, signOutExtension } from './auth';

export type PageCandidate = {
  external_id: string;
  title: string;
  channel_name?: string | null;
};

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

export async function fetchAlgorithms(): Promise<Algorithm[]> {
  const baseUrl = await getApiBaseUrl();
  const accessToken = await getExtensionAccessToken();
  const response = await fetch(`${baseUrl}/api/algorithms`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch algorithms: ${response.status}`);
  }

  return (await response.json()) as Algorithm[];
}

export async function fetchFeed(mode?: string): Promise<FeedResponse> {
  const baseUrl = await getApiBaseUrl();
  const accessToken = await getExtensionAccessToken();
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  const endpoints = [baseUrl];
  if (baseUrl !== 'http://localhost:3000') {
    endpoints.push('http://localhost:3000');
  }

  let lastStatus = 0;
  let lastError: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/api/feed${query}`, {
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });

      if (response.ok) {
        return (await response.json()) as FeedResponse;
      }

      lastStatus = response.status;
      if (response.status === 401) {
        await signOutExtension();
        throw new Error('Extension session expired. Sign in again from the popup.');
      }
      if (response.status !== 404) {
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(`Failed to fetch feed: ${lastError instanceof Error ? lastError.message : 'network error'}`);
  }

  throw new Error(`Failed to fetch feed: ${lastStatus}`);
}

export async function rankPageCandidates(mode: string, candidates: PageCandidate[]): Promise<FeedResponse> {
  const baseUrl = await getApiBaseUrl();
  const accessToken = await getExtensionAccessToken();
  const endpoints = [baseUrl];
  if (baseUrl !== 'http://localhost:3000') {
    endpoints.push('http://localhost:3000');
  }

  let lastStatus = 0;
  for (const endpoint of endpoints) {
    const response = await fetch(`${endpoint}/api/rank`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ mode, candidates }),
    });

    if (response.ok) {
      return (await response.json()) as FeedResponse;
    }

    lastStatus = response.status;
    if (response.status === 401) {
      await signOutExtension();
      throw new Error('Extension session expired. Sign in again from the popup.');
    }
    if (response.status !== 404) {
      break;
    }
  }

  throw new Error(`Failed to rank page: ${lastStatus}`);
}
