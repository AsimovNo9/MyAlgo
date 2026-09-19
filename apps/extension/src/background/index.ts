import { createMessage, EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { STORAGE_KEYS, getStorage, setStorage } from '../lib/storage';
import { fetchFeed, getApiBaseUrl, rankPageCandidates, type PageCandidate } from '../lib/api-client';
import { normalizeFeed } from '../lib/extension-helpers';
import { getExtensionAccessToken, signInWithGoogle, signOutExtension } from '../lib/auth';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    [STORAGE_KEYS.MODE]: 'Work',
    [STORAGE_KEYS.ENABLED]: true,
    [STORAGE_KEYS.FEED_CACHE]: [],
    [STORAGE_KEYS.LAST_SYNC]: null,
  });
});

const refreshFeed = async (mode?: string) => {
  try {
    const selectedMode = mode ?? await getStorage(STORAGE_KEYS.MODE, 'Work');
    const feedResponse = await fetchFeed(selectedMode);
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
  const { type, payload } = message as { type: string; payload?: { mode?: string; enabled?: boolean; contentItemId?: string; eventType?: string } };

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
        const ranked = await rankPageCandidates(mode, (payload as { candidates?: PageCandidate[] }).candidates ?? []);
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
      await refreshFeed(nextMode);
      const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://youtube.com/*'] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'MODE_CHANGED', payload: { mode: nextMode } }).catch(() => undefined)
        : undefined));
    })();
    sendResponse({ ok: true });
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

  if (type === EXTENSION_MESSAGE_TYPES.OPEN_OPTIONS) {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (type === 'SIGN_IN') {
    void signInWithGoogle().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Sign-in failed.' }));
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
  await refreshFeed(mode);

  console.info('Personal Algorithm background ready', { mode, count: feed.length, apiBaseUrl: await getApiBaseUrl() });
};

void backgroundBootstrap();

const message = createMessage(EXTENSION_MESSAGE_TYPES.GET_FEED, { algorithmId: 'demo' });
console.info('Background service worker ready', message);
