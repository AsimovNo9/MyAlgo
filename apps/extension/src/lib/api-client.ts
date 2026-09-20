import type { Algorithm, AlgorithmActivationResponse, FeedResponse, FeedSourceFilters } from '@repo/shared-types';
import { getExtensionAccessToken, signOutExtension } from './auth';

export type PageCandidate = {
  external_id: string;
  title: string;
  channel_name?: string | null;
  is_short?: boolean;
  is_live?: boolean;
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
    cache: 'no-store',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (response.status === 401) {
      await signOutExtension();
      throw new Error('Extension session expired. Sign in again from the popup.');
    }
    throw new Error(body?.error ? `Failed to fetch algorithms: ${body.error}` : `Failed to fetch algorithms: ${response.status}`);
  }

  return (await response.json()) as Algorithm[];
}

export async function activateAlgorithm(algorithmId: string): Promise<AlgorithmActivationResponse> {
  const baseUrl = await getApiBaseUrl();
  const accessToken = await getExtensionAccessToken();
  const response = await fetch(`${baseUrl}/api/algorithms/activate`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ algorithmId }),
  });
  const body = await response.json().catch(() => null) as AlgorithmActivationResponse | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `Unable to activate algorithm: ${response.status}`);
  return body;
}

export async function fetchFeed(mode?: string, sourceFilters?: FeedSourceFilters): Promise<FeedResponse> {
  const baseUrl = await getApiBaseUrl();
  const accessToken = await getExtensionAccessToken();
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (sourceFilters?.subscribedOnly) params.set('subscribedOnly', 'true');
  if (sourceFilters?.includeDiscovery === false) params.set('includeDiscovery', 'false');
  if (sourceFilters?.includeShorts === false) params.set('includeShorts', 'false');
  if (sourceFilters?.includeLive === false) params.set('includeLive', 'false');
  const query = params.toString() ? `?${params.toString()}` : '';
  const endpoints = [baseUrl];

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
      if (error instanceof Error && error.message === 'Extension session expired. Sign in again from the popup.') {
        throw error;
      }
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(`Failed to fetch feed: ${lastError instanceof Error ? lastError.message : 'network error'}`);
  }

  throw new Error(`Failed to fetch feed: ${lastStatus}`);
}

export async function rankPageCandidates(mode: string, candidates: PageCandidate[], sourceFilters?: FeedSourceFilters): Promise<FeedResponse> {
  const baseUrl = await getApiBaseUrl();
  const accessToken = await getExtensionAccessToken();
  const endpoints = [baseUrl];

  let lastStatus = 0;
  for (const endpoint of endpoints) {
    const response = await fetch(`${endpoint}/api/rank`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ mode, candidates, sourceFilters }),
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
