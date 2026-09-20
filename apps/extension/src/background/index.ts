import { createMessage, EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { STORAGE_KEYS, getStorage, setStorage } from '../lib/storage';
import type { FeedSourceFilters } from '@repo/shared-types';
import { activateAlgorithm, fetchAlgorithms, fetchFeed, getApiBaseUrl, rankPageCandidates, type PageCandidate } from '../lib/api-client';
import { normalizeFeed } from '../lib/extension-helpers';
import { getExtensionAccessToken, signInWithGoogle, signOutExtension } from '../lib/auth';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    [STORAGE_KEYS.MODE]: 'Work',
    [STORAGE_KEYS.ENABLED]: true,
    [STORAGE_KEYS.FEED_CACHE]: [],
    [STORAGE_KEYS.LAST_SYNC]: null,
    [STORAGE_KEYS.SOURCE_FILTERS]: {
      subscribedOnly: false,
      includeDiscovery: true,
      includeShorts: true,
      includeLive: true,
    },
  });
  ensureYoutubeSyncAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureYoutubeSyncAlarm();
});

const YOUTUBE_SYNC_ALARM = 'personal-algorithm-youtube-sync';

// The YouTube Data API quota (10,000 units/day) is shared across the whole project, not
// per user. Each sync can run up to 5 search.list calls (~500 units), so this must stay
// infrequent (once daily) rather than every few minutes, or a handful of active users
// would exhaust the shared quota. A cheaper ingestion path (e.g. RSS polling for known
// channels) is the durable fix; this alarm is a bounded stopgap until that exists.
function ensureYoutubeSyncAlarm() {
  chrome.alarms.get(YOUTUBE_SYNC_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(YOUTUBE_SYNC_ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 1 });
    }
  });
}

// Runs the server-side subscription + discovery search for the active algorithm and
// persists matching videos, so the cached feed reflects more than whatever is already synced.
const syncYoutubeContent = async () => {
  const accessToken = await getExtensionAccessToken();
  if (!accessToken) {
    return;
  }

  try {
    const baseUrl = await getApiBaseUrl();
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/youtube/sync`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`YouTube sync failed: ${response.status}`);
    }

    await refreshFeed();
  } catch (error) {
    console.error('Failed to sync YouTube content in the background', error);
  }
};

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === YOUTUBE_SYNC_ALARM) {
    void syncYoutubeContent();
  }
});

const refreshFeed = async (mode?: string) => {
  try {
    const selectedMode = mode ?? await getStorage(STORAGE_KEYS.MODE, 'Work');
    const sourceFilters = await getStorage<FeedSourceFilters>(STORAGE_KEYS.SOURCE_FILTERS, {});
    const feedResponse = await fetchFeed(selectedMode, sourceFilters);
    const normalizedFeed = normalizeFeed(feedResponse);
    await setStorage(STORAGE_KEYS.FEED_CACHE, normalizedFeed);
    await setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    await setStorage('personal-algorithm-last-error', null);
    return normalizedFeed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch feed.';
    await setStorage('personal-algorithm-last-error', message);
    console.error('Failed to refresh extension feed', message);
    return [];
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message as { type: string; payload?: { mode?: string; algorithmId?: string; enabled?: boolean; contentItemId?: string; externalId?: string; eventType?: string; sourceFilters?: FeedSourceFilters } };

  if (type === EXTENSION_MESSAGE_TYPES.GET_FEED) {
    void getStorage(STORAGE_KEYS.FEED_CACHE, []).then((feed) => {
      sendResponse({ feed });
    });
    return true;
  }

  if (type === 'RANK_PAGE') {
    void (async () => {
      try {
        const mode = payload?.mode ?? await getStorage(STORAGE_KEYS.MODE, 'Work');
        const sourceFilters = await getStorage<FeedSourceFilters>(STORAGE_KEYS.SOURCE_FILTERS, {});
        const ranked = await rankPageCandidates(mode, (payload as { candidates?: PageCandidate[] }).candidates ?? [], sourceFilters);
        await setStorage('personal-algorithm-last-error', null);
        sendResponse({ ok: true, feed: normalizeFeed(ranked) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to rank page.';
        await setStorage('personal-algorithm-last-error', message);
        console.error('Failed to rank current YouTube page', message);
        sendResponse({ ok: false, error: message });
      }
    })();
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.SET_MODE) {
    const nextMode = payload?.mode ?? 'Work';
    void (async () => {
      await setStorage(STORAGE_KEYS.MODE, nextMode);
      const algorithmId = payload?.algorithmId
        ?? (await fetchAlgorithms()).find((algorithm) => algorithm.name === nextMode)?.id;
      const activation = algorithmId ? await activateAlgorithm(algorithmId) : null;
      await refreshFeed(nextMode);
      const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://youtube.com/*'] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'MODE_CHANGED', payload: { mode: nextMode } }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true, activation });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to activate algorithm.' }));
    return true;
  }

  if (type === 'SET_ENABLED') {
    const enabled = payload?.enabled !== false;
    void (async () => {
      await setStorage(STORAGE_KEYS.ENABLED, enabled);
      const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://youtube.com/*'] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'EXTENSION_ENABLED', payload: { enabled } }).catch(() => undefined)
        : undefined));
      if (enabled) {
        await refreshFeed();
      }
    })();
    sendResponse({ ok: true, enabled });
    return true;
  }

  if (type === 'SET_SOURCE_FILTERS') {
    void (async () => {
      await setStorage(STORAGE_KEYS.SOURCE_FILTERS, payload?.sourceFilters ?? {});
      await refreshFeed();
      const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://youtube.com/*'] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'SOURCE_FILTERS_CHANGED' }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.FEEDBACK) {
    void (async () => {
      try {
        const accessToken = await getExtensionAccessToken();
        const response = await fetch(`${(await getApiBaseUrl()).replace(/\/$/, '')}/api/feedback`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            contentItemId: payload?.contentItemId,
            eventType: payload?.eventType,
          }),
        });

        if (!response.ok) {
          throw new Error(`Feedback request failed: ${response.status}`);
        }
      } catch (error) {
        console.error('Failed to send feedback event', error);
      }
    })();

    void setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    sendResponse({ ok: true, contentItemId: payload?.contentItemId, eventType: payload?.eventType });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.ACTIVITY) {
    void (async () => {
      try {
        const accessToken = await getExtensionAccessToken();
        const response = await fetch(`${(await getApiBaseUrl()).replace(/\/$/, '')}/api/activity`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ externalId: payload?.externalId, eventType: payload?.eventType }),
        });
        if (!response.ok) throw new Error(`Activity request failed: ${response.status}`);
      } catch (error) {
        console.error('Failed to send activity event', error);
      }
    })();
    sendResponse({ ok: true, externalId: payload?.externalId, eventType: payload?.eventType });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.OPEN_OPTIONS) {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (type === 'SIGN_IN') {
    void signInWithGoogle().then(async () => {
      ensureYoutubeSyncAlarm();
      await syncYoutubeContent();
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Sign-in failed.' }));
    return true;
  }

  if (type === 'SIGN_OUT') {
    void signOutExtension().then(() => sendResponse({ ok: true }));
    return true;
  }

  sendResponse({ ok: false });
  return true;
});

chrome.runtime.onMessageExternal.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true });
  return true;
});

const backgroundBootstrap = async () => {
  const mode = await getStorage(STORAGE_KEYS.MODE, 'Work');
  const feed = await getStorage(STORAGE_KEYS.FEED_CACHE, []);
  ensureYoutubeSyncAlarm();
  void syncYoutubeContent();
  await refreshFeed(mode);

  console.info('Personal Algorithm background ready', { mode, count: feed.length, apiBaseUrl: await getApiBaseUrl() });
};

void backgroundBootstrap();

const message = createMessage(EXTENSION_MESSAGE_TYPES.GET_FEED, { algorithmId: 'demo' });
console.info('Background service worker ready', message);
